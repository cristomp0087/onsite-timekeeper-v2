/**
 * Database - Tracking
 * 
 * Geopoints, Aggregated Telemetry, Heartbeat (legacy) and Debug
 */

import { logger } from '../logger';
import {
  db,
  generateUUID,
  now,
  getToday,
  type GeopointSource,
  type GeopointDB,
  type HeartbeatLogDB,
  type TelemetryDailyDB,
} from './core';

// ============================================
// DAILY AGGREGATED TELEMETRY
// ============================================

/**
 * Ensures a row exists for today
 */
function ensureTodayTelemetry(userId: string): void {
  const today = getToday();
  
  try {
    db.runSync(
      `INSERT OR IGNORE INTO telemetry_daily (date, user_id, created_at) VALUES (?, ?, ?)`,
      [today, userId, now()]
    );
  } catch {
    logger.debug('telemetry', 'Today row already exists or error creating');
  }
}

/**
 * Increments a telemetry field for today
 */
export async function incrementTelemetry(
  userId: string,
  field: 'app_opens' | 'manual_entries_count' | 'geofence_entries_count' | 
         'geofence_triggers' | 'background_location_checks' | 
         'offline_entries_count' | 'sync_attempts' | 'sync_failures'
): Promise<void> {
  try {
    ensureTodayTelemetry(userId);
    const today = getToday();
    
    db.runSync(
      `UPDATE telemetry_daily SET ${field} = ${field} + 1, synced_at = NULL WHERE date = ? AND user_id = ?`,
      [today, userId]
    );
    
    logger.debug('telemetry', `Incremented: ${field}`);
  } catch (error) {
    logger.error('telemetry', `Error incrementing ${field}`, { error: String(error) });
  }
}

/**
 * Increments geofence-specific telemetry (with accuracy)
 */
export async function incrementGeofenceTelemetry(
  userId: string,
  accuracy: number | null
): Promise<void> {
  try {
    ensureTodayTelemetry(userId);
    const today = getToday();
    
    if (accuracy !== null && accuracy > 0) {
      db.runSync(
        `UPDATE telemetry_daily SET 
          geofence_triggers = geofence_triggers + 1,
          geofence_accuracy_sum = geofence_accuracy_sum + ?,
          geofence_accuracy_count = geofence_accuracy_count + 1,
          synced_at = NULL
        WHERE date = ? AND user_id = ?`,
        [accuracy, today, userId]
      );
    } else {
      db.runSync(
        `UPDATE telemetry_daily SET geofence_triggers = geofence_triggers + 1, synced_at = NULL WHERE date = ? AND user_id = ?`,
        [today, userId]
      );
    }
  } catch (error) {
    logger.error('telemetry', 'Error incrementing geofence telemetry', { error: String(error) });
  }
}

/**
 * Increments heartbeat telemetry (aggregated)
 */
export async function incrementHeartbeatTelemetry(
  userId: string,
  insideFence: boolean,
  batteryLevel: number | null
): Promise<void> {
  try {
    ensureTodayTelemetry(userId);
    const today = getToday();
    
    if (batteryLevel !== null) {
      db.runSync(
        `UPDATE telemetry_daily SET 
          heartbeat_count = heartbeat_count + 1,
          heartbeat_inside_fence_count = heartbeat_inside_fence_count + ?,
          battery_level_sum = battery_level_sum + ?,
          battery_level_count = battery_level_count + 1,
          synced_at = NULL
        WHERE date = ? AND user_id = ?`,
        [insideFence ? 1 : 0, batteryLevel, today, userId]
      );
    } else {
      db.runSync(
        `UPDATE telemetry_daily SET 
          heartbeat_count = heartbeat_count + 1,
          heartbeat_inside_fence_count = heartbeat_inside_fence_count + ?,
          synced_at = NULL
        WHERE date = ? AND user_id = ?`,
        [insideFence ? 1 : 0, today, userId]
      );
    }
  } catch (error) {
    logger.error('telemetry', 'Error incrementing heartbeat telemetry', { error: String(error) });
  }
}

/**
 * Fetches today's telemetry
 */
