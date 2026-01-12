/**
 * Background Tasks - OnSite Timekeeper v2
 * 
 * Geofencing + Adaptive Heartbeat with SAFE register/unregister.
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  addToSkippedToday as _addToSkippedToday,
  removeFromSkippedToday as _removeFromSkippedToday,
  clearSkippedToday as _clearSkippedToday,
  isLocationSkippedToday as _isLocationSkippedToday,
  checkInsideFence as _checkInsideFence,
  checkInsideFenceForTTL as _checkInsideFenceForTTL,
  getBackgroundUserId as _getBackgroundUserId,
  setBackgroundUserId as _setBackgroundUserId,
  clearBackgroundUserId as _clearBackgroundUserId,
  updateActiveFences as _updateActiveFences,
  getActiveFences as _getActiveFences,
  clearFencesCache as _clearFencesCache,
  calculateDistance as _calculateDistance,
  getPingPongHistory as _getPingPongHistory,
  getPingPongSummary as _getPingPongSummary,
  type PingPongEvent,
  type ActiveFence,
} from './backgroundHelpers';

// ============================================
// RE-EXPORTS from backgroundHelpers
// ============================================

export const addToSkippedToday = _addToSkippedToday;
export const removeFromSkippedToday = _removeFromSkippedToday;
export const clearSkippedToday = _clearSkippedToday;
export const isLocationSkippedToday = _isLocationSkippedToday;
export const checkInsideFence = _checkInsideFence;
export const checkInsideFenceForTTL = _checkInsideFenceForTTL;
export const updateActiveFences = _updateActiveFences;
export const getActiveFences = _getActiveFences;
export const clearFencesCache = _clearFencesCache;
export const calculateDistance = _calculateDistance;
export const getPingPongHistory = _getPingPongHistory;
export const getPingPongSummary = _getPingPongSummary;
export type { ActiveFence };

// ============================================
// CONSTANTS
// ============================================

export const GEOFENCE_TASK = 'onsite-geofence';
export const HEARTBEAT_TASK = 'onsite-heartbeat-task';
export const LOCATION_TASK = 'onsite-location-task';

// Legacy aliases
export const GEOFENCE_TASK_NAME = GEOFENCE_TASK;
export const HEARTBEAT_TASK_NAME = HEARTBEAT_TASK;
export const LOCATION_TASK_NAME = LOCATION_TASK;

const BACKGROUND_USER_KEY = '@onsite/background_user_id';

// Reconfigure debounce
const RECONFIGURE_DEBOUNCE_MS = 5000;
let lastReconfigureTime = 0;
let isReconfiguring = false;

// Event deduplication
const processedEvents = new Map<string, number>();
const EVENT_DEDUP_WINDOW_MS = 10000;

// FIX: Queue for events during reconfigure (instead of discarding)
interface QueuedEvent {
  event: InternalGeofenceEvent;
  queuedAt: number;
}
const reconfigureQueue: QueuedEvent[] = [];
const MAX_QUEUE_SIZE = 20;
const MAX_QUEUE_AGE_MS = 30000; // 30 seconds
let drainScheduled = false; // Prevent multiple drains

// Debounce for userId saves
let lastUserIdSaved: string | null = null;

// Current heartbeat interval tracking
let currentHeartbeatInterval = HEARTBEAT_INTERVALS.NORMAL;

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

// Internal type for geofence events
interface InternalGeofenceEvent {
  region: Location.LocationRegion;
  state: Location.GeofencingRegionState;
}

// ============================================
// CALLBACKS
// ============================================

type GeofenceCallback = (event: GeofenceEvent) => void;
type LocationCallback = (location: Location.LocationObject) => void;
type HeartbeatCallback = (result: HeartbeatResult) => Promise<void>;
type ReconcileCallback = () => Promise<void>;

let geofenceCallback: GeofenceCallback | null = null;
let locationCallback: LocationCallback | null = null;
let heartbeatCallback: HeartbeatCallback | null = null;
let reconcileCallback: ReconcileCallback | null = null;

export function setGeofenceCallback(callback: GeofenceCallback): void {
  geofenceCallback = callback;
  logger.debug('geofence', 'Geofence callback registered');
}

export function setLocationCallback(callback: LocationCallback): void {
  locationCallback = callback;
  logger.debug('gps', 'Location callback registered');
}

export function setHeartbeatCallback(callback: HeartbeatCallback): void {
  heartbeatCallback = callback;
  logger.debug('heartbeat', 'Heartbeat callback registered');
}

export function setReconcileCallback(callback: ReconcileCallback): void {
  reconcileCallback = callback;
  logger.debug('geofence', 'Reconcile callback registered');
}

export function clearCallbacks(): void {
  geofenceCallback = null;
  locationCallback = null;
  heartbeatCallback = null;
  reconcileCallback = null;
  logger.debug('geofence', 'Callbacks cleared');
}

// ============================================
// RECONFIGURING STATE
// ============================================

export function setReconfiguring(value: boolean): void {
  const wasReconfiguring = isReconfiguring;
  isReconfiguring = value;
  logger.debug('geofence', `Reconfiguring: ${value}`);
  
  // FIX: Drain queue when reconfiguring ends (with debounce)
  if (wasReconfiguring && !value && !drainScheduled) {
    drainScheduled = true;
    // Small delay to let any final events arrive
    setTimeout(async () => {
      drainScheduled = false;
      await drainReconfigureQueue();
    }, 500);
  }
}

export function isInReconfiguring(): boolean {
  return isReconfiguring;
}

// ============================================
// BACKGROUND USER
// ============================================

export async function setBackgroundUserId(userId: string): Promise<void> {
  // FIX: Debounce - only save if changed
  if (lastUserIdSaved === userId) {
    logger.debug('boot', `UserId unchanged, skipping save: ${userId.substring(0, 8)}...`);
    return;
  }
  
  lastUserIdSaved = userId;
  await AsyncStorage.setItem(BACKGROUND_USER_KEY, userId);
  await _setBackgroundUserId(userId); // Also save to backgroundHelpers
  logger.debug('boot', `UserId saved for background: ${userId.substring(0, 8)}...`);
}

export async function getBackgroundUserId(): Promise<string | null> {
  return AsyncStorage.getItem(BACKGROUND_USER_KEY);
}

export async function clearBackgroundUserId(): Promise<void> {
  lastUserIdSaved = null; // Reset debounce
  await AsyncStorage.removeItem(BACKGROUND_USER_KEY);
  await _clearBackgroundUserId();
  logger.debug('boot', 'Background userId cleared');
}

// ============================================
// SAFE TASK REGISTER/UNREGISTER
// ============================================

async function isTaskRegistered(taskName: string): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(taskName);
  } catch (error) {
    logger.warn('heartbeat', `Error checking task registration: ${taskName}`, { error: String(error) });
    return false;
  }
}

async function safeUnregisterTask(taskName: string): Promise<boolean> {
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

async function safeRegisterHeartbeat(intervalSeconds: number): Promise<boolean> {
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
// GEOFENCE HELPERS (internal)
// ============================================

let fenceCache: Map<string, { lat: number; lng: number; radius: number; name: string }> = new Map();

export function updateFenceCache(locations: Array<{ id: string; latitude: number; longitude: number; radius: number; name: string }>): void {
  fenceCache.clear();
  locations.forEach(loc => {
    fenceCache.set(loc.id, {
      lat: loc.latitude,
      lng: loc.longitude,
      radius: loc.radius,
      name: loc.name,
    });
  });
  
  // Also update backgroundHelpers cache
  _updateActiveFences(locations.map(loc => ({
    id: loc.id,
    name: loc.name,
    latitude: loc.latitude,
    longitude: loc.longitude,
    radius: loc.radius,
  })));
  
  logger.debug('heartbeat', `Fences in cache: ${fenceCache.size}`);
}

function localCalculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function localCheckInsideFence(lat: number, lng: number): { isInside: boolean; fenceId?: string; fenceName?: string; distance?: number } {
  for (const [id, fence] of fenceCache.entries()) {
    const distance = localCalculateDistance(lat, lng, fence.lat, fence.lng);
    const effectiveRadius = fence.radius * 1.3; // 30% buffer
    
    if (distance <= effectiveRadius) {
      return { isInside: true, fenceId: id, fenceName: fence.name, distance };
    }
  }
  return { isInside: false };
}

async function checkInsideFenceAsync(lat: number, lng: number): Promise<{ isInside: boolean; fenceId?: string }> {
  const result = localCheckInsideFence(lat, lng);
  return { isInside: result.isInside, fenceId: result.fenceId };
}

// ============================================
// EVENT PROCESSING
// ============================================

function isDuplicateEvent(regionId: string, eventType: string): boolean {
  const key = `${regionId}-${eventType}`;
  const lastTime = processedEvents.get(key);
  const now = Date.now();
  
  if (lastTime && now - lastTime < EVENT_DEDUP_WINDOW_MS) {
    return true;
  }
  
  processedEvents.set(key, now);
  
  // Cleanup old entries
  for (const [k, v] of processedEvents.entries()) {
    if (now - v > EVENT_DEDUP_WINDOW_MS * 2) {
      processedEvents.delete(k);
    }
  }
  
  return false;
}

async function processGeofenceEvent(event: InternalGeofenceEvent): Promise<void> {
  const { region, state } = event;
  const regionId = region.identifier ?? 'unknown';
  const eventType = state === Location.GeofencingRegionState.Inside ? 'enter' : 'exit';
  const eventTypeStr = eventType.toUpperCase();
  
  // FIX: Queue events during reconfigure instead of discarding
  if (isReconfiguring) {
    // Check queue size limit
    if (reconfigureQueue.length >= MAX_QUEUE_SIZE) {
      logger.warn('pingpong', `⚠️ Event queue full, dropping oldest: ${eventTypeStr} - ${regionId}`);
      reconfigureQueue.shift();
    }
    
    reconfigureQueue.push({ event, queuedAt: Date.now() });
    logger.info('pingpong', `⏸️ Event QUEUED (reconfiguring): ${eventTypeStr} - ${regionId}`, {
      queueSize: reconfigureQueue.length,
    });
    return;
  }
  
  // Check duplicate
  if (isDuplicateEvent(regionId, eventType)) {
    logger.warn('pingpong', `🚫 DUPLICATE event ignored: ${eventTypeStr} - ${regionId}`);
    return;
  }
  
  // Get fence info
  const fence = fenceCache.get(regionId);
  const fenceName = fence?.name || 'Unknown';
  
  // Get current location for ping-pong tracking
  let currentLocation: Location.LocationObject | null = null;
  try {
    currentLocation = await Location.getLastKnownPositionAsync({
      maxAge: 10000,
      requiredAccuracy: 100,
    });
  } catch {
    logger.warn('pingpong', 'Could not get GPS for ping-pong log');
  }
  
  // Calculate distance and log
  if (currentLocation && fence) {
    const distance = localCalculateDistance(
      currentLocation.coords.latitude,
      currentLocation.coords.longitude,
      fence.lat,
      fence.lng
    );
    
    const effectiveRadius = fence.radius * 1.3;
    const margin = effectiveRadius - distance;
    const marginPercent = (margin / effectiveRadius) * 100;
    const isInside = distance <= effectiveRadius;
    
    const pingPongEvent: PingPongEvent = {
      type: eventType,
      fenceId: regionId,
      fenceName,
      timestamp: Date.now(),
      distance,
      radius: fence.radius,
      effectiveRadius,
      margin,
      marginPercent,
      isInside,
      gpsAccuracy: currentLocation.coords.accuracy ?? undefined,
      source: 'geofence',
    };
    
    // Log ping-pong event
    await logPingPongEvent(pingPongEvent);
    
    // Check GPS accuracy
    if (currentLocation.coords.accuracy && currentLocation.coords.accuracy > 50) {
      logger.warn('pingpong', `⚠️ LOW GPS ACCURACY: ${currentLocation.coords.accuracy.toFixed(0)}m`);
      await recordLowAccuracy(currentLocation.coords.accuracy);
    }
  } else {
    logger.info('pingpong', `📍 ${eventTypeStr} (no GPS)`, { regionId });
  }
  
  // Log native event
  logger.info('geofence', `📍 Geofence ${eventType}: ${fenceName}`);
  
  // Call callback
  if (geofenceCallback) {
    geofenceCallback({
      type: eventType,
      regionIdentifier: regionId,
      timestamp: Date.now(),
    });
  }
  
  // Update heartbeat interval
  await maybeUpdateHeartbeatInterval();
}

// ============================================
// HEARTBEAT
// ============================================

async function maybeUpdateHeartbeatInterval(): Promise<void> {
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

async function runHeartbeat(): Promise<void> {
  const startTime = Date.now();
  const userId = await getBackgroundUserId();
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

// ============================================
// TASK DEFINITIONS (must be global scope)
// ============================================

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    logger.error('geofence', 'Geofence task error', { error: String(error) });
    return;
  }
  
  const eventData = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion };
  
  if (eventData.eventType === Location.GeofencingEventType.Enter) {
    await processGeofenceEvent({
      region: eventData.region,
      state: Location.GeofencingRegionState.Inside,
    });
  } else if (eventData.eventType === Location.GeofencingEventType.Exit) {
    await processGeofenceEvent({
      region: eventData.region,
      state: Location.GeofencingRegionState.Outside,
    });
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

// Location task (legacy support)
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
// RECONFIGURE QUEUE DRAIN
// ============================================

async function drainReconfigureQueue(): Promise<void> {
  if (reconfigureQueue.length === 0) {
    logger.debug('pingpong', '📭 Reconfigure queue empty, nothing to drain');
    return;
  }
  
  const now = Date.now();
  const queueSize = reconfigureQueue.length;
  
  logger.info('pingpong', `▶️ Draining ${queueSize} queued events`);
  
  let processed = 0;
  let dropped = 0;
  
  while (reconfigureQueue.length > 0) {
    const item = reconfigureQueue.shift()!;
    const age = now - item.queuedAt;
    
    // Drop events that are too old
    if (age > MAX_QUEUE_AGE_MS) {
      const regionId = item.event.region.identifier ?? 'unknown';
      logger.warn('pingpong', `🗑️ Event dropped (too old: ${(age / 1000).toFixed(1)}s): ${regionId}`);
      dropped++;
      continue;
    }
    
    // Process the event (without recursion into queue)
    try {
      await processQueuedEvent(item.event);
      processed++;
    } catch (error) {
      logger.error('pingpong', 'Error processing queued event', { error: String(error) });
    }
  }
  
  logger.info('pingpong', `✅ Queue drained: ${processed} processed, ${dropped} dropped`);
}

/**
 * Process a queued event (skips the reconfiguring check)
 */
