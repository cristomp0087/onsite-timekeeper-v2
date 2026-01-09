/**
 * Database Module - OnSite Timekeeper V2
 * 
 * Re-exports all database functionality
 * BACKWARD COMPATIBLE with V1 API
 */

// ============================================
// CORE
// ============================================

export {
  db,
  initDatabase,
  generateUUID,
  now,
  getToday,
  calculateDistance,
  calculateDuration,
  formatDuration,
  // Types
  type LocationStatus,
  type RecordType,
  type AuditEventType,
  type LocationDB,
  type RecordDB,
  type ComputedSession,
  type DayStats,
  type AnalyticsDailyDB,
  type ErrorLogDB,
  type LocationAuditDB,
} from './core';

// ============================================
// LOCATIONS
// ============================================

export {
  createLocation,
  getLocations,
  getLocationById,
  updateLocation,
  removeLocation,
  updateLastSeen,
  getLocationsForSync,
  markLocationSynced,
  upsertLocationFromSync,
  type CreateLocationParams,
} from './locations';

// ============================================
// RECORDS
// ============================================

export {
  createEntryRecord,
  registerExit,
  getOpenSession,
  getGlobalActiveSession,
  getTodaySessions,
  getSessionsByPeriod,
  getTodayStats,
  getRecordsForSync,
  markRecordSynced,
  upsertRecordFromSync,
  type CreateRecordParams,
} from './records';

// ============================================
// ANALYTICS (replaces telemetry)
// ============================================

export {
  // Tracking
  trackMetric,
  trackGeofenceTrigger,
  trackFeatureUsed,
  trackSessionMinutes,
  // Queries
  getTodayAnalytics,
  getAnalyticsByPeriod,
  getAnalyticsForSync,
  markAnalyticsSynced,
  cleanOldAnalytics,
  // Stats
  getAnalyticsSummary,
  getAnalyticsDebugInfo,
  getDeviceMetadata,
  // Types
  type AnalyticsField,
  type FeatureName,
  type AnalyticsSummary,
} from './analytics';

// ============================================
// ERRORS
// ============================================

export {
  // Capture
  captureError,
  captureErrorAuto,
  captureSyncError,
  captureDatabaseError,
  captureNetworkError,
  captureGeofenceError,
  // Queries
  getRecentErrors,
  getErrorsByType,
  getErrorsForSync,
  markErrorsSynced,
  cleanOldErrors,
  // Stats
  getErrorStats,
  // Types
  type ErrorType,
  type ErrorContext,
  type ErrorStats,
} from './errors';

// ============================================
// LOCATION AUDIT (replaces geopoints)
// ============================================

export {
  // Record
  recordLocationAudit,
  recordEntryAudit,
  recordExitAudit,
  recordDisputeAudit,
  recordCorrectionAudit,
  // Queries
  getSessionAudit,
  getUserAudit,
  getAuditByPeriod,
  getAuditForSync,
  markAuditSynced,
  cleanOldAudit,
  // Stats
  getAuditStats,
  getSessionProof,
  // Types
  type AuditStats,
  type SessionProof,
} from './audit';

// ============================================
// DEBUG
// ============================================

export {
  getDbStats,
  resetDatabase,
} from './debug';

// ============================================
// BACKWARD COMPATIBILITY (V1 API)
// ============================================

// Alias for old telemetry function name
export { trackMetric as incrementTelemetry } from './analytics';
