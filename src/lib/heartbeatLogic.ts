/**
 * Heartbeat Logic - OnSite Timekeeper
 * 
 * Heartbeat execution, interval management, task registration.
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import { logger } from './logger';
import {
  loadPendingAction,
  checkAndProcessPendingTTL,
  getOptimalHeartbeatInterval,
  getHeartbeatState,
  recordLowAccuracy,
  recalculateHeartbeatInterval,
  HEARTBEAT_INTERVALS,
} from './pendingTTL';
import {
  logPingPongEvent,
  checkForPingPong,
  type PingPongEvent,
} from './backgroundHelpers';
import { getHeartbeatCallback } from './taskCallbacks';
import { HEARTBEAT_TASK } from './backgroundTypes';
import {
  localCalculateDistance,
  localCheckInsideFence,
  checkInsideFenceAsync,
  getFenceCache,
} from './geofenceLogic';

// ============================================
// HEARTBEAT STATE (module-level, internal)
// ============================================

let currentHeartbeatInterval = HEARTBEAT_INTERVALS.NORMAL;

// ============================================
// SAFE TASK MANAGEMENT
// ============================================

/**
 * Check if task is registered (used by backgroundTasks)
 */
export async function isTaskRegistered(taskName: string): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(taskName);
  } catch (error) {
    logger.warn('heartbeat', `Error checking task registration: ${taskName}`, { error: String(error) });
    return false;
  }
}

/**
 * Safely unregister a task (used by backgroundTasks)
 */
export async function safeUnregisterTask(taskName: string): Promise<boolean> {
  try {
    const registered = await isTaskRegistered(taskName);
    
    if (!registered) {
      logger.debug('heartbeat', `⚠️ Task not registered, skip unregister: ${taskName}`);
      return true; // Treat as success - already clean
    }
    
    await BackgroundFetch.unregisterTaskAsync(taskName);
    logger.debug('heartbeat', `✅ Task unregistered: ${taskName}`);
    return true;
  } catch (error) {
    logger.warn('heartbeat', `Failed to unregister task: ${taskName}`, { error: String(error) });
    return false;
  }
}

/**
 * Safely register heartbeat task (used by backgroundTasks)
 */
export async function safeRegisterHeartbeat(intervalSeconds: number): Promise<boolean> {
  try {
    // Unregister first (safely)
    await safeUnregisterTask(HEARTBEAT_TASK);
    
    // Register with new interval
    await BackgroundFetch.registerTaskAsync(HEARTBEAT_TASK, {
      minimumInterval: intervalSeconds,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    
    currentHeartbeatInterval = intervalSeconds;
    logger.info('heartbeat', `✅ Heartbeat registered: ${intervalSeconds / 60}min`);
    return true;
  } catch (error) {
    logger.error('heartbeat', 'Failed to register heartbeat', { error: String(error) });
    return false;
  }
}

// ============================================
// INTERVAL MANAGEMENT
// ============================================

/**
 * Update heartbeat interval if needed (used by backgroundTasks)
 */
export async function maybeUpdateHeartbeatInterval(): Promise<void> {
  try {
    const optimalInterval = await recalculateHeartbeatInterval();
    
    if (optimalInterval !== currentHeartbeatInterval) {
      logger.info('heartbeat', `🔄 Interval change: ${currentHeartbeatInterval / 60}min → ${optimalInterval / 60}min`);
      await safeRegisterHeartbeat(optimalInterval);
    }
  } catch (error) {
    logger.error('heartbeat', 'Failed to update interval', { error: String(error) });
  }
}

// ============================================
// HEARTBEAT EXECUTION
// ============================================

/**
 * Run heartbeat check (used by backgroundTasks)
 */
export async function runHeartbeat(): Promise<void> {
  const startTime = Date.now();
  const heartbeatState = await getHeartbeatState();
  
  logger.info('heartbeat', `💓 Heartbeat (${heartbeatState.currentInterval / 60}min, ${heartbeatState.reason})`);
  
  // Get current location
  let location: Location.LocationObject | null = null;
  try {
    location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    
    logger.info('pingpong', `💓 Heartbeat GPS`, {
      lat: location.coords.latitude.toFixed(6),
      lng: location.coords.longitude.toFixed(6),
      accuracy: location.coords.accuracy ? `${location.coords.accuracy.toFixed(1)}m` : 'N/A',
    });
    
    if (location.coords.accuracy && location.coords.accuracy > 50) {
      await recordLowAccuracy(location.coords.accuracy);
    }
  } catch (error) {
    logger.warn('heartbeat', 'Failed to get GPS', { error: String(error) });
  }
  
  // Check pending TTL
  const pending = await loadPendingAction();
  if (pending) {
    const result = await checkAndProcessPendingTTL(checkInsideFenceAsync, true);
    
    if (result.action !== 'none') {
      logger.info('heartbeat', `📋 TTL action: ${result.action}`, { reason: result.reason });
      // Action will be handled by workSessionStore
    }
  }
  
  // Verify geofence consistency
  const fenceCache = getFenceCache();
  if (location) {
    const { isInside, fenceId, fenceName, distance } = localCheckInsideFence(
      location.coords.latitude,
      location.coords.longitude
    );
    
    if (fenceCache.size > 0) {
      // Log check for all fences
      for (const [id, fence] of fenceCache.entries()) {
        const dist = localCalculateDistance(
          location.coords.latitude,
          location.coords.longitude,
          fence.lat,
          fence.lng
        );
        const effectiveRadius = fence.radius * 1.3;
        const margin = effectiveRadius - dist;
        const marginPercent = (margin / effectiveRadius) * 100;
        const inside = dist <= effectiveRadius;
        
        const pingPongEvent: PingPongEvent = {
          type: 'check',
          fenceId: id,
          fenceName: fence.name,
          timestamp: Date.now(),
          distance: dist,
          radius: fence.radius,
          effectiveRadius,
          margin,
          marginPercent,
          isInside: inside,
          gpsAccuracy: location.coords.accuracy ?? undefined,
          source: 'heartbeat',
        };
        
        await logPingPongEvent(pingPongEvent);
      }
    }
    
    if (isInside) {
      logger.info('heartbeat', `✅ Consistent: inside ${fenceName}`, { distance: `${distance?.toFixed(0)}m` });
    } else {
      logger.info('heartbeat', '✅ Consistent: outside all fences');
    }
  }
  
  // Check for ping-pong
  const { isPingPonging, recentEnters, recentExits } = await checkForPingPong();
  if (isPingPonging) {
    logger.warn('heartbeat', `🔴 PING-PONG DETECTED!`, { recentEnters, recentExits });
  } else {
    logger.debug('pingpong', `📊 Summary`, { total: recentEnters + recentExits, isPingPonging: false });
  }
  
  // Update heartbeat interval
  await maybeUpdateHeartbeatInterval();
  
  const elapsed = Date.now() - startTime;
  logger.info('heartbeat', `✅ Heartbeat completed in ${elapsed}ms`);
  
  // Call heartbeat callback if registered
  const heartbeatCallback = getHeartbeatCallback();
  if (heartbeatCallback && location) {
    try {
      const { isInside, fenceId, fenceName } = localCheckInsideFence(
        location.coords.latitude,
        location.coords.longitude
      );
      
      await heartbeatCallback({
        isInsideFence: isInside,
        fenceId: fenceId ?? null,
        fenceName: fenceName ?? null,
        location: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy ?? null,
        },
        timestamp: Date.now(),
        batteryLevel: null,
      });
    } catch (error) {
      logger.error('heartbeat', 'Error in heartbeat callback', { error: String(error) });
    }
  }
}
