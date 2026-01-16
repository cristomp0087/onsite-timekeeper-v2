/**
 * Session Helpers - OnSite Timekeeper
 * 
 * Pure types, interfaces, and helper functions for work session management.
 * No store dependencies - can be imported anywhere without circular imports.
 */

import { logger } from '../lib/logger';
import { cancelNotification } from '../lib/notifications';
import { clearPendingAction as clearPersistedPending } from '../lib/pendingTTL';
import type { Coordinates } from '../lib/location';

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

export interface QueuedGeofenceEvent {
  type: 'enter' | 'exit';
  locationId: string;
  locationName: string | null;
  coords?: Coordinates & { accuracy?: number };
  timestamp: number;
}

// ============================================
// BOOT GATE STATE (module-level)
// ============================================

let isAppReady = false;
const eventQueue: QueuedGeofenceEvent[] = [];
const MAX_QUEUE_SIZE = 10;
const MAX_EVENT_AGE_MS = 30000; // 30 seconds

// Store reference for drainEventQueue
let storeRef: WorkSessionStore | null = null;

// Type for the store (minimal interface needed by helpers)
export interface WorkSessionStore {
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
}

// ============================================
// VIGILANCE STATE (module-level)
// ============================================

let activeVigilanceInterval: ReturnType<typeof setInterval> | null = null;
let activeVigilanceLocationId: string | null = null;

// ============================================
// VIGILANCE FUNCTIONS
// ============================================

export function clearVigilanceInterval(): void {
  if (activeVigilanceInterval) {
    clearInterval(activeVigilanceInterval);
    activeVigilanceInterval = null;
    activeVigilanceLocationId = null;
    logger.debug('session', '👁️ Vigilance interval cleared');
  }
}

export function setVigilanceInterval(
  interval: ReturnType<typeof setInterval>,
  locationId: string
): void {
  activeVigilanceInterval = interval;
  activeVigilanceLocationId = locationId;
}

export function getVigilanceInterval(): ReturnType<typeof setInterval> | null {
  return activeVigilanceInterval;
}

export function getVigilanceLocationId(): string | null {
  return activeVigilanceLocationId;
}

// ============================================
// BOOT GATE FUNCTIONS
// ============================================

export function logBootGate(message: string, data?: Record<string, unknown>): void {
  logger.debug('session', `🚪 BOOT_GATE: ${message}`, data);
}

export function isBootReady(): boolean {
  return isAppReady;
}

export function queueEvent(event: QueuedGeofenceEvent): void {
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

export function drainEventQueue(): void {
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

export function markAppReady(): void {
  if (isAppReady) return;
  
  isAppReady = true;
  logger.info('session', '✅ App READY - processing queued events');
  
  // Small delay to ensure all stores are fully initialized
  setTimeout(() => {
    drainEventQueue();
  }, 100);
}

export function setStoreRef(store: WorkSessionStore): void {
  storeRef = store;
}

export function resetBootGate(): void {
  isAppReady = false;
  eventQueue.length = 0;
  storeRef = null;
  logger.debug('session', '🔄 Boot gate reset');
}

// ============================================
// LOCATION NAME RESOLVER
// ============================================

export function resolveLocationName(locationId: string): string {
  try {
    // Try recordStore first
    const { useRecordStore } = require('../stores/recordStore');
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
    const { useLocationStore } = require('../stores/locationStore');
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
// PENDING ACTION HELPERS
// ============================================

export async function clearPendingAction(pendingAction: PendingAction | null): Promise<void> {
  if (!pendingAction) return;
  
  clearTimeout(pendingAction.timeoutId);
  if (pendingAction.notificationId) {
    await cancelNotification(pendingAction.notificationId);
  }
  
  // Also clear from AsyncStorage (TTL persistence)
  await clearPersistedPending();
}

export function createPendingAction(
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

export function createPauseState(
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
