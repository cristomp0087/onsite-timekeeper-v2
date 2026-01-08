/**
 * Work Session Store - OnSite Timekeeper v2
 * 
 * SIMPLIFIED FLOW - Notification bar only (no fullscreen popup)
 * 
 * Timer values come from settingsStore (user configurable)
 * 
 * ENTRY: X min timeout → auto-start
 * EXIT: X sec timeout → auto-end with -X min adjustment
 * RETURN (during pause): X min timeout → auto-resume
 * PAUSE: X min countdown then auto-end
 */

import { create } from 'zustand';
import * as Notifications from 'expo-notifications';
import { logger } from '../lib/logger';
import {
  requestNotificationPermission,
  configureNotificationCategories,
  showEntryNotification,
  showExitNotification,
  showReturnNotification,
  showAutoActionNotification,
  cancelNotification,
  addResponseListener,
  type GeofenceNotificationData,
} from '../lib/notifications';
import {
  addToSkippedToday,
  removeFromSkippedToday,
  clearSkippedToday,
} from '../lib/backgroundTasks';
import { useRecordStore } from './recordStore';
import { useSettingsStore } from './settingsStore';
import type { Coordinates } from '../lib/location';

// ============================================
// TYPES
// ============================================

export type PendingActionType = 'enter' | 'exit' | 'return';

export interface PendingAction {
  type: PendingActionType;
  locationId: string;
  locationName: string;
  notificationId: string;
  timeoutId: ReturnType<typeof setTimeout>;
  coords?: Coordinates & { accuracy?: number };
  startTime: number;
}

export interface PauseState {
  isPaused: boolean;
  locationId: string;
  locationName: string;
  startTime: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

interface WorkSessionState {
  isInitialized: boolean;
  pendingAction: PendingAction | null;
  pauseState: PauseState | null;
  skippedToday: string[];
  lastProcessedEnterLocationId: string | null;

  // Actions
  initialize: () => Promise<void>;
  
  // Geofence handlers
  handleGeofenceEnter: (
    locationId: string,
    locationName: string,
    coords?: Coordinates & { accuracy?: number }
  ) => Promise<void>;
  
  handleGeofenceExit: (
    locationId: string,
    locationName: string,
    coords?: Coordinates & { accuracy?: number }
  ) => Promise<void>;
  
  // User actions (from notification buttons)
  actionStart: () => Promise<void>;
  actionSkipToday: () => void;
  actionOk: () => Promise<void>;
  actionPause: () => Promise<void>;
  actionResume: () => Promise<void>;
  actionStop: () => Promise<void>;
  
