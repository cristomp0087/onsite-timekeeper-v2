/**
 * Background Tasks - OnSite Timekeeper v2
 * 
 * Geofencing + Adaptive Heartbeat with SAFE register/unregister.
 * 
 * REFACTORED: Logic split into backgroundTypes, taskCallbacks, geofenceLogic, heartbeatLogic
 * 
 * NOTE: TaskManager.defineTask MUST be at global scope in this file!
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';
import {
  getOptimalHeartbeatInterval,
  getHeartbeatState,
  HEARTBEAT_INTERVALS,
} from './pendingTTL';
import {
  setBackgroundUserId as _setBackgroundUserId,
  clearBackgroundUserId as _clearBackgroundUserId,
} from './backgroundHelpers';

// Import from refactored modules
import {
  GEOFENCE_TASK,
  HEARTBEAT_TASK,
  LOCATION_TASK,
  BACKGROUND_USER_KEY,
} from './backgroundTypes';

import {
  setGeofenceCallback,
  setReconcileCallback,
  clearCallbacks,
  getLocationCallback,
} from './taskCallbacks';

import { processGeofenceEvent } from './geofenceLogic';

import {
  isTaskRegistered,
  safeUnregisterTask,
  safeRegisterHeartbeat,
  maybeUpdateHeartbeatInterval,
  runHeartbeat,
} from './heartbeatLogic';

// Re-export from backgroundHelpers (used by stores)
export {
  addToSkippedToday,
  removeFromSkippedToday,
  clearSkippedToday,
  checkInsideFence,
} from './backgroundHelpers';

// ============================================
// RE-EXPORTS (only what bootstrap.ts needs)
// ============================================

export {
  setGeofenceCallback,
  setReconcileCallback,
  clearCallbacks,
} from './taskCallbacks';

// ============================================
// MODULE STATE
// ============================================

let lastUserIdSaved: string | null = null;

// ============================================
// BACKGROUND USER
// ============================================

export async function setBackgroundUserId(userId: string): Promise<void> {
  if (lastUserIdSaved === userId) {
    logger.debug('boot', `UserId unchanged, skipping save: ${userId.substring(0, 8)}...`);
    return;
  }
  
  lastUserIdSaved = userId;
  await AsyncStorage.setItem(BACKGROUND_USER_KEY, userId);
  await _setBackgroundUserId(userId);
  logger.debug('boot', `UserId saved for background: ${userId.substring(0, 8)}...`);
}

export async function clearBackgroundUserId(): Promise<void> {
  lastUserIdSaved = null;
  await AsyncStorage.removeItem(BACKGROUND_USER_KEY);
  await _clearBackgroundUserId();
  logger.debug('boot', 'Background userId cleared');
}

// ============================================
// TASK DEFINITIONS (MUST be at global scope)
// ============================================

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  // CRITICAL DEBUG: Log EVERY task invocation
  logger.info('geofence', `🔔 GEOFENCE TASK FIRED`, {
    hasError: !!error,
    hasData: !!data,
    dataKeys: data ? Object.keys(data) : [],
  });

  if (error) {
    logger.error('geofence', 'Geofence task error', { error: String(error) });
    return;
  }

  if (!data) {
    logger.warn('geofence', 'Geofence task received null data');
    return;
  }

  const eventData = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion };

  // Log event type for debugging
  logger.info('geofence', `🔔 Native event type: ${eventData.eventType}`, {
    regionId: eventData.region?.identifier ?? 'unknown',
  });

  if (eventData.eventType === Location.GeofencingEventType.Enter) {
    logger.info('geofence', '🔔 Processing ENTER event');
    await processGeofenceEvent({
      region: eventData.region,
      state: Location.GeofencingRegionState.Inside,
    });
  } else if (eventData.eventType === Location.GeofencingEventType.Exit) {
    logger.info('geofence', '🔔 Processing EXIT event');
    await processGeofenceEvent({
      region: eventData.region,
      state: Location.GeofencingRegionState.Outside,
    });
  } else {
    logger.warn('geofence', `🔔 Unknown event type: ${eventData.eventType}`);
  }
});

TaskManager.defineTask(HEARTBEAT_TASK, async () => {
  try {
    await runHeartbeat();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    logger.error('heartbeat', 'Heartbeat task error', { error: String(error) });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    logger.error('gps', 'Location task error', { error: String(error) });
    return;
  }

  const locationData = data as { locations: Location.LocationObject[] };
  
  if (!locationData?.locations?.length) return;

  const location = locationData.locations[0];
  
  logger.debug('gps', 'Background location update', {
    lat: location.coords.latitude.toFixed(6),
    lng: location.coords.longitude.toFixed(6),
  });

  const locationCallback = getLocationCallback();
  if (locationCallback) {
    try {
      locationCallback(location);
    } catch (e) {
      logger.error('gps', 'Error in location callback', { error: String(e) });
    }
  }
});

logger.info('boot', '📋 Background tasks V2 loaded (adaptive heartbeat)', {
  geofence: GEOFENCE_TASK,
  heartbeat: HEARTBEAT_TASK,
  intervals: {
    normal: `${HEARTBEAT_INTERVALS.NORMAL / 60}min`,
    pendingEnter: `${HEARTBEAT_INTERVALS.PENDING_ENTER / 60}min`,
    pendingExit: `${HEARTBEAT_INTERVALS.PENDING_EXIT / 60}min`,
  },
});

// ============================================
// PUBLIC API (used by bootstrap.ts)
// ============================================

export async function startHeartbeat(): Promise<void> {
  const registered = await isTaskRegistered(HEARTBEAT_TASK);
  
  if (registered) {
    logger.info('heartbeat', 'Heartbeat already active');
    await maybeUpdateHeartbeatInterval();
    return;
  }
  
  const interval = await getOptimalHeartbeatInterval();
  await safeRegisterHeartbeat(interval);
}

export async function stopHeartbeat(): Promise<void> {
  await safeUnregisterTask(HEARTBEAT_TASK);
  logger.info('heartbeat', 'Heartbeat stopped');
}

export async function updateHeartbeatInterval(): Promise<void> {
  await maybeUpdateHeartbeatInterval();
}
