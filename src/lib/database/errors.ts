/**
 * Database - Error Tracking
 * 
 * Structured error logging for debugging:
 * - Error type categorization
 * - Stack traces
 * - Context (what user was doing)
 * - Device/app metadata
 * - Ping-pong event tracking (geofence boundary oscillation)
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { logger } from '../logger';
import {
  db,
  generateUUID,
  now,
  type ErrorLogDB,
} from './core';
import { trackMetric } from './analytics';

// ============================================
// TYPES
// ============================================

export type ErrorType =
  | 'sync_error'
  | 'database_error'
  | 'network_error'
  | 'geofence_error'
  | 'notification_error'
  | 'auth_error'
  | 'permission_error'
  | 'validation_error'
  | 'runtime_error'
  | 'pingpong_event'
  | 'pingpong_warning'
  | 'unknown_error'
  | 'foreground_service_killed';


export interface ErrorContext {
  screen?: string;
  action?: string;
  locationId?: string;
  sessionId?: string;
  userId?: string;
  additionalData?: Record<string, unknown>;
  locationName?: string;
  platform?: string;
  timestamp?: string;
  isMonitoring?: boolean;
}


// Ping-pong specific data structure
export interface PingPongEventData {
  eventType: 'enter' | 'exit' | 'check';
  source: 'geofence' | 'heartbeat' | 'reconcile' | 'manual';
  fenceId: string;
  fenceName: string;
  distance: number;
  radius: number;
  effectiveRadius: number;
  margin: number;
  marginPercent: number;
  isInside: boolean;
  gpsAccuracy?: number;
  isPingPonging?: boolean;
  recentEnters?: number;
  recentExits?: number;
}

// ============================================
// CAPTURE ERROR
// ============================================

/**
 * Capture and log an error
 */
export async function captureError(
  error: Error | string,
  type: ErrorType = 'unknown_error',
  context?: ErrorContext
): Promise<string> {
  const id = generateUUID();
  const timestamp = now();
  
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack || null : null;
    
    const metadata = {
      app_version: Application.nativeApplicationVersion || 'unknown',
      os: Platform.OS,
      os_version: String(Platform.Version),
      device_model: Device.modelName || 'unknown',
    };
    
    db.runSync(
      `INSERT INTO error_log 
       (id, user_id, error_type, error_message, error_stack, error_context, 
        app_version, os, os_version, device_model, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        context?.userId || null,
        type,
        errorMessage,
        errorStack,
        context ? JSON.stringify(context) : null,
        metadata.app_version,
        metadata.os,
        metadata.os_version,
        metadata.device_model,
        timestamp,
        timestamp,
      ]
    );
    
    // Update analytics error count
    if (context?.userId) {
      await trackMetric(context.userId, 'errors_count');
    }
    
    logger.error('database', `🔴 Error captured: ${type}`, { 
      id, 
      message: errorMessage.substring(0, 100),
      context: context?.action,
    });
    
    return id;
  } catch (logError) {
    // Don't throw if error logging fails
    logger.error('database', 'Failed to capture error', { error: String(logError) });
    return id;
  }
}

// ============================================
// PING-PONG EVENT TRACKING
// ============================================

/**
 * Capture a ping-pong event (geofence boundary oscillation tracking)
 * This helps debug GPS jitter and fence boundary issues
 */
export async function capturePingPongEvent(
  userId: string,
  data: PingPongEventData
): Promise<string> {
  const id = generateUUID();
  const timestamp = now();
  
  try {
    // Determine if this is a warning (low margin or actual ping-pong)
    const isWarning = data.isPingPonging || data.marginPercent < 15 || (data.gpsAccuracy && data.gpsAccuracy > 30);
    const type: ErrorType = isWarning ? 'pingpong_warning' : 'pingpong_event';
    
    // Build descriptive message
    const message = `${data.eventType.toUpperCase()} @ ${data.fenceName} | ` +
      `dist: ${data.distance.toFixed(1)}m | ` +
      `radius: ${data.radius}m (eff: ${data.effectiveRadius.toFixed(1)}m) | ` +
      `margin: ${data.margin.toFixed(1)}m (${data.marginPercent.toFixed(1)}%) | ` +
      `GPS: ${data.gpsAccuracy ? data.gpsAccuracy.toFixed(1) + 'm' : 'N/A'}` +
      (data.isPingPonging ? ' | 🔴 PING-PONG!' : '');
    
    const metadata = {
      app_version: Application.nativeApplicationVersion || 'unknown',
      os: Platform.OS,
      os_version: String(Platform.Version),
      device_model: Device.modelName || 'unknown',
    };
    
    db.runSync(
      `INSERT INTO error_log 
       (id, user_id, error_type, error_message, error_stack, error_context, 
        app_version, os, os_version, device_model, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        type,
        message,
        null, // No stack trace for events
        JSON.stringify(data),
        metadata.app_version,
        metadata.os,
        metadata.os_version,
        metadata.device_model,
        timestamp,
        timestamp,
      ]
    );
    
    // Log to console as well
    if (isWarning) {
      logger.warn('pingpong', `🔴 ${message}`);
    } else {
      logger.debug('pingpong', `📍 ${message}`);
    }
    
    return id;
  } catch (logError) {
    logger.error('database', 'Failed to capture ping-pong event', { error: String(logError) });
    return id;
  }
}

