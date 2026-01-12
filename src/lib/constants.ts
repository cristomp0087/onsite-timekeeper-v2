/**
 * Shared Constants - OnSite Timekeeper
 * 
 * Constants shared between location.ts and backgroundTasks.ts
 * to avoid require cycles.
 * 
 * FIX: LOCATION_TASK_NAME must match the task defined in backgroundTasks.ts
 */

// Background task names (must be unique and match across files)
// FIXED: Was 'onsite-background-location', must match backgroundTasks.ts
export const LOCATION_TASK_NAME = 'onsite-location-task';
export const GEOFENCE_TASK_NAME = 'onsite-geofence';
export const HEARTBEAT_TASK_NAME = 'onsite-heartbeat-task';

// Intervals
export const HEARTBEAT_INTERVAL = 15 * 60; // 15 minutes in seconds

// Hysteresis (prevents ping-pong at fence boundary)
export const HYSTERESIS_ENTRY = 1.0; // Entry uses normal radius
export const HYSTERESIS_EXIT = 1.3; // Exit uses radius × 1.3

// Storage keys
export const USER_ID_KEY = '@onsite:userId';
export const SKIPPED_TODAY_KEY = '@onsite:skippedToday';
export const MONITORING_STATE_KEY = '@onsite:monitoringEnabled';

// Dedupe settings
export const DEDUPE_WINDOW_MS = 2000; // 2 seconds
export const RECONFIGURE_WINDOW_MS = 3000; // 3 seconds
