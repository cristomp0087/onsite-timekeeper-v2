/**
 * Background Tasks - OnSite Timekeeper
 * 
 * Tasks that run in background:
 * - GEOFENCE_TASK: Detects entry/exit (real time, via OS)
 * - LOCATION_TASK: Position updates
 * - HEARTBEAT_TASK: Checks every 15 min if still in fence (safety net)
 * 
 * IMPORTANT: 
 * - Import in entry point BEFORE using
 * - Tasks process DIRECTLY to database, without depending on callbacks
 *   (callbacks are optional, to update UI when app is active)
 * 
 * REFACTORED: All PT names removed, English only
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';
import { LOCATION_TASK_NAME, GEOFENCE_TASK_NAME } from './location';

// ============================================
// DATABASE IMPORTS (direct processing)
// ============================================

import {
  getGlobalActiveSession,
  createEntryRecord,
  registerExit,
  getLocations,
  registerGeopoint,
  registerHeartbeat,
} from './database';

// ============================================
// CONSTANTS
// ============================================

export const HEARTBEAT_TASK_NAME = 'onsite-heartbeat-task';
export const HEARTBEAT_INTERVAL = 15 * 60; // 15 minutes in seconds
const HYSTERESIS_ENTRY = 1.0; // Entry uses normal radius
const HYSTERESIS_EXIT = 1.3; // Exit uses radius × 1.3 (prevents ping-pong)
const USER_ID_KEY = '@onsite:userId'; // Key to persist userId
const SKIPPED_TODAY_KEY = '@onsite:skippedToday'; // Key to persist skipped locations

// ============================================
// TYPES
// ============================================

export interface GeofenceEvent {
  type: 'enter' | 'exit';
  regionIdentifier: string;
  timestamp: number;
}

export interface HeartbeatResult {
  isInsideFence: boolean;
  fenceId: string | null;
  fenceName: string | null;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null;
  timestamp: number;
  batteryLevel: number | null;
}

export interface ActiveFence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

// ============================================
// CALLBACKS (OPTIONAL - to update UI)
// ============================================

type GeofenceCallback = (event: GeofenceEvent) => void;
type LocationCallback = (location: Location.LocationObject) => void;
type HeartbeatCallback = (result: HeartbeatResult) => Promise<void>;

let onGeofenceEvent: GeofenceCallback | null = null;
let onLocationUpdate: LocationCallback | null = null;
let onHeartbeat: HeartbeatCallback | null = null;

// Cache of fences (updated when app is active)
let activeFencesCache: ActiveFence[] = [];

/**
 * Register callback for geofence events (optional, for UI)
 */
export function setGeofenceCallback(callback: GeofenceCallback): void {
  onGeofenceEvent = callback;
  logger.debug('geofence', 'Geofence callback registered');
}

/**
 * Register callback for location updates (optional, for UI)
 */
export function setLocationCallback(callback: LocationCallback): void {
  onLocationUpdate = callback;
  logger.debug('gps', 'Location callback registered');
}

/**
 * Register callback for heartbeat (optional, for UI)
 */
export function setHeartbeatCallback(callback: HeartbeatCallback): void {
  onHeartbeat = callback;
  logger.debug('heartbeat', 'Heartbeat callback registered');
}

/**
 * Update active fences cache
 */
export function updateActiveFences(fences: ActiveFence[]): void {
  activeFencesCache = fences;
  logger.debug('heartbeat', `Fences in cache: ${fences.length}`);
}

/**
 * Return fences from cache
 */
export function getActiveFences(): ActiveFence[] {
  return activeFencesCache;
}

/**
 * Remove callbacks (cleanup)
 */
export function clearCallbacks(): void {
  onGeofenceEvent = null;
  onLocationUpdate = null;
  onHeartbeat = null;
  logger.debug('gps', 'Callbacks removed');
}

// ============================================
// USER ID PERSISTENCE
// ============================================

/**
 * Save userId for background use
 * Call when user logs in
 */
export async function setBackgroundUserId(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_ID_KEY, userId);
    logger.debug('boot', `UserId saved for background: ${userId.substring(0, 8)}...`);
  } catch (error) {
    logger.error('boot', 'Error saving userId', { error: String(error) });
  }
}

/**
 * Remove userId (call on logout)
 */
export async function clearBackgroundUserId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_ID_KEY);
    logger.debug('boot', 'UserId removed');
  } catch (error) {
    logger.error('boot', 'Error removing userId', { error: String(error) });
  }
}

