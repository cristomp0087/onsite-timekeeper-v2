/**
 * Background Helpers - OnSite Timekeeper V2
 * 
 * Helper functions for background tasks:
 * - User ID persistence
 * - Skipped today persistence
 * - Fence cache management
 * - Distance calculation
 * - Fence check (inside/outside)
 * - Ping-pong tracking
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';
import {
  HYSTERESIS_EXIT,
  USER_ID_KEY,
  SKIPPED_TODAY_KEY,
} from './constants';
import { getLocations } from './database';
import { capturePingPongEvent, type PingPongEventData } from './database/errors';

// ============================================
// TYPES
// ============================================

export interface ActiveFence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

// Exported for backgroundTasks.ts
export interface PingPongEvent {
  timestamp: number;
  type: 'enter' | 'exit' | 'check';
  fenceName: string;
  fenceId: string;
  distance: number;
  radius: number;
  effectiveRadius: number;
  margin: number;
  marginPercent: number;
  isInside: boolean;
  source: 'geofence' | 'heartbeat' | 'reconcile' | 'manual';
  gpsAccuracy?: number;
}

interface SkippedTodayData {
  date: string;
  locationIds: string[];
}

// ============================================
// FENCE CACHE
// ============================================

let activeFencesCache: ActiveFence[] = [];

export function updateActiveFences(fences: ActiveFence[]): void {
  activeFencesCache = fences;
  logger.debug('heartbeat', `Fences in cache: ${fences.length}`);
}

export function getActiveFences(): ActiveFence[] {
  return activeFencesCache;
}

export function clearFencesCache(): void {
  activeFencesCache = [];
}

// ============================================
// USER ID PERSISTENCE
// ============================================

export async function setBackgroundUserId(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_ID_KEY, userId);
    logger.debug('boot', `UserId saved for background: ${userId.substring(0, 8)}...`);
  } catch (error) {
    logger.error('boot', 'Error saving userId', { error: String(error) });
  }
}

export async function clearBackgroundUserId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_ID_KEY);
    logger.debug('boot', 'UserId removed');
  } catch (error) {
    logger.error('boot', 'Error removing userId', { error: String(error) });
  }
}

export async function getBackgroundUserId(): Promise<string | null> {
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

export async function isLocationSkippedToday(locationId: string): Promise<boolean> {
  const skipped = await getSkippedToday();
  return skipped.includes(locationId);
}

// ============================================
// DISTANCE CALCULATION
// ============================================

export function calculateDistance(
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

// ============================================
// PING-PONG TRACKER
// ============================================

const pingPongHistory: PingPongEvent[] = [];
const MAX_PING_PONG_HISTORY = 50;

export async function logPingPongEvent(event: PingPongEvent): Promise<void> {
  // Add to in-memory history
  pingPongHistory.push(event);
  if (pingPongHistory.length > MAX_PING_PONG_HISTORY) {
    pingPongHistory.shift();
  }

  // Detect rapid oscillation (ping-pong)
  const recentEvents = pingPongHistory.filter(
    e => e.fenceId === event.fenceId && (Date.now() - e.timestamp) < 5 * 60 * 1000
  );
  
  const recentEnters = recentEvents.filter(e => e.type === 'enter' || (e.type === 'check' && e.isInside)).length;
  const recentExits = recentEvents.filter(e => e.type === 'exit' || (e.type === 'check' && !e.isInside)).length;
  const isPingPonging = recentEnters >= 2 && recentExits >= 2;
  
  // Use margin from event (already calculated by caller)
  const margin = event.margin;
  const marginPercent = event.marginPercent;
  
  // Log to console
  logger.info('pingpong', `📍 ${event.type.toUpperCase()} @ ${event.fenceName}`, {
    distance: `${event.distance.toFixed(1)}m`,
    radius: `${event.radius}m`,
    effectiveRadius: `${event.effectiveRadius.toFixed(1)}m`,
    margin: `${margin.toFixed(1)}m (${marginPercent.toFixed(1)}%)`,
    isInside: event.isInside,
    source: event.source,
    gpsAccuracy: event.gpsAccuracy ? `${event.gpsAccuracy.toFixed(1)}m` : 'N/A',
  });

  // Warn if ping-pong detected
  if (isPingPonging) {
    logger.warn('pingpong', `🔴 PING-PONG DETECTED @ ${event.fenceName}!`, {
      enters: recentEnters,
      exits: recentExits,
      lastEvents: recentEvents.slice(-5).map(e => ({
        type: e.type,
        distance: `${e.distance.toFixed(1)}m`,
        time: new Date(e.timestamp).toLocaleTimeString(),
      })),
    });
  }

  // Save to error_log (syncs to Supabase)
  const userId = await getBackgroundUserId();
  if (!userId) {
    logger.debug('pingpong', 'No userId, skipping database save');
    return;
  }

  const pingPongData: PingPongEventData = {
    eventType: event.type,
    source: event.source,
    fenceId: event.fenceId,
    fenceName: event.fenceName,
    distance: Math.round(event.distance * 10) / 10,
    radius: event.radius,
    effectiveRadius: Math.round(event.effectiveRadius * 10) / 10,
    margin: Math.round(margin * 10) / 10,
    marginPercent: Math.round(marginPercent * 10) / 10,
    isInside: event.isInside,
    gpsAccuracy: event.gpsAccuracy ? Math.round(event.gpsAccuracy * 10) / 10 : undefined,
    isPingPonging,
    recentEnters,
    recentExits,
  };

  try {
    await capturePingPongEvent(userId, pingPongData);
  } catch (error) {
    logger.error('pingpong', 'Failed to save ping-pong event', { error: String(error) });
  }
}

export function getPingPongHistory(): PingPongEvent[] {
  return [...pingPongHistory];
}

export function getPingPongSummary(fenceId?: string): {
  totalEvents: number;
  enters: number;
  exits: number;
  checks: number;
  avgDistance: number;
  isPingPonging: boolean;
} {
  const events = fenceId 
    ? pingPongHistory.filter(e => e.fenceId === fenceId)
    : pingPongHistory;
  
  const enters = events.filter(e => e.type === 'enter').length;
  const exits = events.filter(e => e.type === 'exit').length;
  const checks = events.filter(e => e.type === 'check').length;
  const avgDistance = events.length > 0 
    ? events.reduce((sum, e) => sum + e.distance, 0) / events.length 
    : 0;
  
  const recentEvents = events.filter(e => (Date.now() - e.timestamp) < 5 * 60 * 1000);
  const recentEnters = recentEvents.filter(e => e.type === 'enter').length;
  const recentExits = recentEvents.filter(e => e.type === 'exit').length;
  
  return {
    totalEvents: events.length,
    enters,
    exits,
    checks,
    avgDistance: Math.round(avgDistance),
    isPingPonging: recentEnters >= 2 && recentExits >= 2,
  };
}

/**
 * Record low GPS accuracy event (used by geofenceLogic.ts)
 */
