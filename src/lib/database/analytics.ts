/**
 * Database - Analytics
 * 
 * Unified analytics system with 5 spheres:
 * - Identity: Who is the user
 * - Business: Value generated (sessions, hours)
 * - Product: UX metrics (feature usage, flows)
 * - Debug: Error tracking, sync health
 * - Metadata: App version, device info
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { logger } from '../logger';
import {
  db,
  generateUUID,
  now,
  getToday,
  type AnalyticsDailyDB,
} from './core';

// ============================================
// TYPES
// ============================================

export type AnalyticsField = 
  // Business
  | 'sessions_count'
  | 'total_minutes'
  | 'manual_entries'
  | 'auto_entries'
  | 'locations_created'
  | 'locations_deleted'
  // Product
  | 'app_opens'
  | 'app_foreground_seconds'
  | 'notifications_shown'
  | 'notifications_actioned'
  // Debug
  | 'errors_count'
  | 'sync_attempts'
  | 'sync_failures'
  | 'geofence_triggers';

export type FeatureName =
  | 'create_location'
  | 'edit_location'
  | 'delete_location'
  | 'manual_entry'
  | 'edit_record'
  | 'delete_record'
  | 'share_report'
  | 'export_report'
  | 'view_history'
  | 'sync_manual'
  | 'settings_changed'
  | 'notification_response';

// ============================================
// HELPERS
// ============================================

/**
 * Get device metadata for analytics
 */
export function getDeviceMetadata(): {
  app_version: string;
  os: string;
  device_model: string;
} {
  return {
    app_version: Application.nativeApplicationVersion || 'unknown',
    os: `${Platform.OS} ${Platform.Version}`,
    device_model: Device.modelName || 'unknown',
  };
}

/**
 * Ensures a row exists for today
 */
