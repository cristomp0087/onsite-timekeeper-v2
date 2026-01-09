/**
 * Stores - OnSite Timekeeper
 * 
 * Re-exports all stores and selectors
 */

// ============================================
// AUTH STORE
// ============================================

export { useAuthStore } from './authStore';
export type { AuthState } from './authStore';

// ============================================
// LOCATION STORE
// ============================================

export { 
  useLocationStore,
  selectLocations,
  selectActiveGeofence,
  selectIsGeofencingActive,
  selectCurrentLocation,
  selectPermissions,
} from './locationStore';

export type { 
  WorkLocation,
  LocationState,
  LocationCoords,
} from './locationStore';

// ============================================
// RECORD STORE
// ============================================

export { useRecordStore } from './recordStore';

// ============================================
// SYNC STORE
// ============================================

export { useSyncStore } from './syncStore';
