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
  showPauseExpiredNotification,
  showAutoActionNotification,
  cancelNotification,
  addResponseListener,
  type GeofenceNotificationData,
} from '../lib/notifications';
import {
  addToSkippedToday,
  removeFromSkippedToday,
  clearSkippedToday,
  checkInsideFence,
} from '../lib/backgroundTasks';
import { useRecordStore } from './recordStore';
import { useSettingsStore } from './settingsStore';
import { useAuthStore } from './authStore';
import type { Coordinates } from '../lib/location';

// ============================================
// BOOT GATE - Prevent events before app is ready
// ============================================

interface QueuedGeofenceEvent {
  type: 'enter' | 'exit';
  locationId: string;
  locationName: string | null;
  coords?: Coordinates & { accuracy?: number };
  timestamp: number;
}

let isAppReady = false;
const eventQueue: QueuedGeofenceEvent[] = [];
const MAX_QUEUE_SIZE = 10;
const MAX_EVENT_AGE_MS = 30000; // 30 seconds

// Vigilance interval tracking (to prevent duplicates)
let activeVigilanceInterval: ReturnType<typeof setInterval> | null = null;
let activeVigilanceLocationId: string | null = null;

function clearVigilanceInterval(): void {
  if (activeVigilanceInterval) {
    clearInterval(activeVigilanceInterval);
    activeVigilanceInterval = null;
    activeVigilanceLocationId = null;
    logger.debug('session', '👁️ Vigilance interval cleared');
  }
}


function logBootGate(message: string, data?: Record<string, unknown>): void {
  logger.debug('session', `🚪 BOOT_GATE: ${message}`, data);
}

/**
 * Resolve location name from recordStore
 */
function resolveLocationName(locationId: string): string {
  try {
    const recordStore = useRecordStore.getState();
    const state = recordStore as unknown as { locations?: Array<{ id: string; name: string }> };
    const locations = state.locations || [];
    const location = locations.find((l) => l.id === locationId);
    if (location?.name) {
      return location.name;
    }
  } catch {
    // Ignore errors
  }
  
  // Try locationStore as fallback
  try {
    // Dynamic import to avoid circular dependency
    const { useLocationStore } = require('./locationStore');
    const locationStore = useLocationStore.getState();
    const locations = locationStore.locations || locationStore.savedLocations || [];
    const location = locations.find((l: { id: string; name: string }) => l.id === locationId);
    if (location?.name) {
      return location.name;
    }
  } catch {
    // Ignore errors
  }
  
  return 'Unknown Location';
}

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
  actionSkipToday: () => void;
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
// BOOT GATE FUNCTIONS
// ============================================

function queueEvent(event: QueuedGeofenceEvent): void {
  // Limit queue size
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    const dropped = eventQueue.shift();
    logBootGate(`Queue full, dropping oldest event`, {
      droppedType: dropped?.type,
      droppedLocationId: dropped?.locationId,
    });
  }
  
  eventQueue.push(event);
  logBootGate(`Event queued (${eventQueue.length}/${MAX_QUEUE_SIZE})`, {
    type: event.type,
    locationId: event.locationId,
    locationName: event.locationName,
  });
}

// Store reference for drainEventQueue
let storeRef: WorkSessionState | null = null;

function drainEventQueue(): void {
  if (eventQueue.length === 0) {
    logBootGate('Queue empty, nothing to drain');
    return;
  }
  
  if (!storeRef) {
    logger.warn('session', '⚠️ Cannot drain queue - store not ready');
    return;
  }
  
  logger.info('session', `📥 Draining ${eventQueue.length} queued events`);
  
  const now = Date.now();
  let processed = 0;
  let dropped = 0;
  
  while (eventQueue.length > 0) {
    const event = eventQueue.shift()!;
    const age = now - event.timestamp;
    
    // Drop stale events
    if (age > MAX_EVENT_AGE_MS) {
      logBootGate(`Dropping stale event (${age}ms old)`, {
        type: event.type,
        locationId: event.locationId,
      });
      dropped++;
      continue;
    }
    
    // Resolve location name if needed
    let resolvedName = event.locationName;
    if (!resolvedName || resolvedName === 'Unknown' || resolvedName === 'null') {
      resolvedName = resolveLocationName(event.locationId);
    }
    
    logBootGate(`Processing queued event`, {
      type: event.type,
      locationId: event.locationId,
      locationName: resolvedName,
      age: `${age}ms`,
    });
    
    // Process event (async but we don't await - fire and forget for queued events)
    if (event.type === 'enter') {
      storeRef.handleGeofenceEnter(event.locationId, resolvedName, event.coords);
    } else {
      storeRef.handleGeofenceExit(event.locationId, resolvedName, event.coords);
    }
    
    processed++;
  }
  
  logger.info('session', `📥 Queue drained: ${processed} processed, ${dropped} dropped`);
}

