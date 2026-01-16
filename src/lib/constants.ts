/**
 * Shared Constants - OnSite Timekeeper
 * 
 * Constants shared between modules to avoid require cycles.
 */

// Hysteresis (prevents ping-pong at fence boundary)
export const HYSTERESIS_EXIT = 1.3; // Exit uses radius × 1.3

// Storage keys
export const USER_ID_KEY = '@onsite:userId';
export const SKIPPED_TODAY_KEY = '@onsite:skippedToday';
export { LOCATION_TASK as LOCATION_TASK_NAME } from './backgroundTypes';