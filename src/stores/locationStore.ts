/**
 * Location Store - OnSite Timekeeper
 * 
 * Manages:
 * - Work locations (CRUD)
 * - Current user location
 * - Geofencing (entry/exit monitoring)
 * - Heartbeat (periodic verification)
 * - Backup polling
 * 
 * REFACTORED: All PT names removed, English only
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../lib/logger';
import {
  getCurrentLocation,
  startPositionWatch,
  stopPositionWatch,
  startGeofencing,
  stopGeofencing,
  startBackgroundLocation,
  stopBackgroundLocation,
  checkPermissions,
  calculateDistance,
  type Coordinates,
  type GeofenceRegion,
  type PermissionsStatus,
} from '../lib/location';
import {
  createLocation,
  getLocations,
  removeLocation as dbRemoveLocation,
  updateLocation as dbUpdateLocation,
  initDatabase,
  registerHeartbeat,
} from '../lib/database';
import {
  setGeofenceCallback,
  setHeartbeatCallback,
  updateActiveFences,
  startHeartbeat,
  stopHeartbeat,
  type GeofenceEvent,
  type HeartbeatResult,
  type ActiveFence,
} from '../lib/backgroundTasks';
import { useWorkSessionStore } from './workSessionStore';
import { useAuthStore } from './authStore';

// ============================================
// CONSTANTS
// ============================================

const POLLING_INTERVAL = 30000; // 30 seconds
const STORAGE_KEY_MONITORING = '@onsite_monitoring_active';
const EXIT_HYSTERESIS = 1.5; // Exit uses radius × 1.5 (prevents ping-pong)

// ============================================
// TYPES
// ============================================

export interface WorkLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  color: string;
  status: string;
}

interface LocationState {
  // Permissions
  permissions: PermissionsStatus;
  
  // Current location
  currentLocation: Coordinates | null;
  accuracy: number | null;
  lastUpdate: number | null;
  
  // Work locations
  locations: WorkLocation[];
  
  // Monitoring state
  activeGeofenceId: string | null;
  isGeofencingActive: boolean;
  isBackgroundActive: boolean;
  isPollingActive: boolean;
  isWatching: boolean;
  
  // Heartbeat
  lastHeartbeat: HeartbeatResult | null;
  isHeartbeatActive: boolean;
  
  // Event processing control
  isProcessingEvent: boolean;
  lastEvent: GeofenceEvent | null;
  
  // Initialization
  isInitialized: boolean;

  // Actions
  initialize: () => Promise<void>;
  updateLocation: () => Promise<void>;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  
  // CRUD Locations
  addLocation: (location: Omit<WorkLocation, 'id' | 'status'>) => Promise<string>;
  removeLocation: (id: string) => Promise<void>;
  editLocation: (id: string, updates: Partial<WorkLocation>) => Promise<void>;
  reloadLocations: () => Promise<void>;
  
  // Geofencing
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => Promise<void>;
  checkCurrentGeofence: () => void;
  
  // Heartbeat
  updateHeartbeatFences: () => void;
  
  // Polling
  startPolling: () => void;
  stopPolling: () => void;
}

// ============================================
// POLLING TIMER
// ============================================

let pollingTimer: ReturnType<typeof setInterval> | null = null;

// ============================================
// STORE
// ============================================

export const useLocationStore = create<LocationState>((set, get) => ({
  // Properties
  permissions: { foreground: false, background: false },
  currentLocation: null,
  accuracy: null,
  lastUpdate: null,
  locations: [],
  activeGeofenceId: null,
  isGeofencingActive: false,
  isBackgroundActive: false,
  isPollingActive: false,
  isWatching: false,
  lastHeartbeat: null,
  isHeartbeatActive: false,
  isProcessingEvent: false,
  lastEvent: null,
  isInitialized: false,

  initialize: async () => {
    if (get().isInitialized) return;

    logger.info('boot', '📍 Initializing location store...');

    try {
      // IMPORTANT: Initialize database first
      await initDatabase();

      // Import background tasks (registers the tasks)
      await import('../lib/backgroundTasks');

      // Check permissions - and request if not granted
      let permissions = await checkPermissions();
      if (!permissions.foreground || !permissions.background) {
        const { requestAllPermissions } = await import('../lib/location');
        permissions = await requestAllPermissions();
      }
      set({ permissions });
      
      // ============================================
      // NATIVE GEOFENCE CALLBACK
      // ============================================
      setGeofenceCallback((event) => {
        const { isProcessingEvent } = get();

        if (isProcessingEvent) {
          logger.warn('geofence', 'Event ignored - already processing another');
          return;
        }

        logger.info('geofence', `📍 Event: ${event.type} - ${event.regionIdentifier}`);
        set({ lastEvent: event, isProcessingEvent: true });

        // Process the event
        processGeofenceEvent(event, get, set);

        // Release processing after 1s
        setTimeout(() => set({ isProcessingEvent: false }), 1000);
      });

      // ============================================
      // HEARTBEAT CALLBACK (SAFETY NET)
      // ============================================
      setHeartbeatCallback(async (result: HeartbeatResult) => {
        logger.info('heartbeat', '💓 Processing heartbeat', {
          inside: result.isInsideFence,
          fence: result.fenceName,
        });

        set({ lastHeartbeat: result });

        const userId = useAuthStore.getState().getUserId();
        
        // Dynamically import recordStore to avoid circular dependency
        const { useRecordStore } = await import('./recordStore');
        const recordStore = useRecordStore.getState();
        const currentSession = recordStore.currentSession;

        // Register heartbeat
        if (userId && result.location) {
          try {
            await registerHeartbeat(
              userId,
              result.location.latitude,
              result.location.longitude,
              result.location.accuracy,
              result.isInsideFence,
              result.fenceId,
              result.fenceName,
              currentSession?.id || null,
              result.batteryLevel
            );
          } catch (error) {
            logger.error('heartbeat', 'Error registering heartbeat', { error: String(error) });
          }
        }

        // ============================================
        // BUSINESS LOGIC: Detect inconsistencies
        // ============================================

        // Case A: Has active session but is OUTSIDE the fence → missed exit!
        if (currentSession && currentSession.status === 'active' && !result.isInsideFence) {
          logger.warn('heartbeat', '⚠️ EXIT DETECTED BY HEARTBEAT!', {
            sessionId: currentSession.id,
            locationName: currentSession.location_name,
          });

          // End session automatically
          try {
            await recordStore.registerExit(currentSession.location_id);
            logger.info('heartbeat', '✅ Session ended by heartbeat');
            
            // Update activeGeofenceId
            set({ activeGeofenceId: null });
          } catch (error) {
            logger.error('heartbeat', 'Error ending session by heartbeat', { error: String(error) });
          }
        }

        // Case B: No active session but INSIDE a fence → missed entry?
        if (!currentSession && result.isInsideFence && result.fenceId) {
          logger.warn('heartbeat', '⚠️ POSSIBLE MISSED ENTRY', {
            fenceId: result.fenceId,
            fenceName: result.fenceName,
          });
          
          // Update activeGeofenceId so UI shows correctly
          set({ activeGeofenceId: result.fenceId });
        }
      });

      // Load locations from database
      await get().reloadLocations();

      // Get current location
      const location = await getCurrentLocation();
      if (location) {
        set({
          currentLocation: location.coords,
          accuracy: location.accuracy,
          lastUpdate: location.timestamp,
        });
      }

      set({ isInitialized: true });

      // Auto-start monitoring if needed
      await autoStartMonitoring(get, set);

      // Check current geofence
      get().checkCurrentGeofence();

      logger.info('boot', '✅ Location store initialized');
    } catch (error) {
      logger.error('gps', 'Error initializing location store', { error: String(error) });
      set({ isInitialized: true }); // Mark as initialized even with error
    }
  },

  updateLocation: async () => {
    try {
      const location = await getCurrentLocation();
      if (location) {
        set({
          currentLocation: location.coords,
          accuracy: location.accuracy,
          lastUpdate: location.timestamp,
        });
        get().checkCurrentGeofence();
      }
    } catch (error) {
      logger.error('gps', 'Error updating location', { error: String(error) });
    }
  },

  startTracking: async () => {
    const success = await startPositionWatch((location) => {
      set({
        currentLocation: location.coords,
        accuracy: location.accuracy,
        lastUpdate: location.timestamp,
      });
      get().checkCurrentGeofence();
    });

    if (success) {
      set({ isWatching: true });
      logger.info('gps', '👁️ Real-time tracking started');
    }
  },

  stopTracking: async () => {
    await stopPositionWatch();
    set({ isWatching: false });
    logger.info('gps', '⏹️ Real-time tracking stopped');
  },

  addLocation: async (location) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    const { locations } = get();

    // ============================================
    // VALIDATION 1: Duplicate name
    // ============================================
    const duplicateName = locations.some(
      l => l.name.toLowerCase().trim() === location.name.toLowerCase().trim()
    );
    if (duplicateName) {
      throw new Error(`A location named "${location.name}" already exists`);
    }

    // ============================================
    // VALIDATION 2: Min/max radius
    // ============================================
    const MIN_RADIUS = 100;
    const MAX_RADIUS = 1500;
    
    if (location.radius < MIN_RADIUS) {
      throw new Error(`Minimum radius is ${MIN_RADIUS} meters`);
    }
    if (location.radius > MAX_RADIUS) {
      throw new Error(`Maximum radius is ${MAX_RADIUS} meters`);
    }

    // ============================================
    // VALIDATION 3: Fence overlap
    // ============================================
    const activeLocations = locations.filter(l => l.status === 'active');
    
    for (const existing of activeLocations) {
      const distance = calculateDistance(
        { latitude: location.latitude, longitude: location.longitude },
        { latitude: existing.latitude, longitude: existing.longitude }
      );
      
      const sumOfRadii = location.radius + existing.radius;
      
      if (distance < sumOfRadii) {
        throw new Error(
          `This location overlaps with "${existing.name}". ` +
          `Distance: ${Math.round(distance)}m, minimum required: ${sumOfRadii}m`
        );
      }
    }

    // ============================================
    // CREATE LOCATION (passed validations)
    // ============================================
    logger.info('geofence', `➕ Adding location: ${location.name}`);

    const id = await createLocation({
      userId,
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      radius: location.radius,
      color: location.color,
    });

    // Reload locations
    await get().reloadLocations();

    // Restart geofencing to include new location
    const { isGeofencingActive } = get();
    if (isGeofencingActive) {
      await get().stopMonitoring();
      await get().startMonitoring();
    } else {
      // Auto-start monitoring when first location is added
      await get().startMonitoring();
    }

    // Update fences in heartbeat
    get().updateHeartbeatFences();

    logger.info('geofence', `✅ Location added: ${location.name}`, { id });
    return id;
  },

  removeLocation: async (id) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // CHECK IF THERE'S AN ACTIVE SESSION AT THIS LOCATION
    const { useRecordStore } = await import('./recordStore');
    const currentSession = useRecordStore.getState().currentSession;
    
    if (currentSession && currentSession.location_id === id) {
      throw new Error('Cannot delete a location with an active session. End the timer first.');
    }

    logger.info('geofence', `🗑️ Removing location`, { id });

    await dbRemoveLocation(userId, id);
    
    // Remove from state
    set(state => ({
      locations: state.locations.filter(l => l.id !== id),
      activeGeofenceId: state.activeGeofenceId === id ? null : state.activeGeofenceId,
    }));

    // Restart geofencing
    const { locations, isGeofencingActive } = get();
    if (isGeofencingActive) {
      if (locations.length === 0) {
        await get().stopMonitoring();
      } else {
        await get().stopMonitoring();
        await get().startMonitoring();
      }
    }

    // Update fences in heartbeat
    get().updateHeartbeatFences();

    logger.info('geofence', '✅ Location removed');
  },

  editLocation: async (id, updates) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    await dbUpdateLocation(id, updates);
    await get().reloadLocations();

    // Restart geofencing if active
    const { isGeofencingActive } = get();
    if (isGeofencingActive) {
      await get().stopMonitoring();
      await get().startMonitoring();
    }

    // Update fences in heartbeat
    get().updateHeartbeatFences();

    logger.info('geofence', '✅ Location edited', { id });
  },

  reloadLocations: async () => {
    try {
      const userId = useAuthStore.getState().getUserId();
      if (!userId) {
        set({ locations: [] });
        return;
      }

      const locationsDB = await getLocations(userId);
      const locations: WorkLocation[] = locationsDB.map(l => ({
        id: l.id,
        name: l.name,
        latitude: l.latitude,
        longitude: l.longitude,
        radius: l.radius,
        color: l.color,
        status: l.status,
      }));

      set({ locations });
      
      // Update fences in heartbeat
      get().updateHeartbeatFences();
      
      logger.debug('gps', `${locations.length} locations loaded`);
    } catch (error) {
      logger.error('gps', 'Error loading locations', { error: String(error) });
    }
  },

  startMonitoring: async () => {
    const { locations } = get();
    const activeLocations = locations.filter(l => l.status === 'active');

    if (activeLocations.length === 0) {
      logger.warn('geofence', 'No active locations to monitor');
      return;
    }

    // Prepare geofence regions
    const regions: GeofenceRegion[] = activeLocations.map(l => ({
      identifier: l.id,
      latitude: l.latitude,
      longitude: l.longitude,
      radius: l.radius,
      notifyOnEnter: true,
      notifyOnExit: true,
    }));

    // Start native geofencing
    const success = await startGeofencing(regions);
    if (success) {
      set({ isGeofencingActive: true });

      // Start background location as backup
      await startBackgroundLocation();
      set({ isBackgroundActive: true });

      // Start active polling
      get().startPolling();

      // ============================================
      // START HEARTBEAT (every 15 min)
      // ============================================
      const heartbeatStarted = await startHeartbeat();
      set({ isHeartbeatActive: heartbeatStarted });
      
      if (heartbeatStarted) {
        logger.info('heartbeat', '💓 Heartbeat started');
      } else {
        logger.warn('heartbeat', '⚠️ Heartbeat could not be started');
      }

      // Update fence list for heartbeat
      get().updateHeartbeatFences();

      // Save state
      await AsyncStorage.setItem(STORAGE_KEY_MONITORING, 'true');

      logger.info('geofence', '✅ Complete monitoring started (geofence + heartbeat + polling)');

      // Check current geofence
      get().checkCurrentGeofence();
    }
  },

  stopMonitoring: async () => {
    get().stopPolling();
    await stopGeofencing();
    await stopBackgroundLocation();
    
    // Stop heartbeat
    await stopHeartbeat();

    set({
      isGeofencingActive: false,
      isBackgroundActive: false,
      isPollingActive: false,
      isHeartbeatActive: false,
    });

    await AsyncStorage.setItem(STORAGE_KEY_MONITORING, 'false');
    logger.info('geofence', '⏹️ Monitoring stopped (geofence + heartbeat + polling)');
  },

  // ============================================
  // CHECK GEOFENCE WITH HYSTERESIS
  // ============================================
  checkCurrentGeofence: () => {
    const { currentLocation, locations, activeGeofenceId, isProcessingEvent, accuracy } = get();
    
    if (!currentLocation) return;
    if (isProcessingEvent) return;

    const activeLocations = locations.filter(l => l.status === 'active');

    // ============================================
    // CHECK ENTRY (normal radius)
    // ============================================
    for (const location of activeLocations) {
      const distance = calculateDistance(currentLocation, {
        latitude: location.latitude,
        longitude: location.longitude,
      });

      const insideNormalRadius = distance <= location.radius;

      if (insideNormalRadius) {
        if (activeGeofenceId !== location.id) {
          // Entered geofence
          logger.info('geofence', `✅ ENTRY: ${location.name}`, {
            distance: distance.toFixed(0) + 'm',
            radius: location.radius + 'm',
          });

          set({ activeGeofenceId: location.id, isProcessingEvent: true });

          // Notify workSessionStore
          const workSession = useWorkSessionStore.getState();
          workSession.handleGeofenceEnter(location.id, location.name, {
            ...currentLocation,
            accuracy: accuracy ?? undefined,
          });

          setTimeout(() => set({ isProcessingEvent: false }), 1000);
        }
        return; // Inside a geofence, no need to check others
      }
    }

    // ============================================
    // CHECK EXIT (radius × HYSTERESIS)
    // ============================================
    if (activeGeofenceId !== null) {
      const previousLocation = locations.find(l => l.id === activeGeofenceId);
      
      if (previousLocation) {
        const distance = calculateDistance(currentLocation, {
          latitude: previousLocation.latitude,
          longitude: previousLocation.longitude,
        });

        const expandedRadius = previousLocation.radius * EXIT_HYSTERESIS;
        const outsideExpandedRadius = distance > expandedRadius;

        if (outsideExpandedRadius) {
          // Really exited (passed expanded radius)
          logger.info('geofence', `🚪 EXIT: ${previousLocation.name}`, {
            distance: distance.toFixed(0) + 'm',
            expandedRadius: expandedRadius.toFixed(0) + 'm',
          });

          const workSession = useWorkSessionStore.getState();
          workSession.handleGeofenceExit(previousLocation.id, previousLocation.name, {
            ...currentLocation,
            accuracy: accuracy ?? undefined,
          });

          set({ activeGeofenceId: null });
        } else {
          // Still inside hysteresis zone - do nothing
          logger.debug('geofence', `⏸️ Hysteresis: ${previousLocation.name}`, {
            distance: distance.toFixed(0) + 'm',
            expandedRadius: expandedRadius.toFixed(0) + 'm',
          });
        }
      }
    }
  },

  // ============================================
  // UPDATE FENCES IN HEARTBEAT
  // ============================================
  updateHeartbeatFences: () => {
    const { locations } = get();
    const activeLocations = locations.filter(l => l.status === 'active');
    
    const fences: ActiveFence[] = activeLocations.map(l => ({
      id: l.id,
      name: l.name,
      latitude: l.latitude,
      longitude: l.longitude,
      radius: l.radius,
    }));

    updateActiveFences(fences);
    logger.debug('heartbeat', `Fences updated: ${fences.length}`);
  },

  startPolling: () => {
    get().stopPolling();
    
    logger.info('gps', '🔄 Starting polling (30s)');
    
    // Update immediately
    get().updateLocation();

    // Configure interval
    pollingTimer = setInterval(() => {
      logger.debug('gps', 'Polling...');
      get().updateLocation();
    }, POLLING_INTERVAL);

    set({ isPollingActive: true });
  },

  stopPolling: () => {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
      logger.info('gps', '⏹️ Polling stopped');
    }
    set({ isPollingActive: false });
  },
}));

// ============================================
// PRIVATE HELPERS
// ============================================

/**
 * Process geofence event from native callback
 * WITH HYSTERESIS: Exit is only confirmed if outside expanded radius
 */