async function processQueuedEvent(event: InternalGeofenceEvent): Promise<void> {
  const { region, state } = event;
  const regionId = region.identifier ?? 'unknown';
  const eventType = state === Location.GeofencingRegionState.Inside ? 'enter' : 'exit';
  const eventTypeStr = eventType.toUpperCase();
  
  // Check duplicate (even for queued events)
  if (isDuplicateEvent(regionId, eventType)) {
    logger.warn('pingpong', `🚫 DUPLICATE queued event ignored: ${eventTypeStr} - ${regionId}`);
    return;
  }
  
  // Get fence info
  const fence = fenceCache.get(regionId);
  const fenceName = fence?.name || 'Unknown';
  
  logger.info('geofence', `📍 Geofence ${eventType} (from queue): ${fenceName}`);
  
  // Call callback
  if (geofenceCallback) {
    geofenceCallback({
      type: eventType,
      regionIdentifier: regionId,
      timestamp: Date.now(),
    });
  }
  
  // Update heartbeat interval
  await maybeUpdateHeartbeatInterval();
}

// ============================================
// PUBLIC API
// ============================================

export async function startHeartbeat(): Promise<void> {
  const registered = await isTaskRegistered(HEARTBEAT_TASK);
  
  if (registered) {
    logger.info('heartbeat', 'Heartbeat already active');
    // Still check if interval needs update
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

export async function startGeofencing(
  locations: Array<{ id: string; latitude: number; longitude: number; radius: number; name: string }>
): Promise<void> {
  if (locations.length === 0) {
    logger.warn('geofence', 'No locations to monitor');
    return;
  }
  
  // Debounce reconfigure
  const now = Date.now();
  if (now - lastReconfigureTime < RECONFIGURE_DEBOUNCE_MS) {
    logger.debug('geofence', 'Skipping reconfigure (debounce)');
    return;
  }
  lastReconfigureTime = now;
  
  // NOTE: setReconfiguring is controlled by locationStore/syncStore externally
  // This prevents premature drain of event queue
  
  try {
    // Update cache
    updateFenceCache(locations);
    
    // Stop existing
    const hasGeofencing = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
    if (hasGeofencing) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
    
    // Build regions
    const regions: Location.LocationRegion[] = locations.map(loc => ({
      identifier: loc.id,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius: loc.radius,
      notifyOnEnter: true,
      notifyOnExit: true,
    }));
    
    logger.info('geofence', `🎯 Starting geofencing for ${regions.length} region(s)`);
    
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    
    logger.info('geofence', '✅ Geofencing started successfully');
  } catch (error) {
    logger.error('geofence', 'Error starting geofencing', { error: String(error) });
    throw error;
  }
}

export async function stopGeofencing(): Promise<void> {
  try {
    const hasGeofencing = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
    if (hasGeofencing) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
      logger.info('geofence', '🛑 Geofencing stopped');
    }
    fenceCache.clear();
  } catch (error) {
    logger.error('geofence', 'Error stopping geofencing', { error: String(error) });
  }
}

export async function getGeofencingStatus(): Promise<{
  isActive: boolean;
  heartbeatActive: boolean;
  fenceCount: number;
  heartbeatInterval: number;
  heartbeatReason: string;
}> {
  const isActive = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
  const heartbeatActive = await isTaskRegistered(HEARTBEAT_TASK);
  const heartbeatState = await getHeartbeatState();
  
  return {
    isActive,
    heartbeatActive,
    fenceCount: fenceCache.size,
    heartbeatInterval: heartbeatState.currentInterval,
    heartbeatReason: heartbeatState.reason,
  };
}

export async function reconcileGeofenceState(): Promise<void> {
  if (reconcileCallback) {
    await reconcileCallback();
  }
}

// ============================================
// STATUS CHECKS (Legacy support)
// ============================================

export async function isGeofencingTaskRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    return false;
  }
}

export async function isLocationTaskRunning(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function isHeartbeatRunning(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK);
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
    activeFences: fenceCache.size,
    backgroundFetchStatus: bgStatus !== null ? (statusNames[bgStatus] || 'Unknown') : 'Unknown',
    hasUserId: !!userId,
  };
}

// Re-export for convenience
export { HEARTBEAT_INTERVALS };