function ensureTodayAnalytics(userId: string): void {
  const today = getToday();
  const metadata = getDeviceMetadata();
  
  try {
    db.runSync(
      `INSERT OR IGNORE INTO analytics_daily 
       (date, user_id, app_version, os, device_model, created_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [today, userId, metadata.app_version, metadata.os, metadata.device_model, now()]
    );
  } catch {
    logger.debug('telemetry', 'Today row already exists or error creating');
  }
}

// ============================================
// INCREMENT FUNCTIONS
// ============================================

/**
 * Increment a numeric analytics field
 */
export async function trackMetric(
  userId: string,
  field: AnalyticsField,
  increment: number = 1
): Promise<void> {
  try {
    ensureTodayAnalytics(userId);
    const today = getToday();
    
    db.runSync(
      `UPDATE analytics_daily 
       SET ${field} = ${field} + ?, synced_at = NULL 
       WHERE date = ? AND user_id = ?`,
      [increment, today, userId]
    );
    
    logger.debug('telemetry', `📊 Tracked: ${field} +${increment}`);
  } catch (error) {
    logger.error('telemetry', `Error tracking ${field}`, { error: String(error) });
  }
}

/**
 * Track geofence trigger with accuracy
 */
export async function trackGeofenceTrigger(
  userId: string,
  accuracy: number | null
): Promise<void> {
  try {
    ensureTodayAnalytics(userId);
    const today = getToday();
    
    if (accuracy !== null && accuracy > 0) {
      db.runSync(
        `UPDATE analytics_daily SET 
          geofence_triggers = geofence_triggers + 1,
          geofence_accuracy_sum = geofence_accuracy_sum + ?,
          geofence_accuracy_count = geofence_accuracy_count + 1,
          synced_at = NULL
        WHERE date = ? AND user_id = ?`,
        [accuracy, today, userId]
      );
    } else {
      db.runSync(
        `UPDATE analytics_daily SET 
          geofence_triggers = geofence_triggers + 1, 
          synced_at = NULL 
        WHERE date = ? AND user_id = ?`,
        [today, userId]
      );
    }
    
    logger.debug('telemetry', '📊 Geofence trigger tracked', { accuracy });
  } catch (error) {
    logger.error('telemetry', 'Error tracking geofence', { error: String(error) });
  }
}

/**
 * Track feature usage
 */
export async function trackFeatureUsed(
  userId: string,
  feature: FeatureName
): Promise<void> {
  try {
    ensureTodayAnalytics(userId);
    const today = getToday();
    
    // Get current features
    const row = db.getFirstSync<{ features_used: string }>(
      `SELECT features_used FROM analytics_daily WHERE date = ? AND user_id = ?`,
      [today, userId]
    );
    
    let features: string[] = [];
    try {
      features = JSON.parse(row?.features_used || '[]');
    } catch {
      features = [];
    }
    
    // Add feature if not already present
    if (!features.includes(feature)) {
      features.push(feature);
    }
    
    db.runSync(
      `UPDATE analytics_daily SET features_used = ?, synced_at = NULL WHERE date = ? AND user_id = ?`,
      [JSON.stringify(features), today, userId]
    );
    
    logger.debug('telemetry', `📊 Feature tracked: ${feature}`);
  } catch (error) {
    logger.error('telemetry', 'Error tracking feature', { error: String(error) });
  }
}

/**
 * Add session minutes to daily total
 */
export async function trackSessionMinutes(
  userId: string,
  minutes: number,
  isManual: boolean
): Promise<void> {
  try {
    ensureTodayAnalytics(userId);
    const today = getToday();
    
    const entryField = isManual ? 'manual_entries' : 'auto_entries';
    
    db.runSync(
      `UPDATE analytics_daily SET 
        sessions_count = sessions_count + 1,
        total_minutes = total_minutes + ?,
        ${entryField} = ${entryField} + 1,
        synced_at = NULL
      WHERE date = ? AND user_id = ?`,
      [minutes, today, userId]
    );
    
    logger.debug('telemetry', `📊 Session tracked: ${minutes}min (${isManual ? 'manual' : 'auto'})`);
  } catch (error) {
    logger.error('telemetry', 'Error tracking session', { error: String(error) });
  }
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get today's analytics
 */
export async function getTodayAnalytics(userId: string): Promise<AnalyticsDailyDB | null> {
  try {
    return db.getFirstSync<AnalyticsDailyDB>(
      `SELECT * FROM analytics_daily WHERE date = ? AND user_id = ?`,
      [getToday(), userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Error fetching today analytics', { error: String(error) });
    return null;
  }
}

/**
 * Get analytics for date range
 */
export async function getAnalyticsByPeriod(
  userId: string,
  startDate: string,
  endDate: string
): Promise<AnalyticsDailyDB[]> {
  try {
    return db.getAllSync<AnalyticsDailyDB>(
      `SELECT * FROM analytics_daily 
       WHERE user_id = ? AND date >= ? AND date <= ? 
       ORDER BY date ASC`,
      [userId, startDate, endDate]
    );
  } catch (error) {
    logger.error('telemetry', 'Error fetching analytics by period', { error: String(error) });
    return [];
  }
}

/**
 * Get analytics pending sync
 */
export async function getAnalyticsForSync(userId: string): Promise<AnalyticsDailyDB[]> {
  try {
    return db.getAllSync<AnalyticsDailyDB>(
      `SELECT * FROM analytics_daily WHERE user_id = ? AND synced_at IS NULL ORDER BY date ASC`,
      [userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Error fetching analytics for sync', { error: String(error) });
    return [];
  }
}

/**
 * Mark analytics as synced
 */
export async function markAnalyticsSynced(date: string, userId: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE analytics_daily SET synced_at = ? WHERE date = ? AND user_id = ?`,
      [now(), date, userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Error marking analytics synced', { error: String(error) });
  }
}

/**
 * Clean old analytics (already synced, older than X days)
 */
export async function cleanOldAnalytics(daysToKeep: number = 30): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    const result = db.runSync(
      `DELETE FROM analytics_daily WHERE date < ? AND synced_at IS NOT NULL`,
      [cutoffStr]
    );
    
    const deleted = result.changes || 0;
    if (deleted > 0) {
      logger.info('telemetry', `🧹 Old analytics cleaned: ${deleted} days`);
    }
    return deleted;
  } catch (error) {
    logger.error('telemetry', 'Error cleaning old analytics', { error: String(error) });
    return 0;
  }
}

// ============================================
// AGGREGATED STATS
// ============================================

export interface AnalyticsSummary {
  // Business
  totalSessions: number;
  totalMinutes: number;
  totalHours: number;
  manualVsAutoRatio: number;
  
  // Product
  avgAppOpensPerDay: number;
  notificationResponseRate: number;
  featuresUsedCount: number;
  
