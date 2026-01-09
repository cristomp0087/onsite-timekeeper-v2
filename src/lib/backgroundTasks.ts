/**
 * Background Tasks - OnSite Timekeeper V2
 * 
 * Tasks that run in background:
 * - GEOFENCE_TASK: Detects entry/exit (real time, via OS)
 * - LOCATION_TASK: Position updates
 * - HEARTBEAT_TASK: Checks every 15 min if still in fence (safety net)
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';
import { LOCATION_TASK_NAME, GEOFENCE_TASK_NAME } from './location';

// ============================================
// DATABASE IMPORTS (V2)
// ============================================

import {
  getGlobalActiveSession,
  createEntryRecord,
  registerExit,
  getLocations,
  // V2: New imports
  trackMetric,
  trackGeofenceTrigger,
  recordEntryAudit,
  recordExitAudit,
  captureGeofenceError,
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

interface SkippedTodayData {
  date: string;
  locationIds: string[];
}

async function getSkippedToday(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(SKIPPED_TODAY_KEY);
    if (!data) return [];
    
    const parsed: SkippedTodayData = JSON.parse(data);
    const today = new Date().toISOString().split('T')[0];
    
    if (parsed.date !== today) {
      return [];
    }
    
    return parsed.locationIds;
  } catch (error) {
    logger.error('geofence', 'Error retrieving skippedToday', { error: String(error) });
    return [];
  }
}

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

export async function clearSkippedToday(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SKIPPED_TODAY_KEY);
    logger.debug('geofence', 'skippedToday cleared');
  } catch (error) {
    logger.error('geofence', 'Error clearing skippedToday', { error: String(error) });
  }
}

async function isLocationSkippedToday(locationId: string): Promise<boolean> {
  const skipped = await getSkippedToday();
  return skipped.includes(locationId);
}

// ============================================
// HELPER: Check if inside any fence
// ============================================

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

async function checkInsideFence(
  latitude: number,
  longitude: number,
  userId: string,
  useHysteresis: boolean = false
): Promise<{ isInside: boolean; fence: ActiveFence | null }> {
  // Try cache first
  let fences = activeFencesCache;
  
  // If cache empty, load from DB
  if (fences.length === 0) {
    try {
      const locations = await getLocations(userId);
      fences = locations
        .filter(l => l.status === 'active')
        .map(l => ({
          id: l.id,
          name: l.name,
          latitude: l.latitude,
          longitude: l.longitude,
          radius: l.radius,
        }));
      activeFencesCache = fences;
    } catch (error) {
      logger.error('heartbeat', 'Error loading fences', { error: String(error) });
      return { isInside: false, fence: null };
    }
  }

  // Check each fence
  for (const fence of fences) {
    const distance = calculateDistance(latitude, longitude, fence.latitude, fence.longitude);
    const effectiveRadius = useHysteresis ? fence.radius * HYSTERESIS_EXIT : fence.radius;
    
    if (distance <= effectiveRadius) {
      return { isInside: true, fence };
    }
  }

  return { isInside: false, fence: null };
}

// ============================================
// GEOFENCE TASK
// ============================================

TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    logger.error('geofence', 'Geofence task error', { error: String(error) });
    return;
  }

  const eventData = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion };
  
  if (!eventData || !eventData.region) {
    logger.warn('geofence', 'Invalid geofence event data');
    return;
  }

  const { eventType, region } = eventData;
  const eventTypeStr = eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit';

  // Handle undefined identifier
  const regionId = region.identifier || 'unknown';

  logger.info('geofence', `📍 Native geofence: ${eventTypeStr} - ${regionId}`);

  const event: GeofenceEvent = {
    type: eventTypeStr,
    regionIdentifier: regionId,
    timestamp: Date.now(),
  };

  // Track geofence trigger
  const userId = await getBackgroundUserId();
  if (userId) {
    try {
      await trackGeofenceTrigger(userId, null);
    } catch (e) {
      // Ignore tracking errors
    }
  }

  // Notify callback if registered
  if (onGeofenceEvent) {
    try {
      onGeofenceEvent(event);
    } catch (e) {
      logger.error('geofence', 'Error in geofence callback', { error: String(e) });
    }
  }
});

// ============================================
// LOCATION TASK
// ============================================

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    logger.error('gps', 'Location task error', { error: String(error) });
    return;
  }

  const locationData = data as { locations: Location.LocationObject[] };
  
  if (!locationData || !locationData.locations || locationData.locations.length === 0) {
    return;
  }

  const location = locationData.locations[0];
  
  logger.debug('gps', 'Background location update', {
    lat: location.coords.latitude.toFixed(6),
    lng: location.coords.longitude.toFixed(6),
  });

  // Notify callback if registered
  if (onLocationUpdate) {
    try {
      onLocationUpdate(location);
    } catch (e) {
      logger.error('gps', 'Error in location callback', { error: String(e) });
    }
  }
});

// ============================================
// HEARTBEAT TASK
// ============================================

TaskManager.defineTask(HEARTBEAT_TASK_NAME, async () => {
  const startTime = Date.now();
  logger.info('heartbeat', '💓 Heartbeat started...');

  try {
    const userId = await getBackgroundUserId();
    if (!userId) {
      logger.warn('heartbeat', 'No userId found');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Get current location
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude, accuracy } = location.coords;

    // Check if inside any fence
    const { isInside, fence } = await checkInsideFence(latitude, longitude, userId, true);

    // Get current session
    const activeSession = await getGlobalActiveSession(userId);

    // V2: Only track metric, don't log GPS
    try {
      await trackMetric(userId, 'geofence_triggers');
    } catch (e) {
      // Ignore tracking errors
    }

    // ============================================
    // CONSISTENCY CHECKS
    // ============================================

    // Case 1: INSIDE fence but NO active session → missed entry!
    if (isInside && fence && !activeSession) {
      // Check if location was skipped today
      if (await isLocationSkippedToday(fence.id)) {
        logger.info('heartbeat', `😴 Location "${fence.name}" skipped today`);
      } else {
        logger.warn('heartbeat', `⚠️ MISSED ENTRY detected: ${fence.name}`);
        
        // Create entry record
        const sessionId = await createEntryRecord({
          userId,
          locationId: fence.id,
          locationName: fence.name,
          type: 'automatic',
        });

        // V2: Record audit for entry (GPS proof)
        try {
          await recordEntryAudit(
            userId,
            latitude,
            longitude,
            accuracy ?? null,
            fence.id,
            fence.name,
            sessionId
          );
        } catch (e) {
          // Ignore audit errors
        }
      }
    }

    // Case 2: OUTSIDE all fences but WITH active session → missed exit!
    if (!isInside && activeSession) {
      logger.warn('heartbeat', `⚠️ MISSED EXIT detected: ${activeSession.location_name}`);
      
      // V2: Record audit for exit (GPS proof) BEFORE registering exit
      try {
        await recordExitAudit(
          userId,
          latitude,
          longitude,
          accuracy ?? null,
          activeSession.location_id,
          activeSession.location_name || 'Unknown',
          activeSession.id
        );
      } catch (e) {
        // Ignore audit errors
      }
      
      await registerExit(userId, activeSession.location_id);
    }

    // Case 3: Consistent state
    if ((isInside && activeSession) || (!isInside && !activeSession)) {
      logger.info('heartbeat', `✅ Consistent: ${isInside ? `inside "${fence?.name}"` : 'outside all fences'}`);
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
    
    // V2: Capture error
    const userId = await getBackgroundUserId();
    if (userId) {
      try {
        await captureGeofenceError(error as Error, { userId, action: 'heartbeat' });
      } catch (e) {
        // Ignore capture errors
      }
    }
    
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ============================================
// HEARTBEAT CONTROL FUNCTIONS
// ============================================

export async function startHeartbeat(): Promise<boolean> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) {
      logger.warn('heartbeat', 'BackgroundFetch restricted by system');
      return false;
    }
    
    if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      logger.warn('heartbeat', 'BackgroundFetch denied by user');
      return false;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME);
    if (isRegistered) {
      logger.info('heartbeat', 'Heartbeat already active');
      return true;
    }

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

    // Process inconsistencies
    const activeSession = await getGlobalActiveSession(userId);

    if (isInside && fence && !activeSession) {
      if (await isLocationSkippedToday(fence.id)) {
        logger.info('heartbeat', `😴 Location "${fence.name}" skipped today`);
      } else {
        logger.warn('heartbeat', `⚠️ Missed entry detected: ${fence.name}`);
        const sessionId = await createEntryRecord({
          userId,
          locationId: fence.id,
          locationName: fence.name,
          type: 'automatic',
        });
        
        // V2: Record audit
        try {
          await recordEntryAudit(userId, latitude, longitude, accuracy ?? null, fence.id, fence.name, sessionId);
        } catch (e) {
          // Ignore
        }
      }
    }

    if (!isInside && activeSession) {
      logger.warn('heartbeat', `⚠️ Missed exit detected: ${activeSession.location_name}`);
      
      // V2: Record audit before exit
      try {
        await recordExitAudit(
          userId, latitude, longitude, accuracy ?? null,
          activeSession.location_id, activeSession.location_name || 'Unknown', activeSession.id
        );
      } catch (e) {
        // Ignore
      }
      
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

  const statusNames: Record<number, string> = {
    [BackgroundFetch.BackgroundFetchStatus.Restricted]: 'Restricted',
    [BackgroundFetch.BackgroundFetchStatus.Denied]: 'Denied',
    [BackgroundFetch.BackgroundFetchStatus.Available]: 'Available',
  };

  return {
    geofencing,
    location,
    heartbeat,
    activeFences: activeFencesCache.length,
    backgroundFetchStatus: bgStatus !== null ? statusNames[bgStatus] || 'Unknown' : 'Unknown',
    hasUserId: !!userId,
  };
}

// ============================================
// INITIALIZATION LOG
// ============================================

logger.info('boot', '📋 Background tasks V2 defined', {
  geofence: GEOFENCE_TASK_NAME,
  location: LOCATION_TASK_NAME,
  heartbeat: HEARTBEAT_TASK_NAME,
  heartbeatInterval: `${HEARTBEAT_INTERVAL / 60} min`,
  hysteresisExit: `${HYSTERESIS_EXIT}x`,
});
