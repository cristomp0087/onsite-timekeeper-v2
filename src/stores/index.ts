/**
 * Stores Index - OnSite Timekeeper
 * 
 * Central exports for all Zustand stores
 */

// ============================================
// STORES
// ============================================

export { useLocationStore, selectLocations, selectActiveGeofence, selectIsGeofencingActive, selectCurrentLocation, selectPermissions } from './locationStore';
export type { WorkLocation } from './locationStore';

export { useRecordStore, useFormatDuration } from './recordStore';

export { useWorkSessionStore } from './workSessionStore';
export type { PendingAction, PauseState, PendingActionType } from './workSessionStore';

export { useSyncStore } from './syncStore';

export { useAuthStore } from './authStore';

export { useSettingsStore } from './settingsStore';