  // Debug
  totalErrors: number;
  syncFailureRate: number;
  avgGeofenceAccuracy: number;
}

/**
 * Get aggregated analytics summary for a period
 */
export async function getAnalyticsSummary(
  userId: string,
  startDate: string,
  endDate: string
): Promise<AnalyticsSummary> {
  try {
    const data = await getAnalyticsByPeriod(userId, startDate, endDate);
    
    if (data.length === 0) {
      return {
        totalSessions: 0,
        totalMinutes: 0,
        totalHours: 0,
        manualVsAutoRatio: 0,
        avgAppOpensPerDay: 0,
        notificationResponseRate: 0,
        featuresUsedCount: 0,
        totalErrors: 0,
        syncFailureRate: 0,
        avgGeofenceAccuracy: 0,
      };
    }
    
    // Aggregate
    const totals = data.reduce((acc, day) => ({
      sessions: acc.sessions + day.sessions_count,
      minutes: acc.minutes + day.total_minutes,
      manual: acc.manual + day.manual_entries,
      auto: acc.auto + day.auto_entries,
      appOpens: acc.appOpens + day.app_opens,
      notifShown: acc.notifShown + day.notifications_shown,
      notifActioned: acc.notifActioned + day.notifications_actioned,
      errors: acc.errors + day.errors_count,
      syncAttempts: acc.syncAttempts + day.sync_attempts,
      syncFailures: acc.syncFailures + day.sync_failures,
      geoAccSum: acc.geoAccSum + day.geofence_accuracy_sum,
      geoAccCount: acc.geoAccCount + day.geofence_accuracy_count,
    }), {
      sessions: 0, minutes: 0, manual: 0, auto: 0, appOpens: 0,
      notifShown: 0, notifActioned: 0, errors: 0, syncAttempts: 0,
      syncFailures: 0, geoAccSum: 0, geoAccCount: 0,
    });
    
    // Collect all unique features
    const allFeatures = new Set<string>();
    data.forEach(day => {
      try {
        const features = JSON.parse(day.features_used || '[]');
        features.forEach((f: string) => allFeatures.add(f));
      } catch {}
    });
    
    return {
      totalSessions: totals.sessions,
      totalMinutes: totals.minutes,
      totalHours: Math.round(totals.minutes / 60 * 10) / 10,
      manualVsAutoRatio: totals.auto > 0 
        ? Math.round(totals.manual / totals.auto * 100) / 100 
        : 0,
      avgAppOpensPerDay: Math.round(totals.appOpens / data.length * 10) / 10,
      notificationResponseRate: totals.notifShown > 0 
        ? Math.round(totals.notifActioned / totals.notifShown * 100) 
        : 0,
      featuresUsedCount: allFeatures.size,
      totalErrors: totals.errors,
      syncFailureRate: totals.syncAttempts > 0 
        ? Math.round(totals.syncFailures / totals.syncAttempts * 100) 
        : 0,
      avgGeofenceAccuracy: totals.geoAccCount > 0 
        ? Math.round(totals.geoAccSum / totals.geoAccCount) 
        : 0,
    };
  } catch (error) {
    logger.error('telemetry', 'Error getting summary', { error: String(error) });
    return {
      totalSessions: 0, totalMinutes: 0, totalHours: 0, manualVsAutoRatio: 0,
      avgAppOpensPerDay: 0, notificationResponseRate: 0, featuresUsedCount: 0,
      totalErrors: 0, syncFailureRate: 0, avgGeofenceAccuracy: 0,
    };
  }
}

/**
 * Get analytics debug info
 */
export async function getAnalyticsDebugInfo(userId: string): Promise<{
  pendingDays: number;
  syncedDays: number;
  today: AnalyticsDailyDB | null;
}> {
  try {
    const pending = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM analytics_daily WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
    
    const synced = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM analytics_daily WHERE user_id = ? AND synced_at IS NOT NULL`,
      [userId]
    );
    
    const today = await getTodayAnalytics(userId);
    
    return {
      pendingDays: pending?.count || 0,
      syncedDays: synced?.count || 0,
      today,
    };
  } catch (error) {
    logger.error('telemetry', 'Error getting debug info', { error: String(error) });
    return { pendingDays: 0, syncedDays: 0, today: null };
  }
}
