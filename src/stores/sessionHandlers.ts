/**
 * Session Handlers - OnSite Timekeeper
 * 
 * Geofence enter/exit handlers with boot gate, vigilance mode, and hysteresis.
 */

import { logger } from '../lib/logger';
import {
  showEntryNotification,
  showExitNotification,
  showReturnNotification,
} from '../lib/notifications';
import {
  addToSkippedToday,
  removeFromSkippedToday,
  checkInsideFence,
} from '../lib/backgroundTasks';
import {
  savePendingAction as persistPending,
  clearPendingAction as clearPersistedPending,
  createEnterPending,
  createExitPending,
  createReturnPending,
} from '../lib/pendingTTL';
import { useRecordStore } from './recordStore';
import { useSettingsStore } from './settingsStore';
import { useAuthStore } from './authStore';
import type { Coordinates } from '../lib/location';

import {
  type PendingAction,
  type PauseState,
  type QueuedGeofenceEvent,
  isBootReady,
  queueEvent,
  resolveLocationName,
  clearPendingAction,
  createPendingAction,
  clearVigilanceInterval,
  setVigilanceInterval,
  getVigilanceInterval,
} from './sessionHelpers';

// ============================================
// TYPES FOR STORE ACCESS
// ============================================

export interface SessionState {
  pendingAction: PendingAction | null;
  pauseState: PauseState | null;
  skippedToday: string[];
  lastProcessedEnterLocationId: string | null;
}

export type GetState = () => SessionState & {
  actionResume: () => Promise<void>;
};

export type SetState = (
  partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)
) => void;

// ============================================
// HANDLE GEOFENCE ENTER
// ============================================

export async function handleGeofenceEnterLogic(
  get: GetState,
  set: SetState,
  locationId: string,
  locationName: string | null,
  coords?: Coordinates & { accuracy?: number }
): Promise<void> {
  // BOOT GATE: Queue if not ready
  if (!isBootReady()) {
    queueEvent({
      type: 'enter',
      locationId,
      locationName,
      coords,
      timestamp: Date.now(),
    });
    return;
  }
  
  // Resolve name if null/unknown
  const resolvedName = (locationName && locationName !== 'Unknown' && locationName !== 'null')
    ? locationName
    : resolveLocationName(locationId);
  
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
    logger.debug('session', `Ignoring duplicate enter for ${resolvedName}`);
    return;
  }

  logger.info('session', `🚶 GEOFENCE ENTER: ${resolvedName}`, { locationId });

  // Cancel pending exit if exists (user returned quickly)
  if (pendingAction?.type === 'exit' && pendingAction.locationId === locationId) {
    logger.info('session', '↩️ User returned - canceling exit');
    await clearPendingAction(pendingAction);
    clearVigilanceInterval();
    set({ pendingAction: null, lastProcessedEnterLocationId: locationId });
    return;
  }

  // If paused at this location, show RETURN notification
  if (pauseState?.locationId === locationId) {
    logger.info('session', '↩️ User returned during pause');
    
    // Clear pause timeout since user is back
    if (pauseState.timeoutId) {
      clearTimeout(pauseState.timeoutId);
    }
    
    const notificationId = await showReturnNotification(
      locationId,
      resolvedName,
      settings.returnTimeoutMinutes
    );
    
    const timeoutId = setTimeout(async () => {
      logger.info('session', `⏱️ AUTO RESUME (${settings.returnTimeoutMinutes} min timeout)`);
      await get().actionResume();
    }, RETURN_TIMEOUT);

    // Persist to AsyncStorage for background heartbeat (TTL)
    const persistedPending = createReturnPending(
      locationId,
      resolvedName,
      notificationId,
      RETURN_TIMEOUT,
      coords
    );
    persistPending(persistedPending);

    set({
      pendingAction: createPendingAction(
        'return',
        locationId,
        resolvedName,
        notificationId,
        timeoutId,
        Date.now(),
        coords
      ),
      pauseState: null,
      lastProcessedEnterLocationId: locationId,
    });
    return;
  }

  // Check if skipped today
  if (skippedToday.includes(locationId)) {
    logger.info('session', `😴 Location skipped today: ${resolvedName}`);
    set({ lastProcessedEnterLocationId: locationId });
    return;
  }

  // Check if already has active session
  const recordStore = useRecordStore.getState();
  if (recordStore.currentSession) {
    const activeSession = recordStore.currentSession;
    
    // If same location, ignore
    if (activeSession.location_id === locationId) {
      logger.debug('session', 'Already tracking this location');
      set({ lastProcessedEnterLocationId: locationId });
      return;
    }
    
    // Different location: auto-close previous session
    logger.info('session', '🔄 New fence entered - closing previous session', {
      previous: activeSession.location_name,
      new: resolvedName,
    });
    
    await recordStore.registerExit(activeSession.location_id);
  }

  // Show ENTRY notification
  const notificationId = await showEntryNotification(
    locationId,
    resolvedName,
    settings.entryTimeoutMinutes
  );
  
  const timeoutId = setTimeout(async () => {
    logger.info('session', `⏱️ AUTO START (${settings.entryTimeoutMinutes} min timeout)`);
    // Import dynamically to avoid circular dependency
    const { useWorkSessionStore } = await import('./workSessionStore');
    await useWorkSessionStore.getState().actionStart();
  }, ENTRY_TIMEOUT);

  // Persist to AsyncStorage for background heartbeat (TTL)
  const persistedPending = createEnterPending(
    locationId,
    resolvedName,
    notificationId,
    ENTRY_TIMEOUT,
    coords
  );
  persistPending(persistedPending);

  set({
    pendingAction: createPendingAction(
      'enter',
      locationId,
      resolvedName,
      notificationId,
      timeoutId,
      Date.now(),
      coords
    ),
    lastProcessedEnterLocationId: locationId,
  });
}

