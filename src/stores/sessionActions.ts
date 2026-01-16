/**
 * Session Actions - OnSite Timekeeper
 * 
 * User actions from notifications: start, skip, ok, pause, resume, stop, snooze.
 */

import { logger } from '../lib/logger';
import {
  showPauseExpiredNotification,
  cancelNotification,
} from '../lib/notifications';
import {
  addToSkippedToday,
  checkInsideFence,
} from '../lib/backgroundTasks';
import { clearPendingAction as clearPersistedPending } from '../lib/pendingTTL';
import { useRecordStore } from './recordStore';
import { useSettingsStore } from './settingsStore';
import { useAuthStore } from './authStore';
import type { Coordinates } from '../lib/location';

import {
  type PendingAction,
  type PauseState,
  clearPendingAction,
  createPauseState,
} from './sessionHelpers';

// ============================================
// TYPES FOR STORE ACCESS
// ============================================

export interface ActionState {
  pendingAction: PendingAction | null;
  pauseState: PauseState | null;
  skippedToday: string[];
}

export type GetActionState = () => ActionState & {
  actionResume: () => Promise<void>;
};

export type SetActionState = (
  partial: Partial<ActionState> | ((state: ActionState) => Partial<ActionState>)
) => void;

// ============================================
// ACTION: START (from entry notification)
// ============================================

export async function actionStartLogic(
  get: GetActionState,
  set: SetActionState
): Promise<void> {
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

  await clearPersistedPending();
  set({ pendingAction: null });
}

// ============================================
// ACTION: SKIP TODAY (from entry notification)
// ============================================

export async function actionSkipTodayLogic(
  get: GetActionState,
  set: SetActionState
): Promise<void> {
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
  
  await clearPersistedPending();
  set({
    pendingAction: null,
    skippedToday: [...skippedToday, pendingAction.locationId],
  });
}

// ============================================
// ACTION: OK (from exit notification)
// ============================================

export async function actionOkLogic(
  get: GetActionState,
  set: SetActionState
): Promise<void> {
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
}

// ============================================
// ACTION: PAUSE (from exit notification)
// ============================================

export async function actionPauseLogic(
  get: GetActionState,
  set: SetActionState
): Promise<void> {
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
    await handlePauseExpired(get, set, settings, ALARM_RESPONSE_TIMEOUT);
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
}

// ============================================
// ACTION: SNOOZE (+X min from pause expired alarm)
// ============================================

export async function actionSnoozeLogic(
  get: GetActionState,
  set: SetActionState
): Promise<void> {
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

  // Set new pause timer (another X min)
  const newPauseTimeoutId = setTimeout(async () => {
    await handlePauseExpired(get, set, settings, ALARM_RESPONSE_TIMEOUT);
  }, PAUSE_TIMEOUT);

  // Update pause state with new start time and timeout
  set({
    pauseState: {
      ...pauseState,
      startTime: Date.now(),
      timeoutId: newPauseTimeoutId,
    },
  });
}

// ============================================
// ACTION: RESUME (from return notification)
// ============================================

export async function actionResumeLogic(
  get: GetActionState,
  set: SetActionState
): Promise<void> {
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
}

// ============================================
// ACTION: STOP (from return notification)
// ============================================

export async function actionStopLogic(
  get: GetActionState,
  set: SetActionState
): Promise<void> {
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
}

// ============================================
// PAUSE EXPIRED HANDLER (shared by pause and snooze)
// ============================================

async function handlePauseExpired(
  get: GetActionState,
  set: SetActionState,
  settings: ReturnType<typeof useSettingsStore.getState>,
  ALARM_RESPONSE_TIMEOUT: number
): Promise<void> {
  const currentPauseState = get().pauseState;
  if (!currentPauseState) return;

  logger.info('session', `⏰ PAUSE EXPIRED (${settings.pauseLimitMinutes} min) - Showing alarm`);
  
  // Show ALARM notification
  const alarmNotificationId = await showPauseExpiredNotification(
    currentPauseState.locationId,
    currentPauseState.locationName,
    settings.pauseLimitMinutes
  );

  // Wait for user response, then check GPS
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
          await recordStore.registerExit(state.locationId);
          set({ pauseState: null, pendingAction: null });
        }
      } else {
        logger.warn('session', `⚠️ Could not get GPS - Ending session by default`);
        const recordStore = useRecordStore.getState();
        await recordStore.registerExit(state.locationId);
        set({ pauseState: null, pendingAction: null });
      }
    } catch (error) {
      logger.error('session', `❌ Error checking GPS after pause`, { error: String(error) });
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
}
