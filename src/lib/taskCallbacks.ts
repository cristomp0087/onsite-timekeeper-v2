/**
 * Task Callbacks - OnSite Timekeeper
 * 
 * Callback registration for geofence, location, heartbeat events.
 */

import { logger } from './logger';
import type {
  GeofenceCallback,
  LocationCallback,
  HeartbeatCallback,
  ReconcileCallback,
} from './backgroundTypes';

// ============================================
// CALLBACK STATE (module-level)
// ============================================

let geofenceCallback: GeofenceCallback | null = null;
let locationCallback: LocationCallback | null = null;
let heartbeatCallback: HeartbeatCallback | null = null;
let reconcileCallback: ReconcileCallback | null = null;

// ============================================
// CALLBACK SETTERS (public)
// ============================================

/**
 * Set geofence callback (used by bootstrap via backgroundTasks)
 */
export function setGeofenceCallback(callback: GeofenceCallback): void {
  geofenceCallback = callback;
  logger.debug('geofence', 'Geofence callback registered');
}

/**
 * Set reconcile callback (used by bootstrap via backgroundTasks)
 */
export function setReconcileCallback(callback: ReconcileCallback): void {
  reconcileCallback = callback;
  logger.debug('geofence', 'Reconcile callback registered');
}

/**
 * Clear all callbacks (used by bootstrap via backgroundTasks)
 */
export function clearCallbacks(): void {
  geofenceCallback = null;
  locationCallback = null;
  heartbeatCallback = null;
  reconcileCallback = null;
  logger.debug('geofence', 'Callbacks cleared');
}

// ============================================
// CALLBACK SETTERS (internal - not exported)
// ============================================

/**
 * Set location callback (internal use only)
 */
function setLocationCallback(callback: LocationCallback): void {
  locationCallback = callback;
  logger.debug('gps', 'Location callback registered');
}

/**
 * Set heartbeat callback (internal use only)
 */
function setHeartbeatCallback(callback: HeartbeatCallback): void {
  heartbeatCallback = callback;
  logger.debug('heartbeat', 'Heartbeat callback registered');
}

// ============================================
// CALLBACK GETTERS (for internal use by other modules)
// ============================================

/**
 * Get geofence callback (used by geofenceLogic)
 */
export function getGeofenceCallback(): GeofenceCallback | null {
  return geofenceCallback;
}

/**
 * Get location callback (used by backgroundTasks)
 */
export function getLocationCallback(): LocationCallback | null {
  return locationCallback;
}

/**
 * Get heartbeat callback (used by heartbeatLogic)
 */
export function getHeartbeatCallback(): HeartbeatCallback | null {
  return heartbeatCallback;
}

/**
 * Get reconcile callback (internal use only)
 */
function getReconcileCallback(): ReconcileCallback | null {
  return reconcileCallback;
}
