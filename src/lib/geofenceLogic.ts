/**
 * Geofence Logic - OnSite Timekeeper
 * 
 * Event processing, fence cache, deduplication, reconfigure queue.
 */

import * as Location from 'expo-location';
import { logger } from './logger';
import {
  logPingPongEvent,
  recordLowAccuracy,
  updateActiveFences as _updateActiveFences,
  type PingPongEvent,
} from './backgroundHelpers';
import { getGeofenceCallback } from './taskCallbacks';
import {
  type InternalGeofenceEvent,
  type QueuedEvent,
  EVENT_DEDUP_WINDOW_MS,
  MAX_QUEUE_SIZE,
  MAX_QUEUE_AGE_MS,
} from './backgroundTypes';

// ============================================
// FENCE CACHE (module-level)
// ============================================

let fenceCache: Map<string, { lat: number; lng: number; radius: number; name: string }> = new Map();

/**
 * Update fence cache (internal use only)
 */
function updateFenceCache(
  locations: Array<{ id: string; latitude: number; longitude: number; radius: number; name: string }>
): void {
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

/**
 * Get fence cache (used by heartbeatLogic)
 */
export function getFenceCache(): Map<string, { lat: number; lng: number; radius: number; name: string }> {
  return fenceCache;
}

/**
 * Clear fence cache (internal use only)
 */
function clearFenceCache(): void {
  fenceCache.clear();
}

/**
 * Get fence cache size (internal use only)
 */
function getFenceCacheSize(): number {
  return fenceCache.size;
}

// ============================================
// DISTANCE CALCULATION
// ============================================

/**
 * Calculate distance between two points (used by heartbeatLogic)
 */
export function localCalculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if inside fence (used by heartbeatLogic)
 */
export function localCheckInsideFence(
  lat: number, 
  lng: number
): { isInside: boolean; fenceId?: string; fenceName?: string; distance?: number } {
  for (const [id, fence] of fenceCache.entries()) {
    const distance = localCalculateDistance(lat, lng, fence.lat, fence.lng);
    const effectiveRadius = fence.radius * 1.3; // 30% buffer
    
    if (distance <= effectiveRadius) {
      return { isInside: true, fenceId: id, fenceName: fence.name, distance };
    }
  }
  return { isInside: false };
}

/**
 * Async version for TTL check (used by heartbeatLogic)
 */
export async function checkInsideFenceAsync(
  lat: number, 
  lng: number
): Promise<{ isInside: boolean; fenceId?: string }> {
  const result = localCheckInsideFence(lat, lng);
  return { isInside: result.isInside, fenceId: result.fenceId };
}

// ============================================
// EVENT DEDUPLICATION (internal)
// ============================================

const processedEvents = new Map<string, number>();

/**
 * Check if event is duplicate (internal use only)
 */
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

// ============================================
// RECONFIGURE STATE
// ============================================

let isReconfiguring = false;
let drainScheduled = false;
const reconfigureQueue: QueuedEvent[] = [];

/**
 * Set reconfiguring state (used by locationStore, syncStore)
 */
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

/**
 * Check if reconfiguring (internal use only)
 */
function isInReconfiguring(): boolean {
  return isReconfiguring;
}

// ============================================
// RECONFIGURE QUEUE (internal)
// ============================================

/**
 * Queue event during reconfigure (internal use only)
 */
function queueEventDuringReconfigure(event: InternalGeofenceEvent): void {
  const regionId = event.region.identifier ?? 'unknown';
  const eventType = event.state === Location.GeofencingRegionState.Inside ? 'ENTER' : 'EXIT';
  
  // Check queue size limit
  if (reconfigureQueue.length >= MAX_QUEUE_SIZE) {
    logger.warn('pingpong', `⚠️ Event queue full, dropping oldest: ${eventType} - ${regionId}`);
    reconfigureQueue.shift();
  }
  
  reconfigureQueue.push({ event, queuedAt: Date.now() });
  logger.info('pingpong', `⏸️ Event QUEUED (reconfiguring): ${eventType} - ${regionId}`, {
    queueSize: reconfigureQueue.length,
  });
}

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
  const geofenceCallback = getGeofenceCallback();
  if (geofenceCallback) {
    geofenceCallback({
      type: eventType,
      regionIdentifier: regionId,
      timestamp: Date.now(),
    });
  }
}

// ============================================
// GEOFENCE EVENT PROCESSING
// ============================================

/**
 * Process geofence event (used by backgroundTasks)
 */
export async function processGeofenceEvent(event: InternalGeofenceEvent): Promise<void> {
  const { region, state } = event;
  const regionId = region.identifier ?? 'unknown';
  const eventType = state === Location.GeofencingRegionState.Inside ? 'enter' : 'exit';
  const eventTypeStr = eventType.toUpperCase();
  
  // FIX: Queue events during reconfigure instead of discarding
  if (isReconfiguring) {
    queueEventDuringReconfigure(event);
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
  const geofenceCallback = getGeofenceCallback();
  if (geofenceCallback) {
    geofenceCallback({
      type: eventType,
      regionIdentifier: regionId,
      timestamp: Date.now(),
    });
  }
}