/**
 * Retrieve userId for background processing
 */
async function getBackgroundUserId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(USER_ID_KEY);
  } catch (error) {
    logger.error('heartbeat', 'Error retrieving userId', { error: String(error) });
    return null;
  }
}

// ============================================
// SKIPPED TODAY PERSISTENCE
// ============================================

/**
 * Structure of persisted skippedToday
 */
interface SkippedTodayData {
  date: string; // YYYY-MM-DD
  locationIds: string[];
}

/**
 * Retrieve list of locations ignored today
 */
async function getSkippedToday(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(SKIPPED_TODAY_KEY);
    if (!data) return [];
    
    const parsed: SkippedTodayData = JSON.parse(data);
    const today = new Date().toISOString().split('T')[0];
    
    // If from another day, return empty (automatic reset)
    if (parsed.date !== today) {
      return [];
    }
    
    return parsed.locationIds;
  } catch (error) {
    logger.error('geofence', 'Error retrieving skippedToday', { error: String(error) });
    return [];
  }
}

/**
 * Add location to ignored today list
 */
export async function addToSkippedToday(locationId: string): Promise<void> {
  try {
    const current = await getSkippedToday();
    if (current.includes(locationId)) return;
    
    const today = new Date().toISOString().split('T')[0];
    const data: SkippedTodayData = {
      date: today,
      locationIds: [...current, locationId],
    };
    
    await AsyncStorage.setItem(SKIPPED_TODAY_KEY, JSON.stringify(data));
    logger.debug('geofence', `Location ${locationId} added to skippedToday`);
  } catch (error) {
    logger.error('geofence', 'Error adding to skippedToday', { error: String(error) });
  }
}

/**
 * Remove location from ignored list (when exiting fence)
 */
export async function removeFromSkippedToday(locationId: string): Promise<void> {
  try {
    const current = await getSkippedToday();
    if (!current.includes(locationId)) return;
    
    const today = new Date().toISOString().split('T')[0];
    const data: SkippedTodayData = {
      date: today,
      locationIds: current.filter(id => id !== locationId),
    };
    
    await AsyncStorage.setItem(SKIPPED_TODAY_KEY, JSON.stringify(data));
    logger.debug('geofence', `Location ${locationId} removed from skippedToday`);
  } catch (error) {
    logger.error('geofence', 'Error removing from skippedToday', { error: String(error) });
  }
}

/**
 * Clear entire ignored list
 */
export async function clearSkippedToday(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SKIPPED_TODAY_KEY);
    logger.debug('geofence', 'skippedToday cleared');
  } catch (error) {
    logger.error('geofence', 'Error clearing skippedToday', { error: String(error) });
  }
}

/**
 * Check if location is in ignored today list
 */
async function isLocationSkippedToday(locationId: string): Promise<boolean> {
  const skipped = await getSkippedToday();
  return skipped.includes(locationId);
}

// ============================================
// HELPER: Calculate distance (Haversine)
// ============================================

