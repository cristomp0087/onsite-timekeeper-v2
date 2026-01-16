/**
 * Telemetry - OnSite Timekeeper
 * 
 * Product analytics for UI events.
 * Uses existing analytics_daily infrastructure (no new tables).
 * 
 * NOTE: This is a thin wrapper around database/analytics.ts
 * It adds convenience functions for common UI events.
 */

import { logger } from './logger';
import { 
  trackMetric, 
  trackFeatureUsed,
  type AnalyticsField,
  type FeatureName,
} from './database';
import { useAuthStore } from '../stores/authStore';

// ============================================
// TYPES
// ============================================

export interface UIEventPayload {
  locationId?: string;
  source?: 'home' | 'reports' | 'notification' | 'timer';
  durationMinutes?: number;
  suggestionDelta?: number;
  fromTab?: string;
  toTab?: string;
}

// ============================================
// MAIN API
// ============================================

/**
 * Log a UI event for product analytics.
 * Uses existing trackMetric/trackFeatureUsed from database/analytics.ts
 * 
 * @param metric - Metric name from AnalyticsField (optional)
 * @param feature - Feature name from FeatureName (optional)
 * @param payload - Context for logging
 */
export async function logUIEvent(
  metric: AnalyticsField | null,
  feature: FeatureName | null,
  payload?: UIEventPayload
): Promise<void> {
  const userId = useAuthStore.getState().getUserId();
  
  if (!userId) {
    logger.debug('telemetry', 'Skip event (no user)');
    return;
  }
  
  try {
    // Track metric if provided
    if (metric) {
      await trackMetric(userId, metric);
    }
    
    // Track feature if provided
    if (feature) {
      await trackFeatureUsed(userId, feature);
    }
    
    // Log for debugging
    const eventName = feature || metric || 'unknown';
    logger.info('telemetry', `📊 ${eventName}`, payload ? { ...payload } : undefined);
    
  } catch (error) {
    // Telemetry should never break the app
    logger.warn('telemetry', 'Failed to track event', { error: String(error) });
  }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Track manual entry save
 * Increments: manual_entries
 * Feature: manual_entry
 */
export async function trackManualSave(params: {
  locationId: string;
  durationMinutes: number;
  usedSuggestion: boolean;
  suggestionDelta?: number;
}): Promise<void> {
  // manual_entries is already tracked in records.ts createEntryRecord
  // Just track the feature usage here
  await logUIEvent(null, 'manual_entry', {
    locationId: params.locationId,
    durationMinutes: params.durationMinutes,
    source: 'home',
  });
  
  // Log suggestion behavior for analysis
  if (params.usedSuggestion) {
    logger.info('telemetry', '📊 suggestion_behavior', {
      locationId: params.locationId,
      modified: params.suggestionDelta !== 0,
      delta: params.suggestionDelta,
    });
  }
}

/**
 * Track tab navigation
 * Feature: view_history (for Reports tab)
 */
export async function trackTabNavigation(from: string, to: string): Promise<void> {
  // Only track Reports tab as a feature
  if (to === 'reports') {
    await logUIEvent(null, 'view_history', { fromTab: from, toTab: to });
  } else {
    // Just log others for debugging
    logger.debug('telemetry', `📊 tab_${to}`, { fromTab: from });
  }
}

/**
 * Track geofence-triggered session
 * Metrics already tracked in records.ts (auto_entries)
 */
export function trackGeofenceSession(type: 'start' | 'end', locationId: string): void {
  // auto_entries already tracked in records.ts
  // Just log for debugging
  logger.info('telemetry', `📊 geofence_${type}`, { locationId, source: 'notification' });
}

/**
 * Track export action
 * Feature: export_report
 */
export async function trackExport(format: 'pdf' | 'excel'): Promise<void> {
  await logUIEvent(null, 'export_report', { source: 'reports' });
  logger.info('telemetry', `📊 export_${format}`);
}

/**
 * Track session edit
 * Feature: edit_record
 */
export async function trackSessionEdit(sessionId: string): Promise<void> {
  await logUIEvent(null, 'edit_record', { locationId: sessionId });
}

/**
 * Track session delete
 * Feature: delete_record
 */
export async function trackSessionDelete(sessionId: string): Promise<void> {
  await logUIEvent(null, 'delete_record', { locationId: sessionId });
}

/**
 * Track day modal open
 * Feature: view_history
 */
export async function trackDayModalOpen(date: string): Promise<void> {
  await logUIEvent(null, 'view_history', { source: 'reports' });
  logger.debug('telemetry', '📊 day_modal_open', { date });
}

/**
 * Track share report
 * Feature: share_report
 */
export async function trackShareReport(): Promise<void> {
  await logUIEvent(null, 'share_report', { source: 'reports' });
}
