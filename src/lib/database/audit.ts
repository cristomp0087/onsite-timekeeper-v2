/**
 * Database - Location Audit
 * 
 * GPS audit trail for entries/exits only.
 * This replaces the old geopoints table which collected too much data.
 * 
 * Only records:
 * - Entry events (when session starts)
 * - Exit events (when session ends)
 * - Disputes (if user disputes a time)
 * - Corrections (manual adjustments)
 */

import { logger } from '../logger';
import {
  db,
  generateUUID,
  now,
  type LocationAuditDB,
  type AuditEventType,
} from './core';

// ============================================
// RECORD AUDIT EVENTS
// ============================================

/**
 * Record a location audit event
 */
export async function recordLocationAudit(
  userId: string,
  eventType: AuditEventType,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  locationId: string | null,
  locationName: string | null,
  sessionId: string | null
): Promise<string> {
  const id = generateUUID();
  const timestamp = now();
  
  try {
    db.runSync(
      `INSERT INTO location_audit 
       (id, user_id, session_id, event_type, location_id, location_name, 
        latitude, longitude, accuracy, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        sessionId,
        eventType,
        locationId,
        locationName,
        latitude,
        longitude,
        accuracy,
        timestamp,
        timestamp,
      ]
    );
    
    logger.debug('database', `📍 Location audit: ${eventType}`, { 
      locationName, 
      lat: latitude.toFixed(6),
      lng: longitude.toFixed(6),
    });
    
    return id;
  } catch (error) {
    logger.error('database', 'Error recording location audit', { error: String(error) });
    throw error;
  }
}

/**
 * Record entry event
 */
export async function recordEntryAudit(
  userId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  locationId: string,
  locationName: string,
  sessionId: string
): Promise<string> {
  return recordLocationAudit(
    userId, 'entry', latitude, longitude, accuracy,
    locationId, locationName, sessionId
  );
}

/**
 * Record exit event
 */
export async function recordExitAudit(
  userId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  locationId: string,
  locationName: string,
  sessionId: string
): Promise<string> {
  return recordLocationAudit(
    userId, 'exit', latitude, longitude, accuracy,
    locationId, locationName, sessionId
  );
}

/**
 * Record dispute event (user contests a time)
 */
export async function recordDisputeAudit(
  userId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  sessionId: string,
  locationName: string
): Promise<string> {
  return recordLocationAudit(
    userId, 'dispute', latitude, longitude, accuracy,
    null, locationName, sessionId
  );
}

/**
 * Record correction event (manual time adjustment)
 */
export async function recordCorrectionAudit(
  userId: string,
  sessionId: string,
  locationName: string
): Promise<string> {
  // For corrections, we don't have GPS - use 0,0
  return recordLocationAudit(
    userId, 'correction', 0, 0, null,
    null, locationName, sessionId
  );
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get audit trail for a session
 */
export async function getSessionAudit(sessionId: string): Promise<LocationAuditDB[]> {
  try {
    return db.getAllSync<LocationAuditDB>(
      `SELECT * FROM location_audit WHERE session_id = ? ORDER BY occurred_at ASC`,
      [sessionId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching session audit', { error: String(error) });
    return [];
  }
}

/**
 * Get audit trail for a user
 */
export async function getUserAudit(
  userId: string,
  limit: number = 100
): Promise<LocationAuditDB[]> {
  try {
    return db.getAllSync<LocationAuditDB>(
      `SELECT * FROM location_audit WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ?`,
      [userId, limit]
    );
  } catch (error) {
    logger.error('database', 'Error fetching user audit', { error: String(error) });
    return [];
  }
}

/**
 * Get audit by date range
 */
export async function getAuditByPeriod(
  userId: string,
  startDate: string,
  endDate: string
): Promise<LocationAuditDB[]> {
  try {
    return db.getAllSync<LocationAuditDB>(
      `SELECT * FROM location_audit 
       WHERE user_id = ? AND occurred_at >= ? AND occurred_at <= ?
       ORDER BY occurred_at ASC`,
      [userId, startDate, endDate]
    );
  } catch (error) {
    logger.error('database', 'Error fetching audit by period', { error: String(error) });
    return [];
  }
}

/**
 * Get audit pending sync
 */
export async function getAuditForSync(userId: string, limit: number = 100): Promise<LocationAuditDB[]> {
  try {
    return db.getAllSync<LocationAuditDB>(
      `SELECT * FROM location_audit WHERE user_id = ? AND synced_at IS NULL ORDER BY occurred_at ASC LIMIT ?`,
      [userId, limit]
    );
  } catch (error) {
    logger.error('database', 'Error fetching audit for sync', { error: String(error) });
    return [];
  }
}

/**
 * Mark audit records as synced
 */
export async function markAuditSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  
  try {
    const placeholders = ids.map(() => '?').join(',');
    db.runSync(
      `UPDATE location_audit SET synced_at = ? WHERE id IN (${placeholders})`,
      [now(), ...ids]
    );
    logger.debug('database', `${ids.length} audit records marked as synced`);
  } catch (error) {
    logger.error('database', 'Error marking audit synced', { error: String(error) });
  }
}

/**
 * Clean old audit records (already synced, older than X days)
 */
export async function cleanOldAudit(daysToKeep: number = 90): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    
    const result = db.runSync(
      `DELETE FROM location_audit WHERE occurred_at < ? AND synced_at IS NOT NULL`,
      [cutoff.toISOString()]
    );
    
    const deleted = result.changes || 0;
    if (deleted > 0) {
      logger.info('database', `🧹 Old audit records cleaned: ${deleted}`);
    }
    return deleted;
  } catch (error) {
    logger.error('database', 'Error cleaning old audit', { error: String(error) });
    return 0;
  }
}

// ============================================
// STATS
// ============================================

export interface AuditStats {
  total: number;
  pending: number;
  byType: {
    entry: number;
    exit: number;
    dispute: number;
    correction: number;
  };
  lastTimestamp: string | null;
}

/**
 * Get audit statistics
 */
export async function getAuditStats(userId: string): Promise<AuditStats> {
  try {
    const total = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM location_audit WHERE user_id = ?`,
      [userId]
    );
    
    const pending = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM location_audit WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
    
    const last = db.getFirstSync<{ occurred_at: string }>(
      `SELECT occurred_at FROM location_audit WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 1`,
      [userId]
    );
    
    // Count by type
    const byTypeRows = db.getAllSync<{ event_type: string; count: number }>(
      `SELECT event_type, COUNT(*) as count FROM location_audit WHERE user_id = ? GROUP BY event_type`,
      [userId]
    );
    
    const byType = {
      entry: 0,
      exit: 0,
      dispute: 0,
      correction: 0,
    };
    
    byTypeRows.forEach(row => {
      if (row.event_type in byType) {
        byType[row.event_type as keyof typeof byType] = row.count;
      }
    });
    
    return {
      total: total?.count || 0,
      pending: pending?.count || 0,
      byType,
      lastTimestamp: last?.occurred_at || null,
    };
  } catch (error) {
    logger.error('database', 'Error getting audit stats', { error: String(error) });
    return {
      total: 0,
      pending: 0,
      byType: { entry: 0, exit: 0, dispute: 0, correction: 0 },
      lastTimestamp: null,
    };
  }
}

// ============================================
// PROOF GENERATION
// ============================================

export interface SessionProof {
  sessionId: string;
  locationName: string;
  entryAudit: LocationAuditDB | null;
  exitAudit: LocationAuditDB | null;
  hasGPSProof: boolean;
  entryAccuracy: number | null;
  exitAccuracy: number | null;
}

/**
 * Generate proof data for a session (for reports/disputes)
 */
export async function getSessionProof(sessionId: string): Promise<SessionProof | null> {
  try {
    const audits = await getSessionAudit(sessionId);
    
    if (audits.length === 0) return null;
    
    const entryAudit = audits.find(a => a.event_type === 'entry') || null;
    const exitAudit = audits.find(a => a.event_type === 'exit') || null;
    
    return {
      sessionId,
      locationName: entryAudit?.location_name || exitAudit?.location_name || 'Unknown',
      entryAudit,
      exitAudit,
      hasGPSProof: entryAudit !== null || exitAudit !== null,
      entryAccuracy: entryAudit?.accuracy || null,
      exitAccuracy: exitAudit?.accuracy || null,
    };
  } catch (error) {
    logger.error('database', 'Error getting session proof', { error: String(error) });
    return null;
  }
}
