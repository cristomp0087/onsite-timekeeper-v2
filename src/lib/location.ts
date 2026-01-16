/**
 * Location Service - OnSite Timekeeper
 * 
 * - GPS permissions (foreground and background)
 * - Current location (high accuracy)
 * - Real-time position watch
 * - Native geofencing via expo-location
 * - Background location updates
 * 
 * FIXED: Import constants from shared file to avoid require cycle
 */

import * as Location from 'expo-location';
import { logger } from './logger';
import { LOCATION_TASK, GEOFENCE_TASK } from './backgroundTypes';

// Internal aliases (shorter names for this file)
const LOCATION_TASK_NAME = LOCATION_TASK;
const GEOFENCE_TASK_NAME = GEOFENCE_TASK;

// ============================================
// TYPES
// ============================================

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface LocationResult {
  coords: Coordinates;
  accuracy: number | null;
  timestamp: number;
}

export interface GeofenceRegion {
  identifier: string;
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter?: boolean;
  notifyOnExit?: boolean;
}

export interface PermissionsStatus {
  foreground: boolean;
  background: boolean;
}

// ============================================
// PERMISSIONS
// ============================================

/**
 * Check current permission status
 */
export async function checkPermissions(): Promise<PermissionsStatus> {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = await Location.getBackgroundPermissionsAsync();

    return {
      foreground: foreground.status === 'granted',
      background: background.status === 'granted',
    };
  } catch (error) {
    logger.error('gps', 'Error checking permissions', { error: String(error) });
    return { foreground: false, background: false };
  }
}

/**
 * Request foreground location permission
 */
export async function requestForegroundPermission(): Promise<boolean> {
  try {
    logger.info('gps', 'Requesting location permission (foreground)');
    const { status } = await Location.requestForegroundPermissionsAsync();
    const granted = status === 'granted';
    logger.info('gps', `Foreground permission: ${granted ? '✅' : '❌'}`);
    return granted;
  } catch (error) {
    logger.error('gps', 'Error requesting foreground permission', { error: String(error) });
    return false;
  }
}

/**
 * Request background location permission
 * IMPORTANT: Must be called AFTER obtaining foreground permission
 */
export async function requestBackgroundPermission(): Promise<boolean> {
  try {
    logger.info('gps', 'Requesting location permission (background)');
    const { status } = await Location.requestBackgroundPermissionsAsync();
    const granted = status === 'granted';
    logger.info('gps', `Background permission: ${granted ? '✅' : '❌'}`);
    return granted;
  } catch (error) {
    logger.error('gps', 'Error requesting background permission', { error: String(error) });
    return false;
  }
}

/**
 * Request all necessary permissions in sequence
 */
export async function requestAllPermissions(): Promise<PermissionsStatus> {
  const foreground = await requestForegroundPermission();
  
  if (!foreground) {
    return { foreground: false, background: false };
  }

  const background = await requestBackgroundPermission();
  return { foreground, background };
}



// ============================================
// CURRENT LOCATION (Single-flight)
// ============================================

let pendingLocationPromise: Promise<LocationResult | null> | null = null;

/**
 * Get current location with high accuracy
 * Single-flight: reuses pending request to avoid duplicate GPS calls
 */
export async function getCurrentLocation(): Promise<LocationResult | null> {
  // Single-flight: reutiliza promise em andamento
  if (pendingLocationPromise) {
    logger.debug('gps', '♻️ Reusing pending location request');
    return pendingLocationPromise;
  }

  pendingLocationPromise = getCurrentLocationInternal();
  
  try {
    return await pendingLocationPromise;
  } finally {
    // Limpa após 2s para permitir nova chamada
    setTimeout(() => { pendingLocationPromise = null; }, 2000);
  }
}

async function getCurrentLocationInternal(): Promise<LocationResult | null> {
  try {
    const permissions = await checkPermissions();
    if (!permissions.foreground) {
      const granted = await requestForegroundPermission();
      if (!granted) {
        logger.warn('gps', 'No permission to get location');
        return null;
      }
    }

    logger.debug('gps', 'Getting current location...');

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const result: LocationResult = {
      coords: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      },
      accuracy: location.coords.accuracy ?? null,
      timestamp: location.timestamp,
    };

    logger.info('gps', '📍 Location obtained', {
      lat: result.coords.latitude.toFixed(6),
      lng: result.coords.longitude.toFixed(6),
      accuracy: result.accuracy ? `${result.accuracy.toFixed(0)}m` : 'N/A',
    });

    return result;
  } catch (error) {
    logger.error('gps', 'Error getting location', { error: String(error) });
    return null;
  }
}
// ============================================
// POSITION WATCH (REAL-TIME)
// ============================================

let locationSubscription: Location.LocationSubscription | null = null;

export interface WatchOptions {
  accuracy?: Location.Accuracy;
  distanceInterval?: number; // meters
  timeInterval?: number; // milliseconds
}

/**
 * Start real-time position monitoring
 */