/**
 * Get ping-pong events from error_log for analysis
 */
export function getPingPongEvents(
  userId?: string,
  limit: number = 100
): PingPongEventData[] {
  try {
    const query = userId
      ? `SELECT error_context FROM error_log 
         WHERE error_type IN ('pingpong_event', 'pingpong_warning') AND user_id = ? 
         ORDER BY occurred_at DESC LIMIT ?`
      : `SELECT error_context FROM error_log 
         WHERE error_type IN ('pingpong_event', 'pingpong_warning') 
         ORDER BY occurred_at DESC LIMIT ?`;
    
    const params = userId ? [userId, limit] : [limit];
    const rows = db.getAllSync<{ error_context: string }>(query, params);
    
    return rows
      .map(row => {
        try {
          return JSON.parse(row.error_context) as PingPongEventData;
        } catch {
          return null;
        }
      })
      .filter((data): data is PingPongEventData => data !== null);
  } catch (error) {
    logger.error('database', 'Error fetching ping-pong events', { error: String(error) });
    return [];
  }
}

/**
 * Get ping-pong statistics from error_log
 */
export function getPingPongStats(userId?: string): {
  totalEvents: number;
  warnings: number;
  enters: number;
  exits: number;
  checks: number;
  avgMarginPercent: number;
  avgGpsAccuracy: number;
  pingPongCount: number;
} {
  try {
    const userFilter = userId ? 'AND user_id = ?' : '';
    const params = userId ? [userId] : [];
    
    // Get counts
    const totalRow = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM error_log WHERE error_type IN ('pingpong_event', 'pingpong_warning') ${userFilter}`,
      params
    );
    
    const warningRow = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM error_log WHERE error_type = 'pingpong_warning' ${userFilter}`,
      params
    );
    
    // Get events for detailed stats
    const events = getPingPongEvents(userId, 500);
    
    const enters = events.filter(e => e.eventType === 'enter').length;
    const exits = events.filter(e => e.eventType === 'exit').length;
    const checks = events.filter(e => e.eventType === 'check').length;
    const pingPongCount = events.filter(e => e.isPingPonging).length;
    
    const marginsWithValue = events.filter(e => e.marginPercent !== undefined);
    const avgMarginPercent = marginsWithValue.length > 0
      ? marginsWithValue.reduce((sum, e) => sum + e.marginPercent, 0) / marginsWithValue.length
      : 0;
    
    const accuraciesWithValue = events.filter(e => e.gpsAccuracy !== undefined && e.gpsAccuracy !== null);
    const avgGpsAccuracy = accuraciesWithValue.length > 0
      ? accuraciesWithValue.reduce((sum, e) => sum + (e.gpsAccuracy || 0), 0) / accuraciesWithValue.length
      : 0;
    
    return {
      totalEvents: totalRow?.count || 0,
      warnings: warningRow?.count || 0,
      enters,
      exits,
      checks,
      avgMarginPercent: Math.round(avgMarginPercent * 10) / 10,
      avgGpsAccuracy: Math.round(avgGpsAccuracy * 10) / 10,
      pingPongCount,
    };
  } catch (error) {
    logger.error('database', 'Error getting ping-pong stats', { error: String(error) });
    return {
      totalEvents: 0,
      warnings: 0,
      enters: 0,
      exits: 0,
      checks: 0,
      avgMarginPercent: 0,
      avgGpsAccuracy: 0,
      pingPongCount: 0,
    };
  }
}

