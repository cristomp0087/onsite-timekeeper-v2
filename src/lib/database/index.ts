/**
 * Database Module - OnSite Timekeeper
 * 
 * Re-exports all database functionality
 */

// Core
export {
  db,
  initDatabase,
  generateUUID,
  now,
  getToday,
  calculateDistance,
  calculateDuration,
  formatDuration,
  registerSyncLog,
  getSyncLogs,
  getSyncLogsByEntity,
  type LocationStatus,
  type RecordType,
  type SyncLogAction,
  type SyncLogStatus,
  type GeopointSource,
  type LocationDB,
  type RecordDB,
  type SyncLogDB,
  type ComputedSession,
  type DayStats,
  type HeartbeatLogDB,
  type GeopointDB,
  type TelemetryDailyDB,
} from './core';

// Locations
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

// Records
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

// Tracking
export {
  // Telemetry
  incrementTelemetry,
  incrementGeofenceTelemetry,
  incrementHeartbeatTelemetry,
  getTodayTelemetry,
  getTelemetryForSync,
  markTelemetrySynced,
  cleanOldTelemetry,
  getTelemetryStats,
  
  // Geopoints
  registerGeopoint,
  getSessionGeopoints,
  cleanOldGeopoints,
  getGeopointStats,
  getGeopointsForSync,
  markGeopointsSynced,
  
  // Heartbeat (legacy)
  registerHeartbeat,
  getLastSessionHeartbeat,
  getLastHeartbeat,
  getHeartbeatsByPeriod,
  cleanOldHeartbeats,
  getHeartbeatStats,
  
  // Debug
  getDbStats,
  resetDatabase,
} from './tracking';
