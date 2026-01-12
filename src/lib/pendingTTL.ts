/**
 * Pending Action TTL - OnSite Timekeeper v2
 * 
 * Persists pending actions with timestamps, checks TTL on multiple events.
 * Manages adaptive heartbeat intervals with DEBOUNCE.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { logger } from './logger';

// ============================================
// CONSTANTS
// ============================================

const PENDING_ACTION_KEY = '@onsite/pending_action';
const HEARTBEAT_STATE_KEY = '@onsite/heartbeat_state';

// Heartbeat intervals (in seconds)
export const HEARTBEAT_INTERVALS = {
  NORMAL: 15 * 60,           // 15 min - default
  PENDING_ENTER: 2 * 60,     // 2 min - waiting for auto-start
  PENDING_EXIT: 1 * 60,      // 1 min - waiting for auto-end
  PENDING_RETURN: 2 * 60,    // 2 min - waiting for resume
  LOW_ACCURACY: 5 * 60,      // 5 min - GPS ruim
  RECENT_TRANSITION: 5 * 60, // 5 min - transição recente
} as const;

// GPS settings
const GPS_CACHE_MAX_AGE = 5000;
const GPS_REQUIRED_ACCURACY = 50;

// DEBOUNCE - prevent rapid interval changes
const INTERVAL_CHANGE_DEBOUNCE_MS = 30000; // 30 seconds

// ============================================
// TYPES
// ============================================

export type PendingActionType = 'enter' | 'exit' | 'return';

export interface PersistedPendingAction {
  type: PendingActionType;
  locationId: string;
  locationName: string;
  notificationId: string | null;
  createdAt: number;
  timeoutMs: number;
  coords?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
}

export interface PendingTTLResult {
  action: 'auto_start' | 'auto_end' | 'auto_resume' | 'drop' | 'none';
  pending: PersistedPendingAction | null;
  reason?: string;
  freshGPS?: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    isInsideFence: boolean;
  };
}

export interface HeartbeatState {
  currentInterval: number;
  reason: string;
  lastTransitionAt: number | null;
  lastLowAccuracyAt: number | null;
  lastIntervalChangeAt: number | null; // For debounce
}

// ============================================
// PENDING PERSISTENCE
// ============================================

export async function savePendingAction(pending: PersistedPendingAction): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(pending));
    logger.info('ttl', `💾 Pending saved: ${pending.type} @ ${pending.locationName}`, {
      timeoutMs: pending.timeoutMs,
    });
    
    // Update heartbeat to faster interval
    await updateHeartbeatForPending(pending.type);
  } catch (error) {
    logger.error('ttl', 'Failed to save pending', { error: String(error) });
  }
}

export async function loadPendingAction(): Promise<PersistedPendingAction | null> {
  try {
    const data = await AsyncStorage.getItem(PENDING_ACTION_KEY);
    if (!data) return null;
    return JSON.parse(data) as PersistedPendingAction;
  } catch (error) {
    logger.error('ttl', 'Failed to load pending', { error: String(error) });
    return null;
  }
}

export async function clearPendingAction(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_ACTION_KEY);
    logger.debug('ttl', '🗑️ Pending cleared');
    
    // Reset heartbeat to normal (unless other conditions apply)
    await recalculateHeartbeatInterval();
  } catch (error) {
    logger.error('ttl', 'Failed to clear pending', { error: String(error) });
  }
}

export function isPendingExpired(pending: PersistedPendingAction): boolean {
  return Date.now() - pending.createdAt >= pending.timeoutMs;
}

export function getPendingTimeRemaining(pending: PersistedPendingAction): number {
  return Math.max(0, pending.timeoutMs - (Date.now() - pending.createdAt));
}

// ============================================
// HEARTBEAT ADAPTIVE INTERVAL
// ============================================

export async function getHeartbeatState(): Promise<HeartbeatState> {
  try {
    const data = await AsyncStorage.getItem(HEARTBEAT_STATE_KEY);
    if (data) {
      return JSON.parse(data) as HeartbeatState;
    }
  } catch (error) {
    logger.error('ttl', 'Failed to load heartbeat state', { error: String(error) });
  }
  
  // Default state
  return {
    currentInterval: HEARTBEAT_INTERVALS.NORMAL,
    reason: 'normal',
    lastTransitionAt: null,
    lastLowAccuracyAt: null,
    lastIntervalChangeAt: null,
  };
}

async function saveHeartbeatState(state: HeartbeatState): Promise<void> {
  try {
    await AsyncStorage.setItem(HEARTBEAT_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    logger.error('ttl', 'Failed to save heartbeat state', { error: String(error) });
  }
}

/**
 * Get optimal heartbeat interval based on current state
 */