/**
 * Capture error with automatic type detection
 */
export async function captureErrorAuto(
  error: Error | string,
  context?: ErrorContext
): Promise<string> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Auto-detect error type
  let type: ErrorType = 'unknown_error';
  
  if (errorMessage.toLowerCase().includes('network') || 
      errorMessage.toLowerCase().includes('fetch') ||
      errorMessage.toLowerCase().includes('timeout')) {
    type = 'network_error';
  } else if (errorMessage.toLowerCase().includes('sync')) {
    type = 'sync_error';
  } else if (errorMessage.toLowerCase().includes('database') || 
             errorMessage.toLowerCase().includes('sqlite')) {
    type = 'database_error';
  } else if (errorMessage.toLowerCase().includes('geofence') || 
             errorMessage.toLowerCase().includes('location')) {
    type = 'geofence_error';
  } else if (errorMessage.toLowerCase().includes('notification')) {
    type = 'notification_error';
  } else if (errorMessage.toLowerCase().includes('auth') || 
             errorMessage.toLowerCase().includes('login') ||
             errorMessage.toLowerCase().includes('session')) {
    type = 'auth_error';
  } else if (errorMessage.toLowerCase().includes('permission')) {
    type = 'permission_error';
  } else if (errorMessage.toLowerCase().includes('validation') || 
             errorMessage.toLowerCase().includes('invalid')) {
    type = 'validation_error';
  }
  
  return captureError(error, type, context);
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get recent errors
 */
export async function getRecentErrors(
  userId: string | null,
  limit: number = 50
): Promise<ErrorLogDB[]> {
  try {
    if (userId) {
      return db.getAllSync<ErrorLogDB>(
        `SELECT * FROM error_log WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ?`,
        [userId, limit]
      );
    } else {
      return db.getAllSync<ErrorLogDB>(
        `SELECT * FROM error_log ORDER BY occurred_at DESC LIMIT ?`,
        [limit]
      );
    }
  } catch (error) {
    logger.error('database', 'Error fetching recent errors', { error: String(error) });
    return [];
  }
}

/**
 * Get errors by type
 */
export async function getErrorsByType(
  type: ErrorType,
  limit: number = 50
): Promise<ErrorLogDB[]> {
  try {
    return db.getAllSync<ErrorLogDB>(
      `SELECT * FROM error_log WHERE error_type = ? ORDER BY occurred_at DESC LIMIT ?`,
      [type, limit]
    );
  } catch (error) {
    logger.error('database', 'Error fetching errors by type', { error: String(error) });
    return [];
  }
}

/**
 * Get errors pending sync
 */
export async function getErrorsForSync(limit: number = 100): Promise<ErrorLogDB[]> {
  try {
    return db.getAllSync<ErrorLogDB>(
      `SELECT * FROM error_log WHERE synced_at IS NULL ORDER BY occurred_at ASC LIMIT ?`,
      [limit]
    );
  } catch (error) {
    logger.error('database', 'Error fetching errors for sync', { error: String(error) });
    return [];
  }
}

/**
 * Mark errors as synced
 */