function calculateDistance(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Fetch fences from database (when cache is empty)
 */
async function getFencesFromDb(userId: string): Promise<ActiveFence[]> {
  try {
    const locations = await getLocations(userId);
    return locations.map(l => ({
      id: l.id,
      name: l.name,
      latitude: l.latitude,
      longitude: l.longitude,
      radius: l.radius,
    }));
  } catch (error) {
    logger.error('geofence', 'Error fetching fences from database', { error: String(error) });
    return [];
  }
}

/**
 * Check which fence the point is inside
 */
async function checkInsideFence(
  latitude: number, 
  longitude: number,
  userId: string,
  useHysteresis: boolean = false
): Promise<{ isInside: boolean; fence: ActiveFence | null }> {
  // Use cache if available, otherwise fetch from database
  let fences = activeFencesCache;
  if (fences.length === 0) {
    fences = await getFencesFromDb(userId);
  }

  for (const fence of fences) {
    const distance = calculateDistance(
      latitude, 
      longitude, 
      fence.latitude, 
      fence.longitude
    );
    
    const hysteresisFactor = useHysteresis ? HYSTERESIS_EXIT : HYSTERESIS_ENTRY;
    const effectiveRadius = fence.radius * hysteresisFactor;
    
    if (distance <= effectiveRadius) {
      return { isInside: true, fence };
    }
  }
  return { isInside: false, fence: null };
}

/**
 * Find fence by ID
 */
async function getFenceById(fenceId: string, userId: string): Promise<ActiveFence | null> {
  let fences = activeFencesCache;
  if (fences.length === 0) {
    fences = await getFencesFromDb(userId);
  }
  return fences.find(f => f.id === fenceId) || null;
}

// ============================================
// TASK: GEOFENCING (Native) - PROCESSES DIRECTLY
// ============================================

TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  const startTime = Date.now();
  logger.info('geofence', '🎯 Geofence task executing...');

  if (error) {
    logger.error('geofence', 'Error in geofence task', { error: error.message });
    return;
  }

  if (!data) {
    logger.warn('geofence', 'Task executed without data');
    return;
  }

  const { eventType, region } = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };

  const isEnter = eventType === Location.GeofencingEventType.Enter;
  const fenceId = region.identifier || 'unknown';

  logger.info('geofence', `📍 Event: ${isEnter ? 'ENTRY' : 'EXIT'} - ${fenceId}`);

  // ============================================
  // DIRECT PROCESSING (without depending on callback)
  // ============================================

  try {
    const userId = await getBackgroundUserId();
    
    if (!userId) {
      logger.warn('geofence', '⚠️ UserId not found - user not logged in?');
      return;
    }

    const fence = await getFenceById(fenceId, userId);
    
    if (!fence) {
      logger.warn('geofence', `⚠️ Fence not found: ${fenceId}`);
      return;
    }

    if (isEnter) {
      // ========== ENTRY ==========
      // Check if location was ignored today
      if (await isLocationSkippedToday(fenceId)) {
        logger.info('geofence', `😴 Location "${fence.name}" ignored today, skipping entry`);
        return;
      }
      
      // Check if already has active session for this fence
      const activeSession = await getGlobalActiveSession(userId);
      
      if (activeSession && activeSession.location_id === fenceId) {
        logger.info('geofence', '📍 Already has active session for this fence, ignoring');
      } else if (activeSession) {
        logger.warn('geofence', `⚠️ Already has active session at another location: ${activeSession.location_name}`);
        // Could close the previous and open new, but for safety only log
      } else {
        // Register entry
        logger.info('geofence', `✅ Registering ENTRY at "${fence.name}"`);
        await createEntryRecord({
          userId,
          locationId: fence.id,
          locationName: fence.name,
          type: 'automatic',
        });
      }
    } else {
      // ========== EXIT ==========
      // Remove from skippedToday when exiting (allows new entry next time)
      await removeFromSkippedToday(fenceId);
      
      const activeSession = await getGlobalActiveSession(userId);
      
      if (activeSession && activeSession.location_id === fenceId) {
        logger.info('geofence', `✅ Registering EXIT from "${fence.name}"`);
        await registerExit(userId, fenceId);
      } else if (activeSession) {
        logger.warn('geofence', `⚠️ Exit from fence different from active session`);
      } else {
        logger.debug('geofence', 'No active session to close');
      }
    }

    // ============================================
    // OPTIONAL CALLBACK (to update UI)
    // ============================================
    if (onGeofenceEvent) {
      const event: GeofenceEvent = {
        type: isEnter ? 'enter' : 'exit',
        regionIdentifier: fenceId,
        timestamp: Date.now(),
      };
      onGeofenceEvent(event);
    }

    const duration = Date.now() - startTime;
    logger.info('geofence', `✅ Geofence task completed in ${duration}ms`);

  } catch (error) {
    logger.error('geofence', 'Error processing geofence', { error: String(error) });
  }
});

// ============================================
// TASK: LOCATION (Background updates)
// ============================================

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    logger.error('gps', 'Error in location task', { error: error.message });
    return;
  }

  if (!data) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  const location = locations[0];

  if (!location) return;

  logger.debug('gps', `📍 Background location: ${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)}`);

  // ============================================
  // OPTIONAL CALLBACK (to update UI)
  // ============================================
  if (onLocationUpdate) {
    onLocationUpdate(location);
  }

  // Register geopoint
  try {
    const userId = await getBackgroundUserId();
    if (userId) {
      const activeSession = await getGlobalActiveSession(userId);
      
      await registerGeopoint(
        userId,
        location.coords.latitude,
        location.coords.longitude,
        location.coords.accuracy ?? null,
        'background',
        false, // insideFence will be determined later
        null,
        null,
        activeSession?.id || null
      );
    }
  } catch (error) {
    logger.error('gps', 'Error registering geopoint', { error: String(error) });
  }
});