export async function getOptimalHeartbeatInterval(): Promise<number> {
  const state = await getHeartbeatState();
  return state.currentInterval;
}

/**
 * Update heartbeat when pending action is created
 */
async function updateHeartbeatForPending(pendingType: PendingActionType): Promise<void> {
  const state = await getHeartbeatState();
  
  let newInterval: number;
  let reason: string;
  
  switch (pendingType) {
    case 'enter':
      newInterval = HEARTBEAT_INTERVALS.PENDING_ENTER;
      reason = 'pending_enter';
      break;
    case 'exit':
      newInterval = HEARTBEAT_INTERVALS.PENDING_EXIT;
      reason = 'pending_exit';
      break;
    case 'return':
      newInterval = HEARTBEAT_INTERVALS.PENDING_RETURN;
      reason = 'pending_return';
      break;
    default:
      return;
  }
  
  // Skip if same interval
  if (state.currentInterval === newInterval) {
    return;
  }
  
  // Pending actions bypass debounce (they're time-critical)
  logger.info('ttl', `⚡ HB: ${state.currentInterval / 60}min → ${newInterval / 60}min (${reason})`);
  
  await saveHeartbeatState({
    ...state,
    currentInterval: newInterval,
    reason,
    lastIntervalChangeAt: Date.now(),
  });
}

/**
 * Record a geofence transition (for adaptive interval)
 */
export async function recordTransition(): Promise<void> {
  const state = await getHeartbeatState();
  await saveHeartbeatState({
    ...state,
    lastTransitionAt: Date.now(),
  });
  await recalculateHeartbeatInterval();
}

/**
 * Record low GPS accuracy (for adaptive interval)
 */
export async function recordLowAccuracy(accuracy: number): Promise<void> {
  if (accuracy > 50) {
    const state = await getHeartbeatState();
    
    // Only update if not already recorded recently
    if (!state.lastLowAccuracyAt || (Date.now() - state.lastLowAccuracyAt) > 60000) {
      await saveHeartbeatState({
        ...state,
        lastLowAccuracyAt: Date.now(),
      });
      await recalculateHeartbeatInterval();
    }
  }
}

/**
 * Recalculate heartbeat interval based on current conditions
 * WITH DEBOUNCE to prevent rapid changes
 */