export async function startPositionWatch(
  onUpdate: (location: LocationResult) => void,
  options: WatchOptions = {}
): Promise<boolean> {
  try {
    const permissions = await checkPermissions();
    if (!permissions.foreground) {
      logger.warn('gps', 'No permission for position watch');
      return false;
    }

    // Stop previous watch if exists
    await stopPositionWatch();

    logger.info('gps', '👁️ Starting position watch');

    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: options.accuracy ?? Location.Accuracy.Balanced,
        distanceInterval: options.distanceInterval ?? 10,
        timeInterval: options.timeInterval ?? 5000,
      },
      (location) => {
        const result: LocationResult = {
          coords: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          },
          accuracy: location.coords.accuracy ?? null,
          timestamp: location.timestamp,
        };

        logger.debug('gps', 'Position update', {
          lat: result.coords.latitude.toFixed(6),
          lng: result.coords.longitude.toFixed(6),
        });

        onUpdate(result);
      }
    );

    return true;
  } catch (error) {
    logger.error('gps', 'Error starting position watch', { error: String(error) });
    return false;
  }
}

/**
 * Stop position monitoring
 */
export async function stopPositionWatch(): Promise<void> {
  if (locationSubscription) {
    logger.info('gps', '⏹️ Stopping position watch');
    locationSubscription.remove();
    locationSubscription = null;
  }
}

// ============================================
// GEOFENCING
// ============================================

/**
 * Start geofence monitoring
 */
export async function startGeofencing(regions: GeofenceRegion[]): Promise<boolean> {
  try {
    if (regions.length === 0) {
      logger.warn('geofence', 'No regions to monitor');
      return false;
    }

    const permissions = await checkPermissions();
    if (!permissions.background) {
      const granted = await requestBackgroundPermission();
      if (!granted) {
        logger.warn('geofence', 'No background permission for geofencing');
        return false;
      }
    }

    logger.info('geofence', `🎯 Starting geofencing for ${regions.length} region(s)`);

    // Log regions for debugging
    regions.forEach((r, idx) => {
      logger.debug('geofence', `Region ${idx + 1}: ${r.identifier} @ (${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}) radius=${r.radius}m`);
    });

    // Configure regions with EXPLICIT notifyOnExit: true
    const locationRegions = regions.map(r => ({
      identifier: r.identifier,
      latitude: r.latitude,
      longitude: r.longitude,
      radius: r.radius,
      notifyOnEnter: true,  // Always enable entry notifications
      notifyOnExit: true,   // Always enable exit notifications
    }));

    // Stop existing geofencing first (clean slate)
    const wasRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
    if (wasRunning) {
      logger.info('geofence', '🔄 Stopping existing geofencing before restart');
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }

    // Start geofencing
    await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, locationRegions);

    // Verify it started
    const isNowRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
    if (!isNowRunning) {
      logger.error('geofence', '❌ Geofencing failed to start (hasStartedGeofencingAsync = false)');
      return false;
    }

    logger.info('geofence', `✅ Geofencing started successfully with ${locationRegions.length} regions`);
    logger.info('geofence', `✅ notifyOnEnter: true, notifyOnExit: true for all regions`);

    return true;
  } catch (error) {
    logger.error('geofence', 'Error starting geofencing', { error: String(error) });
    return false;
  }
}

/**
 * Stop geofence monitoring
 */
export async function stopGeofencing(): Promise<void> {
  try {
    const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
    if (isRunning) {
      logger.info('geofence', '⏹️ Stopping geofencing');
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
  } catch (error) {
    logger.error('geofence', 'Error stopping geofencing', { error: String(error) });
  }
}

/**
 * Check if geofencing is active
 */
export async function isGeofencingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
  } catch {
    return false;
  }
}

// ============================================
// BACKGROUND LOCATION UPDATES
// ============================================

/**
 * Start background location updates
 * Useful as fallback when native geofencing is slow
 */
export async function startBackgroundLocation(): Promise<boolean> {
  try {
    const permissions = await checkPermissions();
    if (!permissions.background) {
      logger.warn('gps', 'No background permission');
      return false;
    }

    logger.info('gps', '🔄 Starting background location');

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50, // Update every 50m of movement
      timeInterval: 60000, // Or every 1 minute
      deferredUpdatesInterval: 300000, // Batch every 5 min
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'OnSite Timekeeper',
        notificationBody: 'Tracking work hours',
        notificationColor: "#868584ff", // OnSite Amber color
      },
    });

    logger.info('gps', '✅ Background location started');
    return true;
  } catch (error) {
    logger.error('gps', 'Error starting background location', { error: String(error) });
    return false;
  }
}

/**
 * Stop background location updates
 */
export async function stopBackgroundLocation(): Promise<void> {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (isRunning) {
      logger.info('gps', '⏹️ Stopping background location');
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  } catch (error) {
    logger.error('gps', 'Error stopping background location', { error: String(error) });
  }
}

/**
 * Check if background location is active
 */
export async function isBackgroundLocationActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

// ============================================
// UTILITIES
// ============================================

/**
 * Calculate distance between two points (Haversine)
 */
export function calculateDistance(
  point1: Coordinates,
  point2: Coordinates
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (point1.latitude * Math.PI) / 180;
  const φ2 = (point2.latitude * Math.PI) / 180;
  const Δφ = ((point2.latitude - point1.latitude) * Math.PI) / 180;
  const Δλ = ((point2.longitude - point1.longitude) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Check if a point is inside a geofence
 */
export function isInsideGeofence(
  position: Coordinates,
  geofence: GeofenceRegion
): boolean {
  const distance = calculateDistance(position, {
    latitude: geofence.latitude,
    longitude: geofence.longitude,
  });
  return distance <= geofence.radius;
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}