function markAppReady(): void {
  if (isAppReady) return;
  
  isAppReady = true;
  logger.info('session', '✅ App READY - processing queued events');
  
  // Small delay to ensure all stores are fully initialized
  setTimeout(() => {
    drainEventQueue();
  }, 100);
}

// ============================================
// STORE
// ============================================

export const useWorkSessionStore = create<WorkSessionState>((set, get) => {
  // Save store reference for drainEventQueue
  const store: WorkSessionState = {
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
        storeRef = get();
        markAppReady();
        
        logger.info('boot', '✅ Work session store initialized');
      } catch (error) {
        logger.error('session', 'Error initializing', { error: String(error) });
        set({ isInitialized: true });
        
        // Even on error, mark as ready to not block events forever
        storeRef = get();
        markAppReady();
      }
    },

    // ============================================
    // GEOFENCE ENTER (with Boot Gate)
    // ============================================
    handleGeofenceEnter: async (locationId, locationName, coords) => {
      // BOOT GATE: Queue if not ready
      if (!isAppReady) {
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
        await get().actionStart();
      }, ENTRY_TIMEOUT);

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
    },

    // ============================================
    // GEOFENCE EXIT (with Boot Gate)
    // ============================================
    handleGeofenceExit: async (locationId, locationName, coords) => {
      // BOOT GATE: Queue if not ready
      if (!isAppReady) {
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
                set({ pendingAction: null });
                
                // Vigilance mode: re-check every 1 min for 5 min
                let checksRemaining = 5;
                activeVigilanceLocationId = locationId;
                activeVigilanceInterval = setInterval(async () => {
                  checksRemaining--;
                  
                  // Check if vigilance was cancelled
                  if (!activeVigilanceInterval) {
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
        
        set({ pendingAction: null });
      }, EXIT_TIMEOUT);

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
    },

    // ============================================
    // ACTION: START (from entry notification)
    // ============================================
    actionStart: async () => {
      const { pendingAction } = get();
      
      if (!pendingAction || pendingAction.type !== 'enter') {
        logger.warn('session', '⚠️ Start called but no pending enter');
        return;
      }

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
    // ACTION: SKIP TODAY (from entry notification)
    // ============================================
    actionSkipToday: () => {
      const { pendingAction, skippedToday } = get();
      
      if (!pendingAction || pendingAction.type !== 'enter') {
        logger.warn('session', '⚠️ Skip called but no pending enter');
        return;
      }

      logger.info('session', `🚫 SKIP TODAY: ${pendingAction.locationName}`);
      
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
    // ACTION: OK (from exit notification)
    // ============================================
    actionOk: async () => {
      const { pendingAction } = get();
      
      if (!pendingAction || pendingAction.type !== 'exit') {
        logger.warn('session', '⚠️ OK called but no pending exit');
        return;
      }

      logger.info('session', `✅ OK: ${pendingAction.locationName}`);
      
      await clearPendingAction(pendingAction);
      
      const settings = useSettingsStore.getState();
      const EXIT_ADJUSTMENT = settings.getExitAdjustment();
      
      const recordStore = useRecordStore.getState();
      await recordStore.registerExitWithAdjustment(
        pendingAction.locationId,
        pendingAction.coords,
        EXIT_ADJUSTMENT
      );

      set({ pendingAction: null });
    },

    // ============================================
    // ACTION: PAUSE (from exit notification)
    // ============================================
    actionPause: async () => {
      const { pendingAction } = get();
      
      if (!pendingAction || pendingAction.type !== 'exit') {
        logger.warn('session', '⚠️ Pause called but no pending exit');
        return;
      }

      const settings = useSettingsStore.getState();
      const PAUSE_TIMEOUT = settings.getPauseLimitMs();
      const ALARM_RESPONSE_TIMEOUT = 15000; // 15 seconds to respond to alarm

      logger.info('session', `⏸️ PAUSE: ${pendingAction.locationName} (${settings.pauseLimitMinutes} min limit)`);
      
      await clearPendingAction(pendingAction);

      // Set pause timer
      const pauseTimeoutId = setTimeout(async () => {
        const currentPauseState = get().pauseState;
        if (!currentPauseState) return;

        logger.info('session', `⏰ PAUSE EXPIRED (${settings.pauseLimitMinutes} min) - Showing alarm`);
        
        // Show ALARM notification
        const alarmNotificationId = await showPauseExpiredNotification(
          currentPauseState.locationId,
          currentPauseState.locationName,
          settings.pauseLimitMinutes
        );

        // Wait 15 seconds for user response, then check GPS
        const alarmTimeoutId = setTimeout(async () => {
          const state = get().pauseState;
          if (!state) return;

          logger.info('session', `⏱️ Alarm timeout (${ALARM_RESPONSE_TIMEOUT / 1000}s) - Checking GPS...`);
          await cancelNotification(alarmNotificationId);

          const userId = useAuthStore.getState().getUserId();
          if (!userId) return;

          try {
            const { getCurrentLocation } = await import('../lib/location');
            const location = await getCurrentLocation();
            
            if (location) {
              const { isInside: actuallyInside } = await checkInsideFence(
                location.coords.latitude,
                location.coords.longitude,
                userId,
                false
              );

              if (actuallyInside) {
                logger.info('session', `✅ Inside fence - Auto-resuming work`);
                await get().actionResume();
              } else {
                logger.info('session', `🚪 Outside fence - Auto-ending session`);
                const recordStore = useRecordStore.getState();
                await recordStore.registerExit(currentPauseState.locationId);
                set({ pauseState: null, pendingAction: null });
              }
            } else {
              logger.warn('session', `⚠️ Could not get GPS - Ending session by default`);
              const recordStore = useRecordStore.getState();
              await recordStore.registerExit(currentPauseState.locationId);
              set({ pauseState: null, pendingAction: null });
            }
          } catch (error) {
            logger.error('session', `❌ Error checking GPS after pause`, { error: String(error) });
            const recordStore = useRecordStore.getState();
            await recordStore.registerExit(currentPauseState.locationId);
            set({ pauseState: null, pendingAction: null });
          }
        }, ALARM_RESPONSE_TIMEOUT);

        set({
          pauseState: {
            ...currentPauseState,
            timeoutId: alarmTimeoutId,
          },
        });
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
    // ACTION: SNOOZE (+30 min from pause expired alarm)
    // ============================================
    actionSnooze: async () => {
      const { pauseState } = get();
      if (!pauseState) {
        logger.warn('session', '⚠️ Snooze called but no pause state');
        return;
      }

      // Clear current alarm timeout
      if (pauseState.timeoutId) {
        clearTimeout(pauseState.timeoutId);
      }

      const settings = useSettingsStore.getState();
      const PAUSE_TIMEOUT = settings.getPauseLimitMs();
      const ALARM_RESPONSE_TIMEOUT = 15000;

      logger.info('session', `😴 SNOOZE: +${settings.pauseLimitMinutes} min at ${pauseState.locationName}`);

      // Set new pause timer (another 30 min)
      const newPauseTimeoutId = setTimeout(async () => {
        const currentPauseState = get().pauseState;
        if (!currentPauseState) return;

        logger.info('session', `⏰ SNOOZE EXPIRED (${settings.pauseLimitMinutes} min) - Showing alarm`);
        
        // Show alarm notification again
        const alarmNotificationId = await showPauseExpiredNotification(
          currentPauseState.locationId,
          currentPauseState.locationName,
          settings.pauseLimitMinutes
        );

        // Same 15-second timeout logic
        const alarmTimeoutId = setTimeout(async () => {
          const state = get().pauseState;
          if (!state) return;

          logger.info('session', `⏱️ Snooze alarm timeout - Checking GPS...`);
          await cancelNotification(alarmNotificationId);

          const userId = useAuthStore.getState().getUserId();
          if (!userId) return;

          try {
            const { getCurrentLocation } = await import('../lib/location');
            const location = await getCurrentLocation();
            
            if (location) {
              const { isInside } = await checkInsideFence(
                location.coords.latitude,
                location.coords.longitude,
                userId,
                false
              );

              if (isInside) {
                logger.info('session', `✅ Inside fence after snooze - Auto-resuming`);
                await get().actionResume();
              } else {
                logger.info('session', `🚪 Outside fence after snooze - Auto-ending`);
                const recordStore = useRecordStore.getState();
                await recordStore.registerExit(state.locationId);
                set({ pauseState: null, pendingAction: null });
              }
            } else {
              logger.warn('session', `⚠️ No GPS after snooze - Ending session`);
              const recordStore = useRecordStore.getState();
              await recordStore.registerExit(state.locationId);
              set({ pauseState: null, pendingAction: null });
            }
          } catch (error) {
            logger.error('session', `❌ Error after snooze`, { error: String(error) });
            const recordStore = useRecordStore.getState();
            await recordStore.registerExit(state.locationId);
            set({ pauseState: null, pendingAction: null });
          }
        }, ALARM_RESPONSE_TIMEOUT);

        set({
          pauseState: {
            ...currentPauseState,
            timeoutId: alarmTimeoutId,
          },
        });
      }, PAUSE_TIMEOUT);

      // Update pause state with new start time and timeout
      set({
        pauseState: {
          ...pauseState,
          startTime: Date.now(),
          timeoutId: newPauseTimeoutId,
        },
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
    
    resetBootGate: () => {
      isAppReady = false;
      eventQueue.length = 0;
      storeRef = null;
      logger.debug('session', '🔄 Boot gate reset');
    },
  };
  
  return store;
});