export async function recalculateHeartbeatInterval(): Promise<number> {
  const pending = await loadPendingAction();
  const state = await getHeartbeatState();
  
  let newInterval = HEARTBEAT_INTERVALS.NORMAL;
  let reason = 'normal';
  
  // Priority 1: Active pending action
  if (pending) {
    switch (pending.type) {
      case 'enter':
        newInterval = HEARTBEAT_INTERVALS.PENDING_ENTER;
        reason = 'pending_enter';
        break;
      case 'exit':
        newInterval = HEARTBEAT_INTERVALS.PENDING_EXIT;
        reason = 'pending_exit';
        break;
      case 'return':
        newInterval = HEARTBEAT_INTERVALS.PENDING_RETURN;
        reason = 'pending_return';
        break;
    }
  }
  // Priority 2: Recent transition (last 10 min)
  else if (state.lastTransitionAt && (Date.now() - state.lastTransitionAt) < 10 * 60 * 1000) {
    newInterval = HEARTBEAT_INTERVALS.RECENT_TRANSITION;
    reason = 'recent_transition';
  }
  // Priority 3: Recent low accuracy (last 15 min)
  else if (state.lastLowAccuracyAt && (Date.now() - state.lastLowAccuracyAt) < 15 * 60 * 1000) {
    newInterval = HEARTBEAT_INTERVALS.LOW_ACCURACY;
    reason = 'low_accuracy';
  }
  
  // Check if change is needed
  if (state.currentInterval === newInterval && state.reason === reason) {
    return state.currentInterval; // No change needed
  }
  
  // DEBOUNCE: Skip if changed recently (except for pending actions which are time-critical)
  const timeSinceLastChange = state.lastIntervalChangeAt 
    ? Date.now() - state.lastIntervalChangeAt 
    : Infinity;
    
  if (timeSinceLastChange < INTERVAL_CHANGE_DEBOUNCE_MS && !pending) {
    logger.debug('ttl', `⏳ Debounce: skipping interval change (${timeSinceLastChange}ms < ${INTERVAL_CHANGE_DEBOUNCE_MS}ms)`);
    return state.currentInterval;
  }
  
  // Apply change
  logger.info('ttl', `🔄 HB: ${state.currentInterval / 60}min → ${newInterval / 60}min (${reason})`);
  
  await saveHeartbeatState({
    ...state,
    currentInterval: newInterval,
    reason,
    lastIntervalChangeAt: Date.now(),
  });
  
  return newInterval;
}

// ============================================
// GPS HELPER
// ============================================

async function getGPSLocation(): Promise<Location.LocationObject | null> {
  try {
    // Try cached location first
    const cached = await Location.getLastKnownPositionAsync({
      maxAge: GPS_CACHE_MAX_AGE,
      requiredAccuracy: GPS_REQUIRED_ACCURACY,
    });
    
    if (cached) {
      logger.debug('ttl', '📍 Using cached GPS', {
        age: `${Date.now() - cached.timestamp}ms`,
        accuracy: cached.coords.accuracy ? `${cached.coords.accuracy.toFixed(1)}m` : 'N/A',
      });
      return cached;
    }
    
    // Get fresh location
    logger.debug('ttl', '📍 Getting fresh GPS...');
    const fresh = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    
    return fresh;
  } catch (error) {
    logger.warn('ttl', '⚠️ Could not get GPS', { error: String(error) });
    return null;
  }
}

// ============================================
// TTL CHECK & PROCESS
// ============================================

