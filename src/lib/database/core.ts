/**
 * Database Core - OnSite Timekeeper
 * 
 * SQLite instance, initialization, types and helpers
 * 
 * V2 REFACTOR:
 * - Removed heartbeat_log (redundant)
 * - Removed geopoints (over-collection)
 * - Removed sync_log (overengineered)
 * - Added analytics_daily (unified metrics)
 * - Added error_log (structured errors)
 * - Added location_audit (only entry/exit GPS proof)
 */

import * as SQLite from 'expo-sqlite';
import { logger } from '../logger';

// ============================================
// DATABASE INSTANCE (Singleton)
// ============================================

export const db = SQLite.openDatabaseSync('onsite-timekeeper.db');

// ============================================
// TYPES - CORE
// ============================================

export type LocationStatus = 'active' | 'deleted' | 'pending_delete' | 'syncing';
export type RecordType = 'automatic' | 'manual';
export type AuditEventType = 'entry' | 'exit' | 'dispute' | 'correction';

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

// Session with computed fields for UI
export interface ComputedSession extends RecordDB {
  status: 'active' | 'paused' | 'finished';
  duration_minutes: number;
}

export interface DayStats {
  total_minutes: number;
  total_sessions: number;
}

// ============================================
// TYPES - ANALYTICS
// ============================================

export interface AnalyticsDailyDB {
  date: string; // YYYY-MM-DD (PRIMARY KEY with user_id)
  user_id: string;
  
  // Business metrics
  sessions_count: number;
  total_minutes: number;
  manual_entries: number;
  auto_entries: number;
  locations_created: number;
  locations_deleted: number;
  
  // Product metrics (UX)
  app_opens: number;
  app_foreground_seconds: number;
  notifications_shown: number;
  notifications_actioned: number;
  features_used: string; // JSON array
  
  // Debug metrics
  errors_count: number;
  sync_attempts: number;
  sync_failures: number;
  geofence_triggers: number;
  geofence_accuracy_sum: number;
  geofence_accuracy_count: number;
  
  // Metadata
  app_version: string | null;
  os: string | null;
  device_model: string | null;
  
  created_at: string;
  synced_at: string | null;
}

// ============================================
// TYPES - ERROR LOG
// ============================================

export interface ErrorLogDB {
  id: string;
  user_id: string | null;
  
  // Error details
  error_type: string;
  error_message: string;
  error_stack: string | null;
  error_context: string | null; // JSON
  
  // Metadata
  app_version: string | null;
  os: string | null;
  os_version: string | null;
  device_model: string | null;
  
  // Timestamps
  occurred_at: string;
  created_at: string;
  synced_at: string | null;
}

// ============================================
// TYPES - LOCATION AUDIT
// ============================================

export interface LocationAuditDB {
  id: string;
  user_id: string;
  session_id: string | null;
  
  // Event info
  event_type: AuditEventType;
  location_id: string | null;
  location_name: string | null;
  
  // GPS data
  latitude: number;
  longitude: number;
  accuracy: number | null;
  
  // Timestamps
  occurred_at: string;
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
    logger.info('boot', '🗄️ Initializing SQLite V2...');

    // ============================================
    // CORE TABLES
    // ============================================

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

    // ============================================
    // ANALYTICS TABLE (replaces telemetry_daily)
    // ============================================

    db.execSync(`
      CREATE TABLE IF NOT EXISTS analytics_daily (
        date TEXT NOT NULL,
        user_id TEXT NOT NULL,
        
        -- Business metrics
        sessions_count INTEGER DEFAULT 0,
        total_minutes INTEGER DEFAULT 0,
        manual_entries INTEGER DEFAULT 0,
        auto_entries INTEGER DEFAULT 0,
        locations_created INTEGER DEFAULT 0,
        locations_deleted INTEGER DEFAULT 0,
        
        -- Product metrics (UX)
        app_opens INTEGER DEFAULT 0,
        app_foreground_seconds INTEGER DEFAULT 0,
        notifications_shown INTEGER DEFAULT 0,
        notifications_actioned INTEGER DEFAULT 0,
        features_used TEXT DEFAULT '[]',
        
        -- Debug metrics
        errors_count INTEGER DEFAULT 0,
        sync_attempts INTEGER DEFAULT 0,
        sync_failures INTEGER DEFAULT 0,
        geofence_triggers INTEGER DEFAULT 0,
        geofence_accuracy_sum REAL DEFAULT 0,
        geofence_accuracy_count INTEGER DEFAULT 0,
        
        -- Metadata
        app_version TEXT,
        os TEXT,
        device_model TEXT,
        
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT,
        
        PRIMARY KEY (date, user_id)
      )
    `);

    // ============================================
    // ERROR LOG TABLE (new)
    // ============================================

    db.execSync(`
      CREATE TABLE IF NOT EXISTS error_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        
        -- Error details
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_stack TEXT,
        error_context TEXT,
        
        -- Metadata
        app_version TEXT,
        os TEXT,
        os_version TEXT,
        device_model TEXT,
        
        -- Timestamps
        occurred_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

    // ============================================
    // LOCATION AUDIT TABLE (replaces geopoints)
    // ============================================

    db.execSync(`
      CREATE TABLE IF NOT EXISTS location_audit (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        
        -- Event info
        event_type TEXT NOT NULL,
        location_id TEXT,
        location_name TEXT,
        
        -- GPS data
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        
        -- Timestamps
        occurred_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

    // ============================================
    // INDEXES
    // ============================================

    // Locations
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_locations_user ON locations(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_locations_status ON locations(status)`);

    // Records
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_records_location ON records(location_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_records_entry ON records(entry_at)`);

    // Analytics
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_daily(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_analytics_synced ON analytics_daily(synced_at)`);

    // Error log
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_error_user ON error_log(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_error_type ON error_log(error_type)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_error_occurred ON error_log(occurred_at)`);

    // Location audit
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_audit_user ON location_audit(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_audit_session ON location_audit(session_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_audit_occurred ON location_audit(occurred_at)`);

    // ============================================
    // MIGRATION: Drop deprecated tables
    // ============================================

    // Check if old tables exist and drop them
    try {
      db.execSync(`DROP TABLE IF EXISTS heartbeat_log`);
      db.execSync(`DROP TABLE IF EXISTS geopoints`);
      db.execSync(`DROP TABLE IF EXISTS sync_log`);
      db.execSync(`DROP TABLE IF EXISTS telemetry_daily`);
      logger.info('database', '🧹 Deprecated tables removed');
    } catch (e) {
      // Tables might not exist, that's fine
    }

    dbInitialized = true;
    logger.info('boot', '✅ SQLite V2 initialized successfully');
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
