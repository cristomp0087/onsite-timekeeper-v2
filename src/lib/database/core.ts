/**
 * Database Core - OnSite Timekeeper
 * 
 * SQLite instance, initialization, types and helpers
 */

import * as SQLite from 'expo-sqlite';
import { logger } from '../logger';

// ============================================
// DATABASE INSTANCE (Singleton)
// ============================================

export const db = SQLite.openDatabaseSync('onsite-timekeeper.db');

// ============================================
// TYPES
// ============================================

export type LocationStatus = 'active' | 'deleted' | 'pending_delete' | 'syncing';
export type RecordType = 'automatic' | 'manual';
export type SyncLogAction = 'create' | 'update' | 'delete' | 'sync_up' | 'sync_down';
export type SyncLogStatus = 'pending' | 'synced' | 'conflict' | 'failed';
export type GeopointSource = 'polling' | 'geofence' | 'heartbeat' | 'background' | 'manual';

export interface LocationDB {
  id: string;
  user_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  color: string;
  status: LocationStatus;
  deleted_at: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface RecordDB {
  id: string;
  user_id: string;
  location_id: string;
  location_name: string | null;
  entry_at: string;
  exit_at: string | null;
  type: RecordType;
  manually_edited: number; // SQLite has no boolean
  edit_reason: string | null;
  integrity_hash: string | null;
  color: string | null;
  device_id: string | null;
  pause_minutes: number | null;
  created_at: string;
  synced_at: string | null;
}

export interface SyncLogDB {
  id: string;
  user_id: string;
  entity_type: 'location' | 'record';
  entity_id: string;
  action: SyncLogAction;
  old_value: string | null;
  new_value: string | null;
  sync_status: SyncLogStatus;
  error_message: string | null;
  created_at: string;
}

// Session with computed fields for UI
export interface ComputedSession extends RecordDB {
  status: 'active' | 'paused' | 'finished';
  duration_minutes: number;
}

export interface DayStats {
  total_minutes: number;
  total_sessions: number;
}

export interface HeartbeatLogDB {
  id: string;
  user_id: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  inside_fence: number; // 0 or 1 (SQLite has no boolean)
  fence_id: string | null;
  fence_name: string | null;
  session_id: string | null;
  battery_level: number | null;
  created_at: string;
}

export interface GeopointDB {
  id: string;
  session_id: string | null;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: string;
  source: GeopointSource;
  inside_fence: number; // 0 or 1
  fence_id: string | null;
  fence_name: string | null;
  created_at: string;
  synced_at: string | null;
}

export interface TelemetryDailyDB {
  date: string; // YYYY-MM-DD (PRIMARY KEY with user_id)
  user_id: string;
  
  // App usage
  app_opens: number;
  
  // Entries
  manual_entries_count: number;
  geofence_entries_count: number;
  
  // Geofence performance
  geofence_triggers: number;
  geofence_accuracy_sum: number;
  geofence_accuracy_count: number;
  
  // Background & Battery
  background_location_checks: number;
  battery_level_sum: number;
  battery_level_count: number;
  
  // Sync health
  offline_entries_count: number;
  sync_attempts: number;
  sync_failures: number;
  
  // Heartbeat (aggregated)
  heartbeat_count: number;
  heartbeat_inside_fence_count: number;
  
