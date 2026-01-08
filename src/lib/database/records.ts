/**
 * Database - Records (Work Sessions)
 * 
 * CRUD for records and sync functions
 */

import { logger } from '../logger';
import {
  db,
  generateUUID,
  now,
  calculateDuration,
  registerSyncLog,
  type RecordDB,
  type RecordType,
  type ComputedSession,
  type DayStats,
} from './core';
import { getLocationById } from './locations';
import { incrementTelemetry } from './tracking';

// ============================================
// TYPES
// ============================================

export interface CreateRecordParams {
  userId: string;
  locationId: string;
  locationName: string;
  type?: RecordType;
  color?: string;
}

// ============================================
// CRUD
// ============================================

export async function createEntryRecord(params: CreateRecordParams): Promise<string> {
  const id = generateUUID();
  const timestamp = now();

  try {
    // Get location color if not provided
    let color = params.color;
    if (!color) {
      const location = await getLocationById(params.locationId);
      color = location?.color || '#3B82F6';
    }

    db.runSync(
      `INSERT INTO records (id, user_id, location_id, location_name, entry_at, type, color, pause_minutes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        id,
        params.userId,
        params.locationId,
        params.locationName,
        timestamp,
        params.type || 'automatic',
        color,
        timestamp
      ]
    );

    // Sync log
    await registerSyncLog(params.userId, 'record', id, 'create', null, params);

    // Increment telemetry
    if (params.type === 'manual') {
      await incrementTelemetry(params.userId, 'manual_entries_count');
    } else {
      await incrementTelemetry(params.userId, 'geofence_entries_count');
    }

    logger.info('database', `📥 Record created: ${params.locationName}`, { id });
    return id;
  } catch (error) {
    logger.error('database', 'Error creating record', { error: String(error) });
    throw error;
  }
}

export async function registerExit(
  userId: string,
  locationId: string,
  adjustmentMinutes: number = 0
): Promise<void> {
  try {
    // Find active session for this location
    const session = db.getFirstSync<RecordDB>(
      `SELECT * FROM records WHERE user_id = ? AND location_id = ? AND exit_at IS NULL ORDER BY entry_at DESC LIMIT 1`,
      [userId, locationId]
    );

    if (!session) {
      throw new Error('No active session found for this location');
    }

    // Calculate exit with adjustment
    let exitTime = new Date();
    if (adjustmentMinutes > 0) {
      exitTime = new Date(exitTime.getTime() - adjustmentMinutes * 60000);
    }

    db.runSync(
      `UPDATE records SET exit_at = ?, synced_at = NULL WHERE id = ?`,
      [exitTime.toISOString(), session.id]
    );

    // Sync log
    await registerSyncLog(userId, 'record', session.id, 'update', 
      { exit_at: null }, 
      { exit_at: exitTime.toISOString() }
    );

    logger.info('database', `📤 Exit registered`, { id: session.id, adjustmentMinutes });
  } catch (error) {
    logger.error('database', 'Error registering exit', { error: String(error) });
    throw error;
  }
}

export async function getOpenSession(userId: string, locationId: string): Promise<RecordDB | null> {
  try {
    return db.getFirstSync<RecordDB>(
      `SELECT * FROM records WHERE user_id = ? AND location_id = ? AND exit_at IS NULL ORDER BY entry_at DESC LIMIT 1`,
      [userId, locationId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching open session', { error: String(error) });
    return null;
  }
}

export async function getGlobalActiveSession(userId: string): Promise<ComputedSession | null> {
  try {
    const session = db.getFirstSync<RecordDB>(
      `SELECT * FROM records WHERE user_id = ? AND exit_at IS NULL ORDER BY entry_at DESC LIMIT 1`,
      [userId]
    );

    if (!session) return null;

    return {
      ...session,
      status: 'active',
      duration_minutes: calculateDuration(session.entry_at, null),
    };
  } catch (error) {
    logger.error('database', 'Error fetching global active session', { error: String(error) });
    return null;
  }
}

export async function getTodaySessions(userId: string): Promise<ComputedSession[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sessions = db.getAllSync<RecordDB>(
      `SELECT * FROM records WHERE user_id = ? AND entry_at >= ? AND entry_at < ? ORDER BY entry_at DESC`,
      [userId, today.toISOString(), tomorrow.toISOString()]
    );

    return sessions.map(s => ({
      ...s,
      status: s.exit_at ? 'finished' : 'active',
      duration_minutes: calculateDuration(s.entry_at, s.exit_at),
    })) as ComputedSession[];
  } catch (error) {
    logger.error('database', 'Error fetching today sessions', { error: String(error) });
    return [];
  }
}

export async function getSessionsByPeriod(
  userId: string,
  startDate: string,
  endDate: string
): Promise<ComputedSession[]> {
  try {
    const sessions = db.getAllSync<RecordDB>(
      `SELECT * FROM records WHERE user_id = ? AND entry_at >= ? AND entry_at <= ? ORDER BY entry_at ASC`,
      [userId, startDate, endDate]
    );

    return sessions.map(s => ({
      ...s,
      status: s.exit_at ? 'finished' : 'active',
      duration_minutes: calculateDuration(s.entry_at, s.exit_at),
    })) as ComputedSession[];
  } catch (error) {
    logger.error('database', 'Error fetching sessions by period', { error: String(error) });
    return [];
  }
}

export async function getTodayStats(userId: string): Promise<DayStats> {
  try {
    const sessions = await getTodaySessions(userId);
    const finished = sessions.filter(s => s.exit_at);
    
    // Calculate total considering pauses
    let totalMinutes = 0;
    for (const s of finished) {
      const duration = calculateDuration(s.entry_at, s.exit_at);
      const pause = s.pause_minutes || 0;
      totalMinutes += Math.max(0, duration - pause);
    }

    return {
      total_minutes: totalMinutes,
      total_sessions: finished.length,
    };
  } catch (error) {
    logger.error('database', 'Error calculating stats', { error: String(error) });
    return { total_minutes: 0, total_sessions: 0 };
  }
}

// ============================================
// SYNC
// ============================================

export async function getRecordsForSync(userId: string): Promise<RecordDB[]> {
  try {
    return db.getAllSync<RecordDB>(
      `SELECT * FROM records WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching records for sync', { error: String(error) });
    return [];
  }
}

export async function markRecordSynced(id: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE records SET synced_at = ? WHERE id = ?`,
      [now(), id]
    );
  } catch (error) {
    logger.error('database', 'Error marking record synced', { error: String(error) });
  }
}

/**
 * Upsert record from Supabase
 */
export async function upsertRecordFromSync(record: RecordDB): Promise<void> {
  try {
    const existing = db.getFirstSync<RecordDB>(
      `SELECT * FROM records WHERE id = ?`,
      [record.id]
    );

    if (existing) {
      // Update if changed
      db.runSync(
        `UPDATE records SET exit_at = ?, manually_edited = ?, edit_reason = ?, pause_minutes = ?, synced_at = ? WHERE id = ?`,
        [record.exit_at, record.manually_edited, record.edit_reason, record.pause_minutes || 0, now(), record.id]
      );
    } else {
      db.runSync(
        `INSERT INTO records (id, user_id, location_id, location_name, entry_at, exit_at, type, 
         manually_edited, edit_reason, color, device_id, pause_minutes, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.user_id, record.location_id, record.location_name, record.entry_at,
         record.exit_at, record.type, record.manually_edited, record.edit_reason,
         record.color, record.device_id, record.pause_minutes || 0, record.created_at, now()]
      );
    }
  } catch (error) {
    logger.error('database', 'Error in record upsert', { error: String(error) });
  }
}