function processGeofenceEvent(
  event: GeofenceEvent,
  get: () => LocationState,
  set: (partial: Partial<LocationState>) => void
) {
  const { locations, currentLocation, accuracy } = get();
  const location = locations.find(l => l.id === event.regionIdentifier);

  if (!location) {
    logger.warn('geofence', 'Location not found for event', { id: event.regionIdentifier });
    return;
  }

  const workSession = useWorkSessionStore.getState();
  const coords = currentLocation ? {
    ...currentLocation,
    accuracy: accuracy ?? undefined,
  } : undefined;

  if (event.type === 'enter') {
    set({ activeGeofenceId: location.id });
    workSession.handleGeofenceEnter(location.id, location.name, coords);
  } else {
    // ============================================
    // EXIT: Check hysteresis before confirming
    // ============================================
    if (currentLocation) {
      const distance = calculateDistance(currentLocation, {
        latitude: location.latitude,
        longitude: location.longitude,
      });

      const expandedRadius = location.radius * EXIT_HYSTERESIS;

      if (distance <= expandedRadius) {
        // Still inside hysteresis zone - ignore exit event
        logger.info('geofence', `⏸️ Exit ignored (hysteresis): ${location.name}`, {
          distance: distance.toFixed(0) + 'm',
          expandedRadius: expandedRadius.toFixed(0) + 'm',
        });
        return;
      }
    }

    // Confirmed exit
    set({ activeGeofenceId: null });
    workSession.handleGeofenceExit(location.id, location.name, coords);
  }
}