export async function checkAndProcessPendingTTL(
  checkInsideFence: (lat: number, lng: number) => Promise<{ isInside: boolean; fenceId?: string }>,
  getFreshGPS: boolean = true
): Promise<PendingTTLResult> {
  const pending = await loadPendingAction();
  
  if (!pending) {
    return { action: 'none', pending: null };
  }
  
  if (!isPendingExpired(pending)) {
    const remaining = getPendingTimeRemaining(pending);
    logger.debug('ttl', `⏳ Pending not expired: ${pending.type} @ ${pending.locationName}`, {
      remainingSec: Math.round(remaining / 1000),
    });
    return { action: 'none', pending };
  }
  
  logger.info('ttl', `⏰ Pending EXPIRED: ${pending.type} @ ${pending.locationName}`, {
    elapsed: Date.now() - pending.createdAt,
  });
  
  // Get GPS
  let freshGPS: PendingTTLResult['freshGPS'] | undefined;
  
  if (getFreshGPS) {
    const location = await getGPSLocation();
    
    if (location) {
      const { latitude, longitude, accuracy } = location.coords;
      const { isInside } = await checkInsideFence(latitude, longitude);
      
      freshGPS = {
        latitude,
        longitude,
        accuracy: accuracy ?? null,
        isInsideFence: isInside,
      };
      
      if (accuracy && accuracy > 50) {
        await recordLowAccuracy(accuracy);
      }
      
      logger.info('ttl', `📍 GPS obtained`, {
        accuracy: accuracy ? `${accuracy.toFixed(1)}m` : 'N/A',
        isInsideFence: isInside,
      });
    }
  }
  
  // Decide action
  let result: PendingTTLResult;
  
  switch (pending.type) {
    case 'enter':
      if (freshGPS) {
        result = freshGPS.isInsideFence
          ? { action: 'auto_start', pending, reason: 'GPS confirms inside', freshGPS }
          : { action: 'drop', pending, reason: 'GPS shows outside - user left', freshGPS };
      } else {
        result = { action: 'auto_start', pending, reason: 'No GPS - assuming inside' };
      }
      break;
      
    case 'exit':
      if (freshGPS) {
        result = freshGPS.isInsideFence
          ? { action: 'drop', pending, reason: 'GPS shows inside - user returned', freshGPS }
          : { action: 'auto_end', pending, reason: 'GPS confirms outside', freshGPS };
      } else {
        result = { action: 'auto_end', pending, reason: 'No GPS - assuming outside' };
      }
      break;
      
    case 'return':
      if (freshGPS) {
        result = freshGPS.isInsideFence
          ? { action: 'auto_resume', pending, reason: 'GPS confirms inside', freshGPS }
          : { action: 'drop', pending, reason: 'GPS shows outside - user left', freshGPS };
      } else {
        result = { action: 'auto_resume', pending, reason: 'No GPS - assuming inside' };
      }
      break;
      
    default:
      result = { action: 'drop', pending, reason: `Unknown type: ${pending.type}` };
  }
  
  // Clear pending
  await clearPendingAction();
  
  // Record transition
  await recordTransition();
  
  logger.info('ttl', `✅ TTL decision: ${result.action}`, {
    type: pending.type,
    reason: result.reason,
  });
  
  return result;
}

// ============================================
// HELPERS
// ============================================

export function createEnterPending(
  locationId: string,
  locationName: string,
  notificationId: string | null,
  timeoutMs: number,
  coords?: { latitude: number; longitude: number; accuracy?: number }
): PersistedPendingAction {
  return { type: 'enter', locationId, locationName, notificationId, createdAt: Date.now(), timeoutMs, coords };
}

export function createExitPending(
  locationId: string,
  locationName: string,
  notificationId: string | null,
  timeoutMs: number,
  coords?: { latitude: number; longitude: number; accuracy?: number }
): PersistedPendingAction {
  return { type: 'exit', locationId, locationName, notificationId, createdAt: Date.now(), timeoutMs, coords };
}

export function createReturnPending(
  locationId: string,
  locationName: string,
  notificationId: string | null,
  timeoutMs: number,
  coords?: { latitude: number; longitude: number; accuracy?: number }
): PersistedPendingAction {
  return { type: 'return', locationId, locationName, notificationId, createdAt: Date.now(), timeoutMs, coords };
}

export async function getPendingStatus(): Promise<{
  hasPending: boolean;
  type?: PendingActionType;
  locationName?: string;
  isExpired?: boolean;
  remainingMs?: number;
  heartbeatInterval?: number;
  heartbeatReason?: string;
}> {
  const pending = await loadPendingAction();
  const heartbeat = await getHeartbeatState();
  
  if (!pending) {
    return { 
      hasPending: false,
      heartbeatInterval: heartbeat.currentInterval,
      heartbeatReason: heartbeat.reason,
    };
  }
  
  return {
    hasPending: true,
    type: pending.type,
    locationName: pending.locationName,
    isExpired: isPendingExpired(pending),
    remainingMs: getPendingTimeRemaining(pending),
    heartbeatInterval: heartbeat.currentInterval,
    heartbeatReason: heartbeat.reason,
  };
}