export async function getTodayTelemetry(userId: string): Promise<TelemetryDailyDB | null> {
  try {
    return db.getFirstSync<TelemetryDailyDB>(
      `SELECT * FROM telemetry_daily WHERE date = ? AND user_id = ?`,
      [getToday(), userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Error fetching today telemetry', { error: String(error) });
    return null;
  }
}

/**
 * Fetches telemetry for sync (not synced)
 */
export async function getTelemetryForSync(userId: string): Promise<TelemetryDailyDB[]> {
  try {
    return db.getAllSync<TelemetryDailyDB>(
      `SELECT * FROM telemetry_daily WHERE user_id = ? AND synced_at IS NULL ORDER BY date ASC`,
      [userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Error fetching telemetry for sync', { error: String(error) });
    return [];
  }
}

/**
 * Marks telemetry as synced
 */
export async function markTelemetrySynced(date: string, userId: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE telemetry_daily SET synced_at = ? WHERE date = ? AND user_id = ?`,
      [now(), date, userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Error marking telemetry synced', { error: String(error) });
  }
}

/**
 * Cleans old telemetry (older than X days, only if already synced)
 */
export async function cleanOldTelemetry(daysToKeep: number = 7): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    const result = db.runSync(
      `DELETE FROM telemetry_daily WHERE date < ? AND synced_at IS NOT NULL`,
      [cutoffStr]
    );
    
    const deleted = result.changes || 0;
    if (deleted > 0) {
      logger.info('telemetry', `Old telemetry cleaned: ${deleted} days`);
    }
    return deleted;
  } catch (error) {
    logger.error('telemetry', 'Error cleaning old telemetry', { error: String(error) });
    return 0;
  }
}

/**
 * Telemetry stats for debug
 */
export async function getTelemetryStats(userId: string): Promise<{
  pendingDays: number;
  syncedDays: number;
  today: TelemetryDailyDB | null;
}> {
  try {
    const pending = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM telemetry_daily WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
    
    const synced = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM telemetry_daily WHERE user_id = ? AND synced_at IS NOT NULL`,
      [userId]
    );
    
    const today = await getTodayTelemetry(userId);
    
    return {
      pendingDays: pending?.count || 0,
      syncedDays: synced?.count || 0,
      today,
    };
  } catch (error) {
    logger.error('telemetry', 'Error getting telemetry stats', { error: String(error) });
    return { pendingDays: 0, syncedDays: 0, today: null };
  }
}

// ============================================
// GEOPOINTS (GPS Audit)
// ============================================

/**
 * Registers a geopoint (GPS reading)
 */
export async function registerGeopoint(
  userId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  source: GeopointSource,
  insideFence: boolean,
  fenceId: string | null,
  fenceName: string | null,
  sessionId: string | null
): Promise<string> {
  const id = generateUUID();
  const timestamp = now();
  
  try {
    db.runSync(
      `INSERT INTO geopoints (id, session_id, user_id, latitude, longitude, accuracy, 
       timestamp, source, inside_fence, fence_id, fence_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, userId, latitude, longitude, accuracy, 
       timestamp, source, insideFence ? 1 : 0, fenceId, fenceName, timestamp]
    );
    
    logger.debug('database', 'Geopoint registered', { id, source, insideFence });
    return id;
  } catch (error) {
    logger.error('database', 'Error registering geopoint', { error: String(error) });
    throw error;
  }
}

/**
 * Fetches session geopoints
 */
export async function getSessionGeopoints(sessionId: string): Promise<GeopointDB[]> {
  try {
    return db.getAllSync<GeopointDB>(
      `SELECT * FROM geopoints WHERE session_id = ? ORDER BY timestamp ASC`,
      [sessionId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching session geopoints', { error: String(error) });
    return [];
  }
}

/**
 * Cleans old geopoints (older than X days, only if synced)
 */
export async function cleanOldGeopoints(daysToKeep: number = 7): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    
    const result = db.runSync(
      `DELETE FROM geopoints WHERE timestamp < ? AND synced_at IS NOT NULL`,
      [cutoff.toISOString()]
    );
    
    const deleted = result.changes || 0;
    if (deleted > 0) {
      logger.info('database', `Old geopoints cleaned: ${deleted}`);
    }
    return deleted;
  } catch (error) {
    logger.error('database', 'Error cleaning geopoints', { error: String(error) });
    return 0;
  }
}

/**
 * Geopoint stats
 */
export async function getGeopointStats(userId: string): Promise<{
  total: number;
  pending: number;
  bySource: { polling: number; geofence: number; heartbeat: number; background: number; manual: number };
  lastTimestamp: string | null;
}> {
  try {
    const total = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM geopoints WHERE user_id = ?`,
      [userId]
    );
    
    const pending = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM geopoints WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
    
    const bySource: { polling: number; geofence: number; heartbeat: number; background: number; manual: number } = {
      polling: 0, geofence: 0, heartbeat: 0, background: 0, manual: 0
    };
    
    const sources = ['polling', 'geofence', 'heartbeat', 'background', 'manual'] as const;
    for (const source of sources) {
      const count = db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) as count FROM geopoints WHERE user_id = ? AND source = ?`,
        [userId, source]
      );
      bySource[source] = count?.count || 0;
    }
    
    const last = db.getFirstSync<{ timestamp: string }>(
      `SELECT timestamp FROM geopoints WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [userId]
    );
    
    return {
      total: total?.count || 0,
      pending: pending?.count || 0,
      bySource,
      lastTimestamp: last?.timestamp || null,
    };
  } catch (error) {
    logger.error('database', 'Error getting geopoint stats', { error: String(error) });
    return {
      total: 0,
      pending: 0,
      bySource: { polling: 0, geofence: 0, heartbeat: 0, background: 0, manual: 0 },
      lastTimestamp: null 
    };
  }
}

/**
 * Fetches geopoints for sync (not synced)
 */
export async function getGeopointsForSync(userId: string, limit: number = 100): Promise<GeopointDB[]> {
  try {
    return db.getAllSync<GeopointDB>(
      `SELECT * FROM geopoints WHERE user_id = ? AND synced_at IS NULL ORDER BY timestamp ASC LIMIT ?`,
      [userId, limit]
    );
  } catch (error) {
    logger.error('database', 'Error fetching geopoints for sync', { error: String(error) });
    return [];
  }
}

/**
 * Marks geopoints as synced
 */
export async function markGeopointsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  
  try {
    const placeholders = ids.map(() => '?').join(',');
    db.runSync(
      `UPDATE geopoints SET synced_at = ? WHERE id IN (${placeholders})`,
      [now(), ...ids]
    );
    logger.debug('database', `${ids.length} geopoints marked as synced`);
  } catch (error) {
    logger.error('database', 'Error marking geopoints synced', { error: String(error) });
  }
}