export async function markErrorsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  
  try {
    const placeholders = ids.map(() => '?').join(',');
    db.runSync(
      `UPDATE error_log SET synced_at = ? WHERE id IN (${placeholders})`,
      [now(), ...ids]
    );
    logger.debug('database', `${ids.length} errors marked as synced`);
  } catch (error) {
    logger.error('database', 'Error marking errors synced', { error: String(error) });
  }
}

/**
 * Clean old errors (already synced, older than X days)
 */
export async function cleanOldErrors(daysToKeep: number = 14): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    
    const result = db.runSync(
      `DELETE FROM error_log WHERE occurred_at < ? AND synced_at IS NOT NULL`,
      [cutoff.toISOString()]
    );
    
    const deleted = result.changes || 0;
    if (deleted > 0) {
      logger.info('database', `🧹 Old errors cleaned: ${deleted}`);
    }
    return deleted;
  } catch (error) {
    logger.error('database', 'Error cleaning old errors', { error: String(error) });
    return 0;
  }
}

// ============================================
// STATS
// ============================================

export interface ErrorStats {
  total: number;
  today: number;
  pending: number;
  byType: Record<ErrorType, number>;
  lastOccurred: string | null;
}

/**
 * Get error statistics
 */
export async function getErrorStats(userId?: string): Promise<ErrorStats> {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const userFilter = userId ? `AND user_id = '${userId}'` : '';
    
    const total = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM error_log WHERE 1=1 ${userFilter}`,
      []
    );
    
    const today = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM error_log WHERE occurred_at LIKE ? ${userFilter}`,
      [`${todayStr}%`]
    );
    
    const pending = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM error_log WHERE synced_at IS NULL ${userFilter}`,
      []
    );
    
    const last = db.getFirstSync<{ occurred_at: string }>(
      `SELECT occurred_at FROM error_log WHERE 1=1 ${userFilter} ORDER BY occurred_at DESC LIMIT 1`,
      []
    );
    
    // Count by type
    const byTypeRows = db.getAllSync<{ error_type: ErrorType; count: number }>(
      `SELECT error_type, COUNT(*) as count FROM error_log WHERE 1=1 ${userFilter} GROUP BY error_type`,
      []
    );
    
    const byType: Record<ErrorType, number> = {
    sync_error: 0,
    database_error: 0,
    network_error: 0,
    geofence_error: 0,
    notification_error: 0,
    auth_error: 0,
    permission_error: 0,
    validation_error: 0,
    runtime_error: 0,
    unknown_error: 0,
    pingpong_event: 0,
    pingpong_warning: 0,
    foreground_service_killed: 0,
  };
    
    byTypeRows.forEach(row => {
      byType[row.error_type] = row.count;
    });
    
    return {
      total: total?.count || 0,
      today: today?.count || 0,
      pending: pending?.count || 0,
      byType,
      lastOccurred: last?.occurred_at || null,
    };
  } catch (error) {
    logger.error('database', 'Error getting stats', { error: String(error) });
    return {
      total: 0,
      today: 0,
      pending: 0,
     byType: {
        sync_error: 0,
        database_error: 0,
        network_error: 0,
        geofence_error: 0,
        notification_error: 0,
        auth_error: 0,
        permission_error: 0,
        validation_error: 0,
        runtime_error: 0,
        unknown_error: 0,
        pingpong_event: 0,
        pingpong_warning: 0,
        foreground_service_killed: 0,
      },
      lastOccurred: null,
    };
  }
}

// ============================================
// CONVENIENCE WRAPPERS
// ============================================

/**
 * Quick sync error
 */
export function captureSyncError(error: Error | string, context?: ErrorContext) {
  return captureError(error, 'sync_error', context);
}

/**
 * Quick database error
 */
export function captureDatabaseError(error: Error | string, context?: ErrorContext) {
  return captureError(error, 'database_error', context);
}

/**
 * Quick network error
 */
export function captureNetworkError(error: Error | string, context?: ErrorContext) {
  return captureError(error, 'network_error', context);
}

/**
 * Quick geofence error
 */
export function captureGeofenceError(error: Error | string, context?: ErrorContext) {
  return captureError(error, 'geofence_error', context);
}