/**
 * Auto-start monitoring if it was active before
 */
async function autoStartMonitoring(
  get: () => LocationState,
  _set: (partial: Partial<LocationState>) => void
) {
  const { locations, isGeofencingActive } = get();

  if (isGeofencingActive) return;
  if (locations.length === 0) {
    logger.info('gps', 'No locations to monitor');
    return;
  }

  try {
    const wasActive = await AsyncStorage.getItem(STORAGE_KEY_MONITORING);
    
    if (wasActive === 'true' || wasActive === null) {
      logger.info('gps', '🔄 Auto-starting monitoring...');
      await get().startMonitoring();
    }
  } catch (error) {
    logger.error('gps', 'Error checking monitoring state', { error: String(error) });
    // Start anyway if there are locations
    await get().startMonitoring();
  }
}

// ============================================
// SELECTORS (use these in components)
// ============================================

/**
 * Selector: all locations
 */
export const selectLocations = (state: LocationState): WorkLocation[] => state.locations;

/**
 * Selector: active geofence ID
 */
export const selectActiveGeofence = (state: LocationState) => state.activeGeofenceId;

/**
 * Selector: is geofencing active
 */
export const selectIsGeofencingActive = (state: LocationState) => state.isGeofencingActive;

/**
 * Selector: current location
 */
export const selectCurrentLocation = (state: LocationState) => state.currentLocation;

/**
 * Selector: permissions
 */
export const selectPermissions = (state: LocationState) => state.permissions;