// ============================================
// HEARTBEAT LOG (LEGACY - keep for now)
// ============================================

/**
 * Registers a heartbeat
 * NOTE: This function will be replaced by incrementTelemetry
 */
export async function registerHeartbeat(
  userId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  insideFence: boolean,
  fenceId: string | null,
  fenceName: string | null,
  sessionId: string | null,
  batteryLevel: number | null
): Promise<string> {
  const id = generateUUID();
  const timestamp = now();
  
  try {
    db.runSync(
      `INSERT INTO heartbeat_log (id, user_id, timestamp, latitude, longitude, accuracy, 
       inside_fence, fence_id, fence_name, session_id, battery_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, timestamp, latitude, longitude, accuracy, 
       insideFence ? 1 : 0, fenceId, fenceName, sessionId, batteryLevel, timestamp]
    );
    
    // Also increment aggregated telemetry
    await incrementHeartbeatTelemetry(userId, insideFence, batteryLevel);
    
    logger.debug('heartbeat', 'Heartbeat registered', { id, insideFence, fenceId });
    return id;
  } catch (error) {
    logger.error('database', 'Error registering heartbeat', { error: String(error) });
    throw error;
  }
}

/**
 * Fetches last heartbeat of a session
 */
export async function getLastSessionHeartbeat(sessionId: string): Promise<HeartbeatLogDB | null> {
  try {
    return db.getFirstSync<HeartbeatLogDB>(
      `SELECT * FROM heartbeat_log WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [sessionId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching last heartbeat', { error: String(error) });
    return null;
  }
}

/**
 * Fetches last heartbeat of user (any session)
 */
export async function getLastHeartbeat(userId: string): Promise<HeartbeatLogDB | null> {
  try {
    return db.getFirstSync<HeartbeatLogDB>(
      `SELECT * FROM heartbeat_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching last heartbeat', { error: String(error) });
    return null;
  }
}

/**
 * Fetches heartbeats by period
 */
export async function getHeartbeatsByPeriod(
  userId: string,
  startDate: string,
  endDate: string
): Promise<HeartbeatLogDB[]> {
  try {
    return db.getAllSync<HeartbeatLogDB>(
      `SELECT * FROM heartbeat_log WHERE user_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`,
      [userId, startDate, endDate]
    );
  } catch (error) {
    logger.error('database', 'Error fetching heartbeats', { error: String(error) });
    return [];
  }
}

/**
 * Cleans old heartbeats (older than X days)
 */
export async function cleanOldHeartbeats(daysToKeep: number = 30): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    
    const result = db.runSync(
      `DELETE FROM heartbeat_log WHERE timestamp < ?`,
      [cutoff.toISOString()]
    );
    
    const deleted = result.changes || 0;
    if (deleted > 0) {
      logger.info('database', `Old heartbeats cleaned: ${deleted}`);
    }
    return deleted;
  } catch (error) {
    logger.error('database', 'Error cleaning heartbeats', { error: String(error) });
    return 0;
  }
}

/**
 * Counts heartbeats (for stats)
 */
export async function getHeartbeatStats(userId: string): Promise<{
  total: number;
  today: number;
  lastTimestamp: string | null;
}> {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    
    const total = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM heartbeat_log WHERE user_id = ?`,
      [userId]
    );
    
    const todayCount = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM heartbeat_log WHERE user_id = ? AND timestamp LIKE ?`,
      [userId, `${todayStr}%`]
    );
    
    const last = db.getFirstSync<{ timestamp: string }>(
      `SELECT timestamp FROM heartbeat_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [userId]
    );
    
    return {
      total: total?.count || 0,
      today: todayCount?.count || 0,
      lastTimestamp: last?.timestamp || null,
    };
  } catch (error) {
    logger.error('database', 'Error getting heartbeat stats', { error: String(error) });
    return { total: 0, today: 0, lastTimestamp: null };
  }
}

// ============================================
// DEBUG - Functions for DevMonitor
// ============================================

/**
 * Returns record counts for each table
 */
export async function getDbStats(): Promise<{
  locations_total: number;
  locations_active: number;
  locations_deleted: number;
  records_total: number;
  records_open: number;
  sync_logs: number;
  geopoints_total: number;
  telemetry_days: number;
}> {
  try {
    const locationsTotal = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locations`);
    const locationsActive = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locations WHERE status = 'active'`);
    const locationsDeleted = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locations WHERE status = 'deleted'`);
    const recordsTotal = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM records`);
    const recordsOpen = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM records WHERE exit_at IS NULL`);
    const syncLogs = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM sync_log`);
    const geopointsTotal = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM geopoints`);
    const telemetryDays = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM telemetry_daily`);

    return {
      locations_total: locationsTotal?.count || 0,
      locations_active: locationsActive?.count || 0,
      locations_deleted: locationsDeleted?.count || 0,
      records_total: recordsTotal?.count || 0,
      records_open: recordsOpen?.count || 0,
      sync_logs: syncLogs?.count || 0,
      geopoints_total: geopointsTotal?.count || 0,
      telemetry_days: telemetryDays?.count || 0,
    };
  } catch (error) {
    logger.error('database', 'Error getting stats', { error: String(error) });
    return {
      locations_total: 0,
      locations_active: 0,
      locations_deleted: 0,
      records_total: 0,
      records_open: 0,
      sync_logs: 0,
      geopoints_total: 0,
      telemetry_days: 0,
    };
  }
}

/**
 * Clears all local data (NUCLEAR OPTION)
 */
export async function resetDatabase(): Promise<void> {
  try {
    logger.warn('database', '⚠️ RESET DATABASE - Clearing all local data');
    db.execSync(`DELETE FROM sync_log`);
    db.execSync(`DELETE FROM records`);
    db.execSync(`DELETE FROM locations`);
    db.execSync(`DELETE FROM geopoints`);
    db.execSync(`DELETE FROM heartbeat_log`);
    db.execSync(`DELETE FROM telemetry_daily`);
    logger.info('database', '✅ Database reset');
  } catch (error) {
    logger.error('database', 'Error resetting database', { error: String(error) });
    throw error;
  }
}