  // Helpers
  clearPending: () => void;
  clearPause: () => void;
  resetSkippedToday: () => void;
  removeFromSkippedToday: (locationId: string) => void;
}

// ============================================
// HELPERS
// ============================================

async function clearPendingAction(pendingAction: PendingAction | null): Promise<void> {
  if (!pendingAction) return;
  
  clearTimeout(pendingAction.timeoutId);
  if (pendingAction.notificationId) {
    await cancelNotification(pendingAction.notificationId);
  }
}

function createPendingAction(
  type: PendingActionType,
  locationId: string,
  locationName: string,
  notificationId: string,
  timeoutId: ReturnType<typeof setTimeout>,
  startTime: number,
  coords?: Coordinates & { accuracy?: number }
): PendingAction {
  return {
    type,
    locationId,
    locationName,
    notificationId,
    timeoutId,
    coords,
    startTime,
  };
}

function createPauseState(
  locationId: string,
  locationName: string,
  startTime: number,
  timeoutId: ReturnType<typeof setTimeout> | null
): PauseState {
  return {
    isPaused: true,
    locationId,
    locationName,
    startTime,
    timeoutId,
  };
}

// ============================================
// STORE
// ============================================

export const useWorkSessionStore = create<WorkSessionState>((set, get) => ({
  isInitialized: false,
  pendingAction: null,
  pauseState: null,
  skippedToday: [],
  lastProcessedEnterLocationId: null,

  initialize: async () => {
    if (get().isInitialized) return;

    try {
      logger.info('boot', '⏱️ Initializing work session store...');

      await requestNotificationPermission();
      await configureNotificationCategories();

      // Notification response listener
      addResponseListener((response) => {
        const actionIdentifier = response.actionIdentifier;
        const data = response.notification.request.content.data as GeofenceNotificationData | undefined;
        
        logger.info('notification', `📲 Response: ${actionIdentifier}`, { data });

        switch (actionIdentifier) {
          // Entry actions
          case 'start':
            get().actionStart();
            break;
          case 'skip_today':
            get().actionSkipToday();
            break;
          
          // Exit actions
          case 'ok':
            get().actionOk();
            break;
          case 'pause':
            get().actionPause();
            break;
          
          // Return actions
          case 'resume':
            get().actionResume();
            break;
          case 'stop':
            get().actionStop();
            break;
          
          case Notifications.DEFAULT_ACTION_IDENTIFIER:
            // User tapped notification body - no action
            break;
        }
      });

      set({ isInitialized: true });
      logger.info('boot', '✅ Work session store initialized');
    } catch (error) {
      logger.error('session', 'Error initializing', { error: String(error) });
      set({ isInitialized: true });
    }
  },

  // ============================================
  // GEOFENCE ENTER
  // ============================================
  handleGeofenceEnter: async (locationId, locationName, coords) => {
    const { 
      skippedToday, 
      pendingAction, 
      pauseState,
      lastProcessedEnterLocationId,
    } = get();

    // Get timeout from settings
    const settings = useSettingsStore.getState();
    const ENTRY_TIMEOUT = settings.getEntryTimeoutMs();
    const RETURN_TIMEOUT = settings.getReturnTimeoutMs();

    // Prevent duplicate processing
    if (lastProcessedEnterLocationId === locationId) {
      logger.debug('session', `Ignoring duplicate enter for ${locationName}`);
      return;
    }

    logger.info('session', `🚶 GEOFENCE ENTER: ${locationName}`, { locationId });

    // Cancel pending exit if exists (user returned quickly)
    if (pendingAction?.type === 'exit' && pendingAction.locationId === locationId) {
      logger.info('session', '↩️ User returned - canceling exit');
      await clearPendingAction(pendingAction);
      set({ pendingAction: null, lastProcessedEnterLocationId: locationId });
      return;
    }

    // If paused at this location, show RETURN notification
    if (pauseState?.locationId === locationId) {
      logger.info('session', '↩️ User returned during pause');
      
      const notificationId = await showReturnNotification(
        locationId,
        locationName,
        settings.returnTimeoutMinutes
      );
      
      const timeoutId = setTimeout(async () => {
        logger.info('session', `⏱️ AUTO RESUME (${settings.returnTimeoutMinutes} min timeout)`);
        await get().actionResume();
        await showAutoActionNotification(locationName, 'resume');
      }, RETURN_TIMEOUT);

      set({
        pendingAction: createPendingAction(
          'return',
          locationId,
          locationName,
          notificationId,
          timeoutId,
          Date.now(),
          coords
        ),
        lastProcessedEnterLocationId: locationId,
      });
      return;
    }

    // Check if skipped today
    if (skippedToday.includes(locationId)) {
      logger.info('session', `😴 Location skipped today: ${locationName}`);
      set({ lastProcessedEnterLocationId: locationId });
      return;
    }

    // Check if already has active session
    const recordStore = useRecordStore.getState();
    if (recordStore.currentSession) {
      logger.warn('session', 'Already has active session', {
        activeLocation: recordStore.currentSession.location_name,
      });
      set({ lastProcessedEnterLocationId: locationId });
      return;
    }

    // Show ENTRY notification
    const notificationId = await showEntryNotification(
      locationId,
      locationName,
      settings.entryTimeoutMinutes
    );
    
    const timeoutId = setTimeout(async () => {
      logger.info('session', `⏱️ AUTO START (${settings.entryTimeoutMinutes} min timeout)`);
      await get().actionStart();
      await showAutoActionNotification(locationName, 'start');
    }, ENTRY_TIMEOUT);

    set({
      pendingAction: createPendingAction(
        'enter',
        locationId,
        locationName,
        notificationId,
        timeoutId,
        Date.now(),
        coords
      ),
      lastProcessedEnterLocationId: locationId,
    });
  },

  // ============================================
  // GEOFENCE EXIT
  // ============================================
  handleGeofenceExit: async (locationId, locationName, coords) => {
    const { pendingAction, pauseState, skippedToday } = get();

    // Get timeout from settings
    const settings = useSettingsStore.getState();
    const EXIT_TIMEOUT = settings.getExitTimeoutMs();
    const EXIT_ADJUSTMENT = settings.getExitAdjustment();

    logger.info('session', `🚶 GEOFENCE EXIT: ${locationName}`, { locationId });

    // Clear skipped today for this location
    if (skippedToday.includes(locationId)) {
      removeFromSkippedToday(locationId);
      set({ skippedToday: skippedToday.filter(id => id !== locationId) });
    }

    // Reset lastProcessedEnterLocationId
    set({ lastProcessedEnterLocationId: null });

    // Cancel pending enter if exists
    if (pendingAction?.type === 'enter' && pendingAction.locationId === locationId) {
      logger.info('session', '❌ Canceling pending enter - user left');
      await clearPendingAction(pendingAction);
      set({ pendingAction: null });
      return;
    }

    // Check if has active session at this location
    const recordStore = useRecordStore.getState();
    const activeSession = recordStore.currentSession;
    
    if (!activeSession || activeSession.location_id !== locationId) {
      logger.debug('session', 'No active session at this location');
      return;
    }

    // If paused, keep pause state (user can return within pause limit)
    if (pauseState?.locationId === locationId) {
      logger.info('session', '⏸️ Exit during pause - countdown continues');
      return;
    }

    // Show EXIT notification
    const notificationId = await showExitNotification(
      locationId,
      locationName,
      settings.exitTimeoutSeconds
    );
    
    const timeoutId = setTimeout(async () => {
      logger.info('session', `⏱️ AUTO END (${settings.exitTimeoutSeconds}s timeout) with ${settings.exitAdjustmentMinutes} min adjustment`);
      
      // End with adjustment from settings
      const recordStore = useRecordStore.getState();
      await recordStore.registerExitWithAdjustment(
        locationId,
        coords,
        EXIT_ADJUSTMENT
      );
      
      await showAutoActionNotification(locationName, 'stop');
      set({ pendingAction: null });
    }, EXIT_TIMEOUT);

    set({
      pendingAction: createPendingAction(
        'exit',
        locationId,
        locationName,
        notificationId,
        timeoutId,
        Date.now(),
        coords
      ),
    });
  },

  // ============================================
  // ACTION: START (from entry notification)
  // ============================================
  actionStart: async () => {
    const { pendingAction } = get();
    if (!pendingAction || pendingAction.type !== 'enter') return;

    logger.info('session', `▶️ START: ${pendingAction.locationName}`);

    await clearPendingAction(pendingAction);

    const recordStore = useRecordStore.getState();
    await recordStore.registerEntry(
      pendingAction.locationId,
      pendingAction.locationName,
      pendingAction.coords
    );

    set({ pendingAction: null });
  },

  // ============================================
  // ACTION: SKIP TODAY
  // ============================================
  actionSkipToday: () => {
    const { pendingAction, skippedToday } = get();
    if (!pendingAction || pendingAction.type !== 'enter') return;

    logger.info('session', `😴 SKIP TODAY: ${pendingAction.locationName}`);

    clearTimeout(pendingAction.timeoutId);
    if (pendingAction.notificationId) {
      cancelNotification(pendingAction.notificationId);
    }

    addToSkippedToday(pendingAction.locationId);

    set({
      pendingAction: null,
      skippedToday: [...skippedToday, pendingAction.locationId],
    });
  },

  // ============================================
  // ACTION: OK (end now with real time)
  // ============================================
  actionOk: async () => {
    const { pendingAction } = get();
    if (!pendingAction || pendingAction.type !== 'exit') return;

    logger.info('session', `✓ OK (end now): ${pendingAction.locationName}`);

    await clearPendingAction(pendingAction);

    const recordStore = useRecordStore.getState();
    await recordStore.registerExit(pendingAction.locationId, pendingAction.coords);

    set({ pendingAction: null });
  },

  // ============================================
  // ACTION: PAUSE
  // ============================================
  actionPause: async () => {
    const { pendingAction } = get();
    if (!pendingAction || pendingAction.type !== 'exit') return;

    // Get pause limit from settings
    const settings = useSettingsStore.getState();
    const PAUSE_TIMEOUT = settings.getPauseLimitMs();

    logger.info('session', `⏸️ PAUSE: ${pendingAction.locationName}`);

    await clearPendingAction(pendingAction);

    // Pause timer
    const pauseTimeoutId = setTimeout(async () => {
      logger.info('session', `⏱️ PAUSE EXPIRED (${settings.pauseLimitMinutes} min) - Auto-ending`);
      
      const recordStore = useRecordStore.getState();
      const { pauseState } = get();
      
      if (pauseState) {
        await recordStore.registerExit(pauseState.locationId);
        await showAutoActionNotification(pauseState.locationName, 'stop');
      }
      
      set({ pauseState: null, pendingAction: null });
    }, PAUSE_TIMEOUT);

    set({
      pendingAction: null,
      pauseState: createPauseState(
        pendingAction.locationId,
        pendingAction.locationName,
        Date.now(),
        pauseTimeoutId
      ),
    });
  },

  // ============================================
  // ACTION: RESUME (from return notification)
  // ============================================
  actionResume: async () => {
    const { pendingAction, pauseState } = get();
    
    if (pendingAction?.type === 'return') {
      logger.info('session', `▶️ RESUME: ${pendingAction.locationName}`);
      await clearPendingAction(pendingAction);
    }

    // Clear pause state (session continues)
    if (pauseState?.timeoutId) {
      clearTimeout(pauseState.timeoutId);
    }

    const pausedMinutes = pauseState 
      ? Math.floor((Date.now() - pauseState.startTime) / 60000)
      : 0;

    logger.info('session', `✅ Session resumed (paused ${pausedMinutes} min)`);

    set({ 
      pendingAction: null, 
      pauseState: null,
    });
  },

  // ============================================
  // ACTION: STOP (from return notification)
  // ============================================
  actionStop: async () => {
    const { pendingAction, pauseState } = get();
    
    let locationId: string | null = null;
    let coords: (Coordinates & { accuracy?: number }) | undefined;

    if (pendingAction?.type === 'return') {
      locationId = pendingAction.locationId;
      coords = pendingAction.coords;
      await clearPendingAction(pendingAction);
      logger.info('session', `⏹️ STOP: ${pendingAction.locationName}`);
    } else if (pauseState) {
      locationId = pauseState.locationId;
      if (pauseState.timeoutId) {
        clearTimeout(pauseState.timeoutId);
      }
      logger.info('session', `⏹️ STOP (from pause): ${pauseState.locationName}`);
    }

    if (!locationId) {
      logger.warn('session', 'No session to stop');
      return;
    }

    const recordStore = useRecordStore.getState();
    await recordStore.registerExit(locationId, coords);

    set({ pendingAction: null, pauseState: null });
  },

  // ============================================
  // HELPERS
  // ============================================
  clearPending: () => {
    const { pendingAction } = get();
    if (pendingAction) {
      clearTimeout(pendingAction.timeoutId);
      if (pendingAction.notificationId) {
        cancelNotification(pendingAction.notificationId);
      }
    }
    set({ pendingAction: null });
  },

  clearPause: () => {
    const { pauseState } = get();
    if (pauseState?.timeoutId) {
      clearTimeout(pauseState.timeoutId);
    }
    set({ pauseState: null });
  },

  resetSkippedToday: () => {
    clearSkippedToday();
    set({ 
      skippedToday: [], 
      lastProcessedEnterLocationId: null,
    });
    logger.info('session', 'Skipped list reset');
  },

  removeFromSkippedToday: (locationId: string) => {
    const { skippedToday } = get();
    if (skippedToday.includes(locationId)) {
      removeFromSkippedToday(locationId);
      set({ skippedToday: skippedToday.filter(id => id !== locationId) });
      logger.debug('session', `Removed ${locationId} from skippedToday`);
    }
  },
}));