// ============================================
// HANDLE GEOFENCE EXIT
// ============================================

export async function handleGeofenceExitLogic(
  get: GetState,
  set: SetState,
  locationId: string,
  locationName: string | null,
  coords?: Coordinates & { accuracy?: number }
): Promise<void> {
  // BOOT GATE: Queue if not ready
  if (!isBootReady()) {
    queueEvent({
      type: 'exit',
      locationId,
      locationName,
      coords,
      timestamp: Date.now(),
    });
    return;
  }
  
  // Resolve name if null/unknown
  const resolvedName = (locationName && locationName !== 'Unknown' && locationName !== 'null')
    ? locationName
    : resolveLocationName(locationId);
  
  const { pendingAction, pauseState, skippedToday } = get();

  // Prevent duplicate exit processing
  if (pendingAction?.type === 'exit' && pendingAction.locationId === locationId) {
    logger.debug('session', 'Duplicate exit ignored (already pending)', { locationId });
    return;
  }

  // Get timeout from settings
  const settings = useSettingsStore.getState();
  const EXIT_TIMEOUT = settings.getExitTimeoutMs();
  const EXIT_ADJUSTMENT = settings.getExitAdjustment();

  logger.info('session', `🚶 GEOFENCE EXIT: ${resolvedName}`, { locationId });

  clearVigilanceInterval();

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

  // Show EXIT notification (with adjustment info)
  const notificationId = await showExitNotification(
    locationId,
    resolvedName,
    settings.exitTimeoutSeconds,
    settings.exitAdjustmentMinutes
  );
  
  const timeoutId = setTimeout(async () => {
    // FIX: Validate GPS + hysteresis before ending session
    const userId = useAuthStore.getState().getUserId();
    if (userId) {
      try {
        const { getCurrentLocation } = await import('../lib/location');
        const location = await getCurrentLocation();
        
        if (location) {
          const { isInside } = await checkInsideFence(
            location.coords.latitude,
            location.coords.longitude,
            userId,
            true, // useHysteresis = radius × 1.3
            'geofence',
            location.accuracy ?? undefined
          );
          
          if (isInside) {
            logger.info('session', '🛡️ AUTO END CANCELLED - Still inside fence (hysteresis)');
            await clearPersistedPending();
            set({ pendingAction: null });
            
            // Start vigilance mode
            startVigilanceMode(get, set, locationId, userId);
            return;
          }
        }
      } catch (error) {
        logger.warn('session', 'GPS check failed, proceeding with exit', { error: String(error) });
      }
    }
    
    logger.info('session', `⏱️ AUTO END (${settings.exitTimeoutSeconds}s timeout) with ${settings.exitAdjustmentMinutes} min adjustment`);
    
    const recordStore = useRecordStore.getState();
    await recordStore.registerExitWithAdjustment(
      locationId,
      coords,
      EXIT_ADJUSTMENT
    );
    
    await clearPersistedPending();
    set({ pendingAction: null });
  }, EXIT_TIMEOUT);

  // Persist to AsyncStorage for background heartbeat (TTL)
  const persistedPending = createExitPending(
    locationId,
    resolvedName,
    notificationId,
    EXIT_TIMEOUT,
    coords
  );
  persistPending(persistedPending);

  set({
    pendingAction: createPendingAction(
      'exit',
      locationId,
      resolvedName,
      notificationId,
      timeoutId,
      Date.now(),
      coords
    ),
  });
}

// ============================================
// VIGILANCE MODE
// ============================================

function startVigilanceMode(
  get: GetState,
  set: SetState,
  locationId: string,
  userId: string
): void {
  // Vigilance mode: re-check every 1 min for 5 min
  let checksRemaining = 5;
  
  const interval = setInterval(async () => {
    checksRemaining--;
    
    // Check if vigilance was cancelled
    if (!getVigilanceInterval()) {
      return;
    }
    
    try {
      const { getCurrentLocation } = await import('../lib/location');
      const loc = await getCurrentLocation();
      
      if (loc) {
        const { isInside: stillInside } = await checkInsideFence(
          loc.coords.latitude,
          loc.coords.longitude,
          userId,
          true,
          'geofence',
          loc.accuracy ?? undefined
        );
        
        if (!stillInside) {
          logger.info('session', '🚪 Vigilance check: NOW outside fence - ending session');
          clearVigilanceInterval();
          
          // Cancel any pending exit timeout
          const { pendingAction } = get();
          if (pendingAction?.timeoutId) {
            clearTimeout(pendingAction.timeoutId);
          }
          await clearPersistedPending();
          set({ pendingAction: null });
          
          const recordStore = useRecordStore.getState();
          await recordStore.registerExit(locationId);
          return;
        }
        
        logger.info('session', `👁️ Vigilance check ${5 - checksRemaining}/5: still inside`);
      }
    } catch (error) {
      logger.warn('session', 'Vigilance check failed', { error: String(error) });
    }
    
    if (checksRemaining <= 0) {
      logger.info('session', '👁️ Vigilance ended - user stayed inside');
      clearVigilanceInterval();
    }
  }, 60000);
  
  setVigilanceInterval(interval, locationId);
}
