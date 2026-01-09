/**
 * Location Store - OnSite Timekeeper V2
 * 
 * Manages geofences and handles entry/exit events.
 * BACKWARD COMPATIBLE with V1 API
 * 
 * FIX: Added auto-start monitoring on initialize
 */

import { create } from 'zustand';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../lib/logger';
import {
  requestAllPermissions,
  getCurrentLocation,
  startGeofencing,
  stopGeofencing,
  startBackgroundLocation,
  stopBackgroundLocation,
  isGeofencingActive as checkGeofencingActive,
  type LocationResult,
} from '../lib/location';
import {
  // Location CRUD
  createLocation,
  getLocations,
  getLocationById,
  updateLocation,
  removeLocation as removeLocationDb,
  updateLastSeen,
  // Records
  createEntryRecord,
  registerExit,
  getOpenSession,
  getGlobalActiveSession,
  // V2: New imports
  trackMetric,
  trackGeofenceTrigger,
  trackFeatureUsed,
  recordEntryAudit,
  recordExitAudit,
  captureGeofenceError,
  // Types
  type LocationDB,
  type RecordDB,
} from '../lib/database';
import {
  setGeofenceCallback,
  setHeartbeatCallback,
  updateActiveFences,
  startHeartbeat,
  stopHeartbeat,
  addToSkippedToday,
  removeFromSkippedToday,
  type GeofenceEvent,
  type HeartbeatResult,
} from '../lib/backgroundTasks';
import { useAuthStore } from './authStore';
import { useSyncStore } from './syncStore';
import { useRecordStore } from './recordStore';

// ============================================
// CONSTANTS
// ============================================

const MONITORING_STATE_KEY = '@onsite:monitoringEnabled';

// ============================================
// TYPES (BACKWARD COMPATIBLE)
// ============================================

// Alias for backward compatibility
export type WorkLocation = LocationDB;

// Location coordinates type
export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export interface LocationState {
  // State
  locations: LocationDB[];
  isLoading: boolean;
  isMonitoring: boolean;
  currentLocation: LocationCoords | null;
  activeSession: RecordDB | null;
  permissionStatus: 'unknown' | 'granted' | 'denied' | 'restricted';
  lastGeofenceEvent: GeofenceEvent | null;
  
  // Timer configs (from settings)
  entryTimeout: number;
  exitTimeout: number;
  pauseTimeout: number;
  
  // Actions
  initialize: () => Promise<void>;
  reloadLocations: () => Promise<void>;
  addLocation: (name: string, latitude: number, longitude: number, radius?: number, color?: string) => Promise<string>;
  editLocation: (id: string, updates: Partial<Pick<LocationDB, 'name' | 'latitude' | 'longitude' | 'radius' | 'color'>>) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  removeLocation: (id: string) => Promise<void>; // Alias for deleteLocation
  updateLocation: (id: string, updates: Partial<Pick<LocationDB, 'name' | 'latitude' | 'longitude' | 'radius' | 'color'>>) => Promise<void>; // Alias
  startMonitoring: () => Promise<boolean>;
  stopMonitoring: () => Promise<void>;
  handleGeofenceEvent: (event: GeofenceEvent) => Promise<void>;
  handleManualEntry: (locationId: string) => Promise<string>;
  handleManualExit: (locationId: string) => Promise<void>;
  skipLocationToday: (locationId: string) => Promise<void>;
  unskipLocationToday: (locationId: string) => Promise<void>;
  refreshCurrentLocation: () => Promise<LocationCoords | null>;
  setTimerConfigs: (entry: number, exit: number, pause: number) => void;
  
  // Debug
  getDebugState: () => object;
}

// ============================================
// SELECTORS (BACKWARD COMPATIBLE)
// ============================================

export const selectLocations = (state: LocationState) => state.locations;
export const selectCurrentLocation = (state: LocationState) => state.currentLocation;
export const selectIsGeofencingActive = (state: LocationState) => state.isMonitoring;
export const selectActiveGeofence = (state: LocationState) => state.activeSession?.location_id || null;
export const selectPermissions = (state: LocationState) => state.permissionStatus;

// ============================================
// HELPER: Persist monitoring state
// ============================================