  // Metadata
  created_at: string;
  synced_at: string | null;
}

// ============================================
// INITIALIZATION
// ============================================

let dbInitialized = false;

export async function initDatabase(): Promise<void> {
  if (dbInitialized) {
    logger.debug('database', 'Database already initialized');
    return;
  }

  try {
    logger.info('boot', '🗄️ Initializing SQLite...');

    // Locations table
    db.execSync(`
      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        radius INTEGER DEFAULT 100,
        color TEXT DEFAULT '#3B82F6',
        status TEXT DEFAULT 'active',
        deleted_at TEXT,
        last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

    // Records table (sessions)
    db.execSync(`
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        location_name TEXT,
        entry_at TEXT NOT NULL,
        exit_at TEXT,
        type TEXT DEFAULT 'automatic',
        manually_edited INTEGER DEFAULT 0,
        edit_reason TEXT,
        integrity_hash TEXT,
        color TEXT,
        device_id TEXT,
        pause_minutes INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

    // Sync audit table
    db.execSync(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        sync_status TEXT DEFAULT 'pending',
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Heartbeat logs table (LEGACY)
    db.execSync(`
      CREATE TABLE IF NOT EXISTS heartbeat_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        inside_fence INTEGER DEFAULT 0,
        fence_id TEXT,
        fence_name TEXT,
        session_id TEXT,
        battery_level INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Heartbeat indexes
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_heartbeat_user ON heartbeat_log(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_heartbeat_timestamp ON heartbeat_log(timestamp)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_heartbeat_session ON heartbeat_log(session_id)`);

    // Geopoints table
    db.execSync(`
      CREATE TABLE IF NOT EXISTS geopoints (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        user_id TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        timestamp TEXT NOT NULL,
        source TEXT DEFAULT 'polling',
        inside_fence INTEGER DEFAULT 0,
        fence_id TEXT,
        fence_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

    // Geopoints indexes
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_geopoints_user ON geopoints(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_geopoints_session ON geopoints(session_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_geopoints_timestamp ON geopoints(timestamp)`);

    // Telemetry daily table
    db.execSync(`
      CREATE TABLE IF NOT EXISTS telemetry_daily (
        date TEXT NOT NULL,
        user_id TEXT NOT NULL,
        app_opens INTEGER DEFAULT 0,
        manual_entries_count INTEGER DEFAULT 0,
        geofence_entries_count INTEGER DEFAULT 0,
        geofence_triggers INTEGER DEFAULT 0,
        geofence_accuracy_sum REAL DEFAULT 0,
        geofence_accuracy_count INTEGER DEFAULT 0,
        background_location_checks INTEGER DEFAULT 0,
        battery_level_sum REAL DEFAULT 0,
        battery_level_count INTEGER DEFAULT 0,
        offline_entries_count INTEGER DEFAULT 0,
        sync_attempts INTEGER DEFAULT 0,
        sync_failures INTEGER DEFAULT 0,
        heartbeat_count INTEGER DEFAULT 0,
        heartbeat_inside_fence_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT,
        PRIMARY KEY (date, user_id)
      )
    `);

    // Telemetry indexes
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_telemetry_user ON telemetry_daily(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_telemetry_synced ON telemetry_daily(synced_at)`);

    // General indexes
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_locations_user ON locations(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_locations_status ON locations(status)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_records_location ON records(location_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_records_entry ON records(entry_at)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_id)`);

    dbInitialized = true;
    logger.info('boot', '✅ SQLite initialized successfully');
  } catch (error) {
    logger.error('database', '❌ Error initializing SQLite', { error: String(error) });
    throw error;
  }
}

// ============================================
// HELPERS
// ============================================

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function now(): string {
  return new Date().toISOString();
}

export function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Calculate distance between two points (Haversine)
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate duration in minutes between two dates
 */
export function calculateDuration(start: string, end: string | null): number {
  if (!start) return 0;
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  if (isNaN(startTime) || isNaN(endTime)) return 0;
  const diff = Math.round((endTime - startTime) / 60000);
  return diff > 0 ? diff : 0;
}

/**
 * Format duration in minutes to readable string
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || isNaN(minutes)) {
    return '0min';
  }
  const total = Math.floor(Math.max(0, minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

// ============================================
// SYNC LOG (Audit)
// ============================================

export async function registerSyncLog(
  userId: string,
  entityType: 'location' | 'record',
  entityId: string,
  action: SyncLogAction,
  oldValue: unknown | null,
  newValue: unknown | null,
  status: SyncLogStatus = 'pending',
  errorMessage: string | null = null
): Promise<void> {
  try {
    const id = generateUUID();
    db.runSync(
      `INSERT INTO sync_log (id, user_id, entity_type, entity_id, action, old_value, new_value, sync_status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        entityType,
        entityId,
        action,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        status,
        errorMessage,
        now()
      ]
    );
    logger.debug('database', `📝 Sync log: ${action} ${entityType}`, { entityId });
  } catch (error) {
    logger.error('database', 'Error registering sync log', { error: String(error) });
  }
}

export async function getSyncLogs(
  userId: string,
  limit: number = 100
): Promise<SyncLogDB[]> {
  try {
    return db.getAllSync<SyncLogDB>(
      `SELECT * FROM sync_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
  } catch (error) {
    logger.error('database', 'Error fetching sync logs', { error: String(error) });
    return [];
  }
}

export async function getSyncLogsByEntity(
  entityType: 'location' | 'record',
  entityId: string
): Promise<SyncLogDB[]> {
  try {
    return db.getAllSync<SyncLogDB>(
      `SELECT * FROM sync_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC`,
      [entityType, entityId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching sync logs by entity', { error: String(error) });
    return [];
  }
}
