/**
 * Background Types - OnSite Timekeeper
 * 
 * Types and constants for background tasks.
 * 
 * NOTE: Re-exports removed - import directly from source modules
 */

import * as Location from 'expo-location';

// ============================================
// TASK NAMES
// ============================================

export const GEOFENCE_TASK = 'onsite-geofence';
export const HEARTBEAT_TASK = 'onsite-heartbeat-task';
export const LOCATION_TASK = 'onsite-location-task';

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

export interface InternalGeofenceEvent {
  region: Location.LocationRegion;
  state: Location.GeofencingRegionState;
}

export interface QueuedEvent {
  event: InternalGeofenceEvent;
  queuedAt: number;
}

// ============================================
// CALLBACK TYPES
// ============================================

export type GeofenceCallback = (event: GeofenceEvent) => void;
export type LocationCallback = (location: Location.LocationObject) => void;
export type HeartbeatCallback = (result: HeartbeatResult) => Promise<void>;
export type ReconcileCallback = () => Promise<void>;

// ============================================
// CONSTANTS
// ============================================

export const BACKGROUND_USER_KEY = '@onsite/background_user_id';
export const RECONFIGURE_DEBOUNCE_MS = 5000;
export const EVENT_DEDUP_WINDOW_MS = 10000;
export const MAX_QUEUE_SIZE = 20;
export const MAX_QUEUE_AGE_MS = 30000; // 30 seconds