// ============================================
// TASK: HEARTBEAT (Safety net)
// ============================================

TaskManager.defineTask(HEARTBEAT_TASK_NAME, async () => {
  const startTime = Date.now();
  logger.info('heartbeat', '💓 Heartbeat task executing...');

  try {
    const userId = await getBackgroundUserId();
    
    if (!userId) {
      logger.warn('heartbeat', '⚠️ UserId not found - skipping heartbeat');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Get current location
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude, accuracy } = location.coords;
    logger.info('heartbeat', `📍 Location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);

    // Check if inside any fence
    const { isInside, fence } = await checkInsideFence(latitude, longitude, userId, true);

    // Get active session
    const activeSession = await getGlobalActiveSession(userId);

    // Register heartbeat in database
    await registerHeartbeat(
      userId,
      latitude,
      longitude,
      accuracy ?? null,
      isInside,
      fence?.id ?? null,
      fence?.name ?? null,
      activeSession?.id ?? null,
      null // batteryLevel
    );

    // ============================================
    // INCONSISTENCY DETECTION
    // ============================================

    // Case 1: INSIDE fence but WITHOUT active session
    // → Missed entry! Register now.
    if (isInside && fence && !activeSession) {
      // Check if location was ignored today
      if (await isLocationSkippedToday(fence.id)) {
        logger.info('heartbeat', `😴 Location "${fence.name}" ignored today`);
      } else {
        logger.warn('heartbeat', `⚠️ MISSED ENTRY detected! Registering entry at "${fence.name}"`);
        
        await createEntryRecord({
          userId,
          locationId: fence.id,
          locationName: fence.name,
          type: 'automatic',
        });

        // Register geopoint marking the detection
        await registerGeopoint(
          userId,
          latitude,
          longitude,
          accuracy ?? null,
          'heartbeat',
          true,
          fence.id,
          fence.name,
          null // sessionId will be from new session
        );
      }
    }

    // Case 2: OUTSIDE all fences but WITH active session
    // → Missed exit! Register now.
    if (!isInside && activeSession) {
      logger.warn('heartbeat', `⚠️ MISSED EXIT detected! Registering exit from "${activeSession.location_name}"`);
      
      await registerExit(userId, activeSession.location_id);
      
      // Register geopoint marking the detection
      await registerGeopoint(
        userId,
        latitude,
        longitude,
        accuracy ?? null,
        'heartbeat',
        false,
        null,
        null,
        activeSession.id
      );
    }

    // Case 3: Everything consistent
    if ((isInside && activeSession) || (!isInside && !activeSession)) {
      logger.info('heartbeat', `✅ Consistent state: ${isInside ? `inside "${fence?.name}"` : 'outside all fences'}`);
    }

    const duration = Date.now() - startTime;
    logger.info('heartbeat', `✅ Heartbeat completed in ${duration}ms`);

    // ============================================
    // OPTIONAL CALLBACK (to update UI)
    // ============================================

    const result: HeartbeatResult = {
      isInsideFence: isInside,
      fenceId: fence?.id ?? null,
      fenceName: fence?.name ?? null,
      location: { latitude, longitude, accuracy: accuracy ?? null },
      timestamp: Date.now(),
      batteryLevel: null,
    };

    if (onHeartbeat) {
      try {
        await onHeartbeat(result);
      } catch (e) {
        logger.error('heartbeat', 'Error in heartbeat callback', { error: String(e) });
      }
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;

  } catch (error) {
    logger.error('heartbeat', 'Error in heartbeat', { error: String(error) });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ============================================
// HEARTBEAT CONTROL FUNCTIONS
// ============================================

/**
 * Start periodic heartbeat
 */
export async function startHeartbeat(): Promise<boolean> {
  try {
    // Check if BackgroundFetch is available
    const status = await BackgroundFetch.getStatusAsync();
    
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) {
      logger.warn('heartbeat', 'BackgroundFetch restricted by system');
      return false;
    }
    
    if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      logger.warn('heartbeat', 'BackgroundFetch denied by user');
      return false;
    }

    // Check if already registered
    const isRegistered = await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME);
    if (isRegistered) {
      logger.info('heartbeat', 'Heartbeat already active');
      return true;
    }

    // Register task
    await BackgroundFetch.registerTaskAsync(HEARTBEAT_TASK_NAME, {
      minimumInterval: HEARTBEAT_INTERVAL,
      stopOnTerminate: false,
      startOnBoot: true,
    });

    logger.info('heartbeat', `✅ Heartbeat started (interval: ${HEARTBEAT_INTERVAL / 60} min)`);
    return true;
  } catch (error) {
    logger.error('heartbeat', 'Error starting heartbeat', { error: String(error) });
    return false;
  }
}

/**
 * Stop heartbeat
 */
export async function stopHeartbeat(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(HEARTBEAT_TASK_NAME);
      logger.info('heartbeat', '⏹️ Heartbeat stopped');
    }
  } catch (error) {
    logger.error('heartbeat', 'Error stopping heartbeat', { error: String(error) });
  }
}

/**
 * Execute heartbeat manually (for tests)
 */
export async function executeHeartbeatNow(): Promise<HeartbeatResult | null> {
  try {
    logger.info('heartbeat', '🔄 Executing manual heartbeat...');
    
    const userId = await getBackgroundUserId();
    if (!userId) {
      logger.warn('heartbeat', 'UserId not found for manual heartbeat');
      return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude, accuracy } = location.coords;
    const { isInside, fence } = await checkInsideFence(latitude, longitude, userId, true);

    const result: HeartbeatResult = {
      isInsideFence: isInside,
      fenceId: fence?.id ?? null,
      fenceName: fence?.name ?? null,
      location: { latitude, longitude, accuracy: accuracy ?? null },
      timestamp: Date.now(),
      batteryLevel: null,
    };

    // Process inconsistencies also in manual
    const activeSession = await getGlobalActiveSession(userId);

    if (isInside && fence && !activeSession) {
      // Check if location was ignored today
      if (await isLocationSkippedToday(fence.id)) {
        logger.info('heartbeat', `😴 Location "${fence.name}" ignored today`);
      } else {
        logger.warn('heartbeat', `⚠️ Missed entry detected: ${fence.name}`);
        await createEntryRecord({
          userId,
          locationId: fence.id,
          locationName: fence.name,
          type: 'automatic',
        });
      }
    }

    if (!isInside && activeSession) {
      logger.warn('heartbeat', `⚠️ Missed exit detected: ${activeSession.location_name}`);
      await registerExit(userId, activeSession.location_id);
    }

    if (onHeartbeat) {
      await onHeartbeat(result);
    }

    return result;
  } catch (error) {
    logger.error('heartbeat', 'Error in manual heartbeat', { error: String(error) });
    return null;
  }
}

// ============================================
// STATUS CHECKS
// ============================================

export async function isGeofencingTaskRunning(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK_NAME);
  } catch {
    return false;
  }
}

export async function isLocationTaskRunning(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

export async function isHeartbeatRunning(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME);
  } catch {
    return false;
  }
}

export async function getRegisteredTasks(): Promise<TaskManager.TaskManagerTask[]> {
  try {
    return await TaskManager.getRegisteredTasksAsync();
  } catch {
    return [];
  }
}

/**
 * Complete tasks status
 */
export async function getTasksStatus(): Promise<{
  geofencing: boolean;
  location: boolean;
  heartbeat: boolean;
  activeFences: number;
  backgroundFetchStatus: string;
  hasUserId: boolean;
}> {
  const [geofencing, location, heartbeat, bgStatus, userId] = await Promise.all([
    isGeofencingTaskRunning(),
    isLocationTaskRunning(),
    isHeartbeatRunning(),
    BackgroundFetch.getStatusAsync(),
    getBackgroundUserId(),
  ]);

  const statusNames = {
    [BackgroundFetch.BackgroundFetchStatus.Restricted]: 'Restricted',
    [BackgroundFetch.BackgroundFetchStatus.Denied]: 'Denied',
    [BackgroundFetch.BackgroundFetchStatus.Available]: 'Available',
  };

  return {
    geofencing,
    location,
    heartbeat,
    activeFences: activeFencesCache.length,
    backgroundFetchStatus: bgStatus !== null ? statusNames[bgStatus] : 'Unknown',
    hasUserId: !!userId,
  };
}

// ============================================
// INITIALIZATION LOG
// ============================================

logger.info('boot', '📋 Background tasks defined', {
  geofence: GEOFENCE_TASK_NAME,
  location: LOCATION_TASK_NAME,
  heartbeat: HEARTBEAT_TASK_NAME,
  heartbeatInterval: `${HEARTBEAT_INTERVAL / 60} min`,
  hysteresisExit: `${HYSTERESIS_EXIT}x`,
});