export async function recordLowAccuracy(accuracy: number): Promise<void> {
  const userId = await getBackgroundUserId();
  if (!userId) {
    logger.debug('pingpong', 'No userId, skipping low accuracy record');
    return;
  }
  logger.warn('pingpong', `📡 Low GPS accuracy recorded: ${accuracy.toFixed(0)}m`);
}
/**
 * Check for ping-pong pattern (used by backgroundTasks.ts)
 */
export async function checkForPingPong(fenceId?: string): Promise<{
  isPingPonging: boolean;
  recentEnters: number;
  recentExits: number;
}> {
  const events = fenceId 
    ? pingPongHistory.filter(e => e.fenceId === fenceId)
    : pingPongHistory;
  
  const recentEvents = events.filter(e => (Date.now() - e.timestamp) < 5 * 60 * 1000);
  const recentEnters = recentEvents.filter(e => e.type === 'enter').length;
  const recentExits = recentEvents.filter(e => e.type === 'exit').length;
  
  return {
    isPingPonging: recentEnters >= 2 && recentExits >= 2,
    recentEnters,
    recentExits,
  };
}

// ============================================
// CHECK INSIDE FENCE
// ============================================

export async function checkInsideFence(
  latitude: number,
  longitude: number,
  userId: string,
  useHysteresis: boolean = false,
  source: 'geofence' | 'heartbeat' | 'reconcile' | 'manual' = 'manual',
  gpsAccuracy?: number
): Promise<{ isInside: boolean; fence: ActiveFence | null; distance?: number }> {
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

  let closestFence: ActiveFence | null = null;
  let closestDistance = Infinity;

  for (const fence of fences) {
    const distance = calculateDistance(latitude, longitude, fence.latitude, fence.longitude);
    const effectiveRadius = useHysteresis ? fence.radius * HYSTERESIS_EXIT : fence.radius;
    
    if (distance < closestDistance) {
      closestDistance = distance;
      closestFence = fence;
    }
    
    if (distance <= effectiveRadius) {
      const margin = effectiveRadius - distance;
      const marginPercent = (margin / effectiveRadius) * 100;
      
      logPingPongEvent({
        timestamp: Date.now(),
        type: 'check',
        fenceName: fence.name,
        fenceId: fence.id,
        distance,
        radius: fence.radius,
        effectiveRadius,
        margin,
        marginPercent,
        isInside: true,
        source,
        gpsAccuracy,
      }).catch(() => {});
      
      return { isInside: true, fence, distance };
    }
  }

  if (closestFence) {
    const effectiveRadius = useHysteresis ? closestFence.radius * HYSTERESIS_EXIT : closestFence.radius;
    const margin = effectiveRadius - closestDistance;
    const marginPercent = (margin / effectiveRadius) * 100;
    
    logPingPongEvent({
      timestamp: Date.now(),
      type: 'check',
      fenceName: closestFence.name,
      fenceId: closestFence.id,
      distance: closestDistance,
      radius: closestFence.radius,
      effectiveRadius,
      margin,
      marginPercent,
      isInside: false,
      source,
      gpsAccuracy,
    }).catch(() => {});
  }

  return { isInside: false, fence: null, distance: closestDistance };
}

// ============================================
// TTL HELPER (for heartbeat/pendingTTL)
// ============================================

export async function checkInsideFenceForTTL(
  lat: number, 
  lng: number
): Promise<{ isInside: boolean; fenceId?: string }> {
  const userId = await getBackgroundUserId();
  if (!userId) return { isInside: false };
  
  const result = await checkInsideFence(lat, lng, userId, true, 'heartbeat');
  return { isInside: result.isInside, fenceId: result.fence?.id };
}
