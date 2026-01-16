/**
 * Work Session Store - OnSite Timekeeper v2
 * 
 * SIMPLIFIED FLOW - Expanded notifications (no fullscreen popup)
 * 
 * Timer values come from settingsStore (user configurable)
 * 
 * ENTRY: X min timeout → auto-start (silent, no confirmation notification)
 * EXIT: X sec timeout → auto-end with -X min adjustment (silent)
 * RETURN (during pause): X min timeout → auto-resume
 * 
 * PAUSE FLOW:
 *   1. User clicks Pause → starts X min countdown
 *   2. If user returns to fence during pause → auto-resume
 *   3. When pause expires → show ALARM notification (15s to respond)
 *   4. If no response in 15s → check GPS:
 *      - Inside fence = auto-resume (work continues)
 *      - Outside fence = auto-end session
 *   5. SNOOZE adds another X min to the pause
 * 
 * BOOT GATE:
 *   Events received before app is ready are queued and processed later.
 *   This prevents "Unknown Location" and "null" in logs.
 * 
 * REFACTORED: Logic split into sessionHelpers, sessionHandlers, sessionActions
 */

import { create } from 'zustand';
import * as Notifications from 'expo-notifications';
import { logger } from '../lib/logger';
import {
  requestNotificationPermission,
  configureNotificationCategories,
  cancelNotification,
  addResponseListener,
  type GeofenceNotificationData,
} from '../lib/notifications';
import {
  clearSkippedToday,
  removeFromSkippedToday as removeFromSkippedTodayBg,
} from '../lib/backgroundTasks';
import { clearPendingAction as clearPersistedPending } from '../lib/pendingTTL';
import type { Coordinates } from '../lib/location';

// Import from refactored modules
import {
  type PendingAction,
  type PauseState,
  setStoreRef,
  markAppReady,
  resetBootGate as resetBootGateHelper,
  clearVigilanceInterval,
} from './sessionHelpers';

import {
  handleGeofenceEnterLogic,
  handleGeofenceExitLogic,
} from './sessionHandlers';

import {
  actionStartLogic,
  actionSkipTodayLogic,
  actionOkLogic,
  actionPauseLogic,
  actionSnoozeLogic,
  actionResumeLogic,
  actionStopLogic,
} from './sessionActions';

// Re-export types for external use
export type { PendingAction, PauseState };
export type { PendingActionType } from './sessionHelpers';

// ============================================
// STORE INTERFACE
// ============================================

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
    locationName: string | null,
    coords?: Coordinates & { accuracy?: number }
  ) => Promise<void>;
  
  handleGeofenceExit: (
    locationId: string,
    locationName: string | null,
    coords?: Coordinates & { accuracy?: number }
  ) => Promise<void>;
  
  // User actions (from notification buttons)
  actionStart: () => Promise<void>;
  actionSkipToday: () => Promise<void>;
  actionOk: () => Promise<void>;
  actionPause: () => Promise<void>;
  actionResume: () => Promise<void>;
  actionStop: () => Promise<void>;
  actionSnooze: () => Promise<void>;
  
  // Helpers
  clearPending: () => void;
  clearPause: () => void;
  resetSkippedToday: () => void;
  removeFromSkippedToday: (locationId: string) => void;
  resetBootGate: () => void;
}

// ============================================
// STORE
// ============================================

export const useWorkSessionStore = create<WorkSessionState>((set, get) => ({
  // Initial state
  isInitialized: false,
  pendingAction: null,
  pauseState: null,
  skippedToday: [],
  lastProcessedEnterLocationId: null,

  // ============================================
  // INITIALIZE
  // ============================================
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
          
          // Pause expired actions
          case 'snooze':
            get().actionSnooze();
            break;
          
          case Notifications.DEFAULT_ACTION_IDENTIFIER:
            // User tapped notification body - no action
            break;
        }
      });

      set({ isInitialized: true });
      
      // BOOT GATE: Mark app as ready
      setStoreRef(get());
      markAppReady();
      
      logger.info('boot', '✅ Work session store initialized');
    } catch (error) {
      logger.error('session', 'Error initializing', { error: String(error) });
      set({ isInitialized: true });
      
      // Even on error, mark as ready to not block events forever
      setStoreRef(get());
      markAppReady();
    }
  },

  // ============================================
  // GEOFENCE HANDLERS (delegated)
  // ============================================
  handleGeofenceEnter: async (locationId, locationName, coords) => {
    await handleGeofenceEnterLogic(get, set, locationId, locationName, coords);
  },

  handleGeofenceExit: async (locationId, locationName, coords) => {
    await handleGeofenceExitLogic(get, set, locationId, locationName, coords);
  },

  // ============================================
  // USER ACTIONS (delegated)
  // ============================================
  actionStart: async () => {
    await actionStartLogic(get, set);
  },

  actionSkipToday: async () => {
    await actionSkipTodayLogic(get, set);
  },

  actionOk: async () => {
    await actionOkLogic(get, set);
  },

  actionPause: async () => {
    await actionPauseLogic(get, set);
  },

  actionSnooze: async () => {
    await actionSnoozeLogic(get, set);
  },

  actionResume: async () => {
    await actionResumeLogic(get, set);
  },

  actionStop: async () => {
    await actionStopLogic(get, set);
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
    clearPersistedPending();
    clearVigilanceInterval();
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
      removeFromSkippedTodayBg(locationId);
      set({ skippedToday: skippedToday.filter(id => id !== locationId) });
      logger.debug('session', `Removed ${locationId} from skippedToday`);
    }
  },
  
  resetBootGate: () => {
    resetBootGateHelper();
  },
}));