async function saveMonitoringState(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(MONITORING_STATE_KEY, JSON.stringify(enabled));
  } catch (error) {
    logger.error('geofence', 'Error saving monitoring state', { error: String(error) });
  }
}

async function loadMonitoringState(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(MONITORING_STATE_KEY);
    // Default to TRUE - we want monitoring ON by default for automation
    return value !== null ? JSON.parse(value) : true;
  } catch (error) {
    logger.error('geofence', 'Error loading monitoring state', { error: String(error) });
    return true; // Default ON
  }
}

// ============================================
// STORE
// ============================================

export const useLocationStore = create<LocationState>((set, get) => ({
  // Initial state
  locations: [],
  isLoading: true,
  isMonitoring: false,
  currentLocation: null,
  activeSession: null,
  permissionStatus: 'unknown',
  lastGeofenceEvent: null,
  entryTimeout: 120,
  exitTimeout: 60,
  pauseTimeout: 30,

  // ============================================
  // INITIALIZE
  // ============================================
  initialize: async () => {
    logger.info('boot', '📍 Initializing location store V2...');
    set({ isLoading: true });

    try {
      // Check permissions
      const permissions = await requestAllPermissions();
      
      if (!permissions.foreground) {
        logger.warn('geofence', 'Location permission denied');
        set({ permissionStatus: 'denied', isLoading: false });
        return;
      }

      set({ permissionStatus: permissions.background ? 'granted' : 'restricted' });

      // Load locations
      await get().reloadLocations();

      // Get current location
      const location = await getCurrentLocation();
      if (location) {
        set({ 
          currentLocation: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.accuracy,
          }
        });
      }

      // Setup geofence callback
      setGeofenceCallback(async (event) => {
        await get().handleGeofenceEvent(event);
      });

      // Setup heartbeat callback
      setHeartbeatCallback(async (result: HeartbeatResult) => {
        logger.debug('heartbeat', 'Heartbeat result received', {
          isInside: result.isInsideFence,
          fence: result.fenceName,
        });
        
        // Update active session state
        const userId = useAuthStore.getState().getUserId();
        if (userId) {
          const session = await getGlobalActiveSession(userId);
          set({ activeSession: session });
        }
      });

      // Check for active session
      const userId = useAuthStore.getState().getUserId();
      if (userId) {
        const session = await getGlobalActiveSession(userId);
        set({ activeSession: session });
      }

      // ============================================
      // AUTO-START MONITORING (NEW!)
      // ============================================
      const { locations, permissionStatus } = get();
      const shouldMonitor = await loadMonitoringState();
      
      if (shouldMonitor && permissionStatus === 'granted' && locations.length > 0) {
        logger.info('geofence', '🚀 Auto-starting monitoring...');
        await get().startMonitoring();
      } else {
        logger.info('geofence', 'Monitoring not auto-started', {
          shouldMonitor,
          hasPermission: permissionStatus === 'granted',
          hasLocations: locations.length > 0,
        });
      }

      // Also check if geofencing was already running (e.g., app was killed and restarted)
      const isAlreadyRunning = await checkGeofencingActive();
      if (isAlreadyRunning && !get().isMonitoring) {
        logger.info('geofence', '♻️ Geofencing was already active, updating state');
        set({ isMonitoring: true });
      }

      logger.info('boot', '✅ Location store V2 initialized');
    } catch (error) {
      logger.error('boot', 'Error initializing location store', { error: String(error) });
    } finally {
      set({ isLoading: false });
    }
  },

  // ============================================
  // RELOAD LOCATIONS
  // ============================================
  reloadLocations: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      logger.warn('database', 'Cannot reload locations: no userId');
      return;
    }

    try {
      const locations = await getLocations(userId);
      set({ locations });

      // Update background task cache
      const activeFences = locations.map(l => ({
        id: l.id,
        name: l.name,
        latitude: l.latitude,
        longitude: l.longitude,
        radius: l.radius,
      }));
      updateActiveFences(activeFences);

      logger.debug('database', `Loaded ${locations.length} locations`);
    } catch (error) {
      logger.error('database', 'Error loading locations', { error: String(error) });
    }
  },

  // ============================================
  // ADD LOCATION
  // ============================================
  addLocation: async (name, latitude, longitude, radius = 100, color = '#3B82F6') => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) throw new Error('User not authenticated');

    try {
      const id = await createLocation({
        userId,
        name,
        latitude,
        longitude,
        radius,
        color,
      });

      // V2: Track feature usage
      await trackFeatureUsed(userId, 'create_location');

      // Reload and restart monitoring
      await get().reloadLocations();
      
      if (get().isMonitoring) {
        await get().stopMonitoring();
        await get().startMonitoring();
      } else {
        // Auto-start if this is the first location
        const { locations, permissionStatus } = get();
        if (permissionStatus === 'granted' && locations.length > 0) {
          logger.info('geofence', '🚀 First location added, auto-starting monitoring');
          await get().startMonitoring();
        }
      }

      // Sync to cloud
      await useSyncStore.getState().syncLocationsOnly();

      logger.info('database', `📍 Location added: ${name}`);
      return id;
    } catch (error) {
      logger.error('database', 'Error adding location', { error: String(error) });
      throw error;
    }
  },

  // ============================================
  // EDIT LOCATION
  // ============================================
  editLocation: async (id, updates) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) throw new Error('User not authenticated');

    try {
      await updateLocation(id, updates);

      // V2: Track feature usage
      await trackFeatureUsed(userId, 'edit_location');

      // Reload and restart monitoring
      await get().reloadLocations();
      
      if (get().isMonitoring) {
        await get().stopMonitoring();
        await get().startMonitoring();
      }

      // Sync to cloud
      await useSyncStore.getState().syncLocationsOnly();

      logger.info('database', `📍 Location updated: ${id}`);
    } catch (error) {
      logger.error('database', 'Error editing location', { error: String(error) });
      throw error;
    }
  },

  // Alias for editLocation (backward compat)
  updateLocation: async (id, updates) => {
    return get().editLocation(id, updates);
  },

  // ============================================
  // DELETE LOCATION
  // ============================================
  deleteLocation: async (id) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) throw new Error('User not authenticated');

    try {
      // Check for active session
      const session = await getOpenSession(userId, id);
      if (session) {
        // Register exit first
        await registerExit(userId, id);
      }

      await removeLocationDb(userId, id);

      // V2: Track feature usage
      await trackFeatureUsed(userId, 'delete_location');

      // Reload and restart monitoring
      await get().reloadLocations();
      
      if (get().isMonitoring) {
        await get().stopMonitoring();
        if (get().locations.length > 0) {
          await get().startMonitoring();
        }
      }

      // Sync to cloud
      await useSyncStore.getState().syncLocationsOnly();

      // Update active session state
      const newSession = await getGlobalActiveSession(userId);
      set({ activeSession: newSession });

      // Notify record store
      useRecordStore.getState().reloadData?.();

      logger.info('database', `🗑️ Location deleted: ${id}`);
    } catch (error) {
      logger.error('database', 'Error deleting location', { error: String(error) });
      throw error;
    }
  },

  // Alias for deleteLocation (backward compat)
  removeLocation: async (id) => {
    return get().deleteLocation(id);
  },

  // ============================================
  // START MONITORING
  // ============================================
  startMonitoring: async () => {
    const { locations, permissionStatus } = get();

    if (permissionStatus !== 'granted') {
      logger.warn('geofence', 'Cannot start monitoring: permission not granted');
      return false;
    }

    if (locations.length === 0) {
      logger.warn('geofence', 'Cannot start monitoring: no locations');
      return false;
    }

    try {
      // Start geofencing
      const regions = locations.map(l => ({
        identifier: l.id,
        latitude: l.latitude,
        longitude: l.longitude,
        radius: l.radius,
        notifyOnEnter: true,
        notifyOnExit: true,
      }));

      await startGeofencing(regions);

      // Start background location
      await startBackgroundLocation();

      // Start heartbeat
      await startHeartbeat();

      // Save state for next app launch
      await saveMonitoringState(true);

      set({ isMonitoring: true });
      logger.info('geofence', `✅ Monitoring started (${locations.length} fences)`);
      return true;
    } catch (error) {
      logger.error('geofence', 'Error starting monitoring', { error: String(error) });
      return false;
    }
  },

  // ============================================
  // STOP MONITORING
  // ============================================
  stopMonitoring: async () => {
    try {
      await stopGeofencing();
      await stopBackgroundLocation();
      await stopHeartbeat();

      // Save state for next app launch
      await saveMonitoringState(false);

      set({ isMonitoring: false });
      logger.info('geofence', '⏹️ Monitoring stopped');
    } catch (error) {
      logger.error('geofence', 'Error stopping monitoring', { error: String(error) });
    }
  },

  // ============================================
  // HANDLE GEOFENCE EVENT
  // ============================================
  handleGeofenceEvent: async (event) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      logger.warn('geofence', 'Cannot handle event: no userId');
      return;
    }

    set({ lastGeofenceEvent: event });

    const location = await getLocationById(event.regionIdentifier);
    if (!location) {
      logger.warn('geofence', `Location not found: ${event.regionIdentifier}`);
      return;
    }

    logger.info('geofence', `📍 Geofence ${event.type}: ${location.name}`);

    // Get current GPS for audit
    let coords: LocationResult | null = null;
    try {
      coords = await getCurrentLocation();
    } catch (e) {
      logger.warn('geofence', 'Could not get GPS for audit');
    }

    // V2: Track geofence trigger
    await trackGeofenceTrigger(userId, coords?.accuracy ?? null);

    try {
      if (event.type === 'enter') {
        // Check for existing open session
        const existingSession = await getOpenSession(userId, location.id);
        if (existingSession) {
          logger.info('geofence', 'Session already active, ignoring entry');
          return;
        }

        // Create entry record
        const sessionId = await createEntryRecord({
          userId,
          locationId: location.id,
          locationName: location.name,
          type: 'automatic',
          color: location.color,
        });

        // V2: Record audit (GPS proof)
        if (coords) {
          await recordEntryAudit(
            userId,
            coords.coords.latitude,
            coords.coords.longitude,
            coords.accuracy ?? null,
            location.id,
            location.name,
            sessionId
          );
        }

        // Update last seen
        await updateLastSeen(location.id);

        // Update state
        const session = await getGlobalActiveSession(userId);
        set({ activeSession: session });

        // Notify record store
        useRecordStore.getState().reloadData?.();

        logger.info('geofence', `✅ Entry recorded: ${location.name}`);

      } else if (event.type === 'exit') {
        // Find open session for this location
        const session = await getOpenSession(userId, location.id);
        if (!session) {
          logger.info('geofence', 'No active session, ignoring exit');
          return;
        }

        // V2: Record audit (GPS proof) BEFORE exit
        if (coords) {
          await recordExitAudit(
            userId,
            coords.coords.latitude,
            coords.coords.longitude,
            coords.accuracy ?? null,
            location.id,
            location.name,
            session.id
          );
        }

        // Register exit
        await registerExit(userId, location.id);

        // Update state
        const newSession = await getGlobalActiveSession(userId);
        set({ activeSession: newSession });

        // Notify record store
        useRecordStore.getState().reloadData?.();

        logger.info('geofence', `✅ Exit recorded: ${location.name}`);
      }

      // Sync records
      await useSyncStore.getState().syncRecordsOnly();

    } catch (error) {
      logger.error('geofence', 'Error handling geofence event', { error: String(error) });
      
      // V2: Capture error
      await captureGeofenceError(error as Error, {
        userId,
        action: `geofence_${event.type}`,
        locationId: location.id,
      });
    }
  },

  // ============================================
  // MANUAL ENTRY
  // ============================================
  handleManualEntry: async (locationId) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) throw new Error('User not authenticated');

    const location = await getLocationById(locationId);
    if (!location) throw new Error('Location not found');

    // Check for existing session
    const existingSession = await getOpenSession(userId, locationId);
    if (existingSession) {
      throw new Error('Session already active');
    }

    // V2: Track feature usage
    await trackFeatureUsed(userId, 'manual_entry');

    // Create manual entry
    const sessionId = await createEntryRecord({
      userId,
      locationId: location.id,
      locationName: location.name,
      type: 'manual',
      color: location.color,
    });

    // Get GPS for audit (best effort)
    try {
      const coords = await getCurrentLocation();
      if (coords) {
        await recordEntryAudit(
          userId,
          coords.coords.latitude,
          coords.coords.longitude,
          coords.accuracy ?? null,
          location.id,
          location.name,
          sessionId
        );
      }
    } catch (e) {
      logger.warn('geofence', 'Could not record GPS audit for manual entry');
    }

    // Update state
    const session = await getGlobalActiveSession(userId);
    set({ activeSession: session });

    // Notify record store
    useRecordStore.getState().reloadData?.();

    // Sync
    await useSyncStore.getState().syncRecordsOnly();

    logger.info('geofence', `✅ Manual entry: ${location.name}`);
    return sessionId;
  },

  // ============================================
  // MANUAL EXIT
  // ============================================
  handleManualExit: async (locationId) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) throw new Error('User not authenticated');

    const location = await getLocationById(locationId);
    if (!location) throw new Error('Location not found');

    const session = await getOpenSession(userId, locationId);
    if (!session) {
      throw new Error('No active session');
    }

    // Get GPS for audit (best effort)
    try {
      const coords = await getCurrentLocation();
      if (coords) {
        await recordExitAudit(
          userId,
          coords.coords.latitude,
          coords.coords.longitude,
          coords.accuracy ?? null,
          location.id,
          location.name,
          session.id
        );
      }
    } catch (e) {
      logger.warn('geofence', 'Could not record GPS audit for manual exit');
    }

    // Register exit
    await registerExit(userId, locationId);

    // Update state
    const newSession = await getGlobalActiveSession(userId);
    set({ activeSession: newSession });

    // Notify record store
    useRecordStore.getState().reloadData?.();

    // Sync
    await useSyncStore.getState().syncRecordsOnly();

    logger.info('geofence', `✅ Manual exit: ${location.name}`);
  },

  // ============================================
  // SKIP/UNSKIP LOCATION TODAY
  // ============================================
  skipLocationToday: async (locationId) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;

    await addToSkippedToday(locationId);

    // If there's an active session for this location, end it
    const session = await getOpenSession(userId, locationId);
    if (session) {
      await registerExit(userId, locationId);
      
      const newSession = await getGlobalActiveSession(userId);
      set({ activeSession: newSession });
      
      useRecordStore.getState().reloadData?.();
    }

    logger.info('geofence', `😴 Location skipped for today: ${locationId}`);
  },

  unskipLocationToday: async (locationId) => {
    await removeFromSkippedToday(locationId);
    logger.info('geofence', `👀 Location unskipped: ${locationId}`);
  },

  // ============================================
  // REFRESH CURRENT LOCATION
  // ============================================
  refreshCurrentLocation: async () => {
    try {
      const location = await getCurrentLocation();
      if (location) {
        const coords: LocationCoords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.accuracy,
        };
        set({ currentLocation: coords });
        return coords;
      }
      return null;
    } catch (error) {
      logger.error('gps', 'Error refreshing location', { error: String(error) });
      return null;
    }
  },

  // ============================================
  // TIMER CONFIGS
  // ============================================
  setTimerConfigs: (entry, exit, pause) => {
    set({
      entryTimeout: entry,
      exitTimeout: exit,
      pauseTimeout: pause,
    });
    logger.debug('sync', 'Timer configs updated', { entry, exit, pause });
  },

  // ============================================
  // DEBUG
  // ============================================
  getDebugState: () => {
    const state = get();
    return {
      locations: state.locations.length,
      isMonitoring: state.isMonitoring,
      permissionStatus: state.permissionStatus,
      activeSession: state.activeSession?.location_name || null,
      lastEvent: state.lastGeofenceEvent?.type || null,
      currentLocation: state.currentLocation ? {
        lat: state.currentLocation.latitude.toFixed(6),
        lng: state.currentLocation.longitude.toFixed(6),
      } : null,
      timerConfigs: {
        entry: state.entryTimeout,
        exit: state.exitTimeout,
        pause: state.pauseTimeout,
      },
    };
  },
}));
