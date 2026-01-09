/**
 * Sync Store - OnSite Timekeeper V2
 * 
 * Handles synchronization between local SQLite and Supabase.
 * 
 * CHANGES FROM V1:
 * - Removed: 5-minute auto-sync (battery drain)
 * - Added: Daily sync at midnight
 * - Added: Manual sync on demand
 * - Added: Sync on significant events (create location, end session)
 * - Fixed: Table names now match Supabase (locations, records)
 */

import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '../lib/logger';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  // Locations
  getLocationsForSync,
  markLocationSynced,
  upsertLocationFromSync,
  // Records
  getRecordsForSync,
  markRecordSynced,
  upsertRecordFromSync,
  // Analytics
  getAnalyticsForSync,
  markAnalyticsSynced,
  cleanOldAnalytics,
  trackMetric,
  // Errors
  getErrorsForSync,
  markErrorsSynced,
  cleanOldErrors,
  captureSyncError,
  // Audit
  getAuditForSync,
  markAuditSynced,
  cleanOldAudit,
  // Types
  type LocationDB,
  type RecordDB,
  type AnalyticsDailyDB,
  type ErrorLogDB,
  type LocationAuditDB,
} from '../lib/database';
import { useAuthStore } from './authStore';
import { useLocationStore } from './locationStore';

// ============================================
// CONSTANTS
// ============================================

const MIDNIGHT_CHECK_INTERVAL = 60 * 1000; // Check every minute
const CLEANUP_DAYS = {
  analytics: 30,
  errors: 14,
  audit: 90,
};

// ============================================
// TYPES
// ============================================

interface SyncStats {
  uploadedLocations: number;
  uploadedRecords: number;
  uploadedAnalytics: number;
  uploadedErrors: number;
  uploadedAudit: number;
  downloadedLocations: number;
  downloadedRecords: number;
  errors: string[];
}

interface SyncState {
  isSyncing: boolean;
  lastSyncAt: Date | null;
  isOnline: boolean;
  lastSyncStats: SyncStats | null;
  syncEnabled: boolean;

  // Actions
  initialize: () => Promise<() => void>;
  syncNow: () => Promise<SyncStats>;
  syncLocationsOnly: () => Promise<void>;
  syncRecordsOnly: () => Promise<void>;
  forceFullSync: () => Promise<void>;
  runCleanup: () => Promise<void>;
  toggleSync: () => void;
  
  // Debug
  debugSync: () => Promise<{ success: boolean; stats?: any }>;
}

// ============================================
// TIMERS
// ============================================

let midnightCheckInterval: ReturnType<typeof setInterval> | null = null;
let netInfoUnsubscribe: (() => void) | null = null;
let lastSyncDate: string | null = null;

// ============================================
// HELPERS
// ============================================

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

function isMidnight(): boolean {
  const now = new Date();
  return now.getHours() === 0 && now.getMinutes() < 5; // 00:00 - 00:05
}

// ============================================
// STORE
// ============================================

export const useSyncStore = create<SyncState>((set, get) => ({
  isSyncing: false,
  lastSyncAt: null,
  isOnline: true,
  lastSyncStats: null,
  syncEnabled: true,

  initialize: async () => {
    logger.info('boot', '🔄 Initializing sync store V2...');

    // ============================================
    // NETWORK LISTENER
    // ============================================
    netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected;
      logger.info('sync', `📶 Network: ${online ? 'online' : 'offline'}`);
      set({ isOnline: online });
    });

    // Initial check
    const state = await NetInfo.fetch();
    const online = !!state.isConnected;
    set({ isOnline: online });

    // ============================================
    // MIDNIGHT SYNC CHECK
    // ============================================
    midnightCheckInterval = setInterval(async () => {
      const today = getTodayDateString();
      
      // If it's midnight and we haven't synced today
      if (isMidnight() && lastSyncDate !== today) {
        const { isOnline, syncEnabled, isSyncing } = get();
        
        if (isOnline && syncEnabled && !isSyncing) {
          logger.info('sync', '🌙 Midnight sync triggered');
          lastSyncDate = today;
          await get().syncNow();
          await get().runCleanup();
        }
      }
    }, MIDNIGHT_CHECK_INTERVAL);

    // ============================================
    // INITIAL SYNC (if online)
    // ============================================
    if (isSupabaseConfigured() && online) {
      logger.info('sync', '🚀 Running initial sync...');
      try {
        await get().syncNow();
      } catch (error) {
        logger.error('sync', 'Initial sync error', { error: String(error) });
      }
    }

    logger.info('boot', '✅ Sync store V2 initialized');

    // Return cleanup function
    return () => {
      if (netInfoUnsubscribe) netInfoUnsubscribe();
      if (midnightCheckInterval) clearInterval(midnightCheckInterval);
    };
  },

  // ============================================
  // MAIN SYNC
  // ============================================
  syncNow: async () => {
    const { isSyncing, isOnline } = get();
    
    if (isSyncing) {
      logger.warn('sync', 'Sync already in progress');
      return get().lastSyncStats || createEmptyStats();
    }

    if (!isSupabaseConfigured()) {
      logger.warn('sync', '⚠️ Supabase not configured');
      return createEmptyStats();
    }

    if (!isOnline) {
      logger.warn('sync', '⚠️ Offline - skipping sync');
      return createEmptyStats();
    }

    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      logger.warn('sync', '⚠️ User not authenticated');
      return createEmptyStats();
    }

    set({ isSyncing: true, lastSyncStats: null });

    const stats: SyncStats = createEmptyStats();

    try {
      logger.info('sync', '🔄 Starting sync...');

      // Track sync attempt
      await trackMetric(userId, 'sync_attempts');

      // 1. Upload locations
      const locUp = await uploadLocations(userId);
      stats.uploadedLocations = locUp.count;
      stats.errors.push(...locUp.errors);

      // 2. Upload records
      const recUp = await uploadRecords(userId);
      stats.uploadedRecords = recUp.count;
      stats.errors.push(...recUp.errors);

      // 3. Upload analytics
      const anaUp = await uploadAnalytics(userId);
      stats.uploadedAnalytics = anaUp.count;
      stats.errors.push(...anaUp.errors);

      // 4. Upload errors
      const errUp = await uploadErrors();
      stats.uploadedErrors = errUp.count;
      stats.errors.push(...errUp.errors);

      // 5. Upload audit
      const audUp = await uploadAudit(userId);
      stats.uploadedAudit = audUp.count;
      stats.errors.push(...audUp.errors);

      // 6. Download locations
      const locDown = await downloadLocations(userId);
      stats.downloadedLocations = locDown.count;
      stats.errors.push(...locDown.errors);

      // 7. Download records
      const recDown = await downloadRecords(userId);
      stats.downloadedRecords = recDown.count;
      stats.errors.push(...recDown.errors);

      // Track failures
      if (stats.errors.length > 0) {
        await trackMetric(userId, 'sync_failures');
      }

      set({ 
        lastSyncAt: new Date(),
        lastSyncStats: stats,
      });

      logger.info('sync', '✅ Sync completed', {
        up: `${stats.uploadedLocations}L/${stats.uploadedRecords}R/${stats.uploadedAnalytics}A`,
        down: `${stats.downloadedLocations}L/${stats.downloadedRecords}R`,
        errors: stats.errors.length,
      });

      // Reload locations
      await useLocationStore.getState().reloadLocations();

      return stats;

    } catch (error) {
      const errorMsg = String(error);
      logger.error('sync', '❌ Sync error', { error: errorMsg });
      stats.errors.push(errorMsg);
      await captureSyncError(error as Error, { userId, action: 'syncNow' });
      set({ lastSyncStats: stats });
      return stats;
    } finally {
      set({ isSyncing: false });
    }
  },

  // ============================================
  // PARTIAL SYNCS
  // ============================================
  syncLocationsOnly: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    
    if (!get().isOnline || !isSupabaseConfigured()) return;
    
    await uploadLocations(userId);
    await downloadLocations(userId);
    await useLocationStore.getState().reloadLocations();
  },

  syncRecordsOnly: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    
    if (!get().isOnline || !isSupabaseConfigured()) return;
    
    await uploadRecords(userId);
    await downloadRecords(userId);
  },

  forceFullSync: async () => {
    logger.info('sync', '🔄 Force full sync...');
    set({ isSyncing: false });
    await get().syncNow();
  },

  // ============================================
  // CLEANUP
  // ============================================
  runCleanup: async () => {
    try {
      logger.info('sync', '🧹 Running cleanup...');

      const analyticsDeleted = await cleanOldAnalytics(CLEANUP_DAYS.analytics);
      const errorsDeleted = await cleanOldErrors(CLEANUP_DAYS.errors);
      const auditDeleted = await cleanOldAudit(CLEANUP_DAYS.audit);

      logger.info('sync', '✅ Cleanup completed', {
        analytics: analyticsDeleted,
        errors: errorsDeleted,
        audit: auditDeleted,
      });
    } catch (error) {
      logger.error('sync', '❌ Cleanup error', { error: String(error) });
    }
  },

  toggleSync: () => {
    const newValue = !get().syncEnabled;
    set({ syncEnabled: newValue });
    logger.info('sync', `Sync ${newValue ? 'enabled' : 'disabled'}`);
  },

  // ============================================
  // DEBUG
  // ============================================
  debugSync: async () => {
    const netState = await NetInfo.fetch();
    const userId = useAuthStore.getState().getUserId();
    
    return {
      success: true,
      stats: {
        network: {
          isConnected: netState.isConnected,
          isInternetReachable: netState.isInternetReachable,
        },
        store: {
          isOnline: get().isOnline,
          isSyncing: get().isSyncing,
          syncEnabled: get().syncEnabled,
          lastSyncAt: get().lastSyncAt?.toISOString() || null,
        },
        supabase: {
          isConfigured: isSupabaseConfigured(),
        },
        auth: {
          userId: userId || 'NOT AUTHENTICATED',
        },
        lastStats: get().lastSyncStats,
      },
    };
  },
}));

// ============================================
// UPLOAD FUNCTIONS
// ============================================

function createEmptyStats(): SyncStats {
  return {
    uploadedLocations: 0,
    uploadedRecords: 0,
    uploadedAnalytics: 0,
    uploadedErrors: 0,
    uploadedAudit: 0,
    downloadedLocations: 0,
    downloadedRecords: 0,
    errors: [],
  };
}

async function uploadLocations(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const locations = await getLocationsForSync(userId);
    logger.debug('sync', `📤 ${locations.length} locations pending`);

    for (const location of locations) {
      try {
        const { error } = await supabase.from('locations').upsert({
          id: location.id,
          user_id: location.user_id,
          name: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          radius: location.radius,
          color: location.color,
          status: location.status,
          deleted_at: location.deleted_at,
          last_seen_at: location.last_seen_at,
          created_at: location.created_at,
          updated_at: location.updated_at,
        });

        if (error) {
          errors.push(`Location ${location.name}: ${error.message}`);
        } else {
          await markLocationSynced(location.id);
          count++;
        }
      } catch (e) {
        errors.push(`Location ${location.name}: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

async function uploadRecords(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const records = await getRecordsForSync(userId);
    logger.debug('sync', `📤 ${records.length} records pending`);

    for (const record of records) {
      try {
        const { error } = await supabase.from('records').upsert({
          id: record.id,
          user_id: record.user_id,
          location_id: record.location_id,
          location_name: record.location_name,
          entry_at: record.entry_at,
          exit_at: record.exit_at,
          type: record.type,
          manually_edited: record.manually_edited === 1,
          edit_reason: record.edit_reason,
          integrity_hash: record.integrity_hash,
          color: record.color,
          device_id: record.device_id,
          pause_minutes: record.pause_minutes || 0,
          created_at: record.created_at,
        });

        if (error) {
          errors.push(`Record: ${error.message}`);
        } else {
          await markRecordSynced(record.id);
          count++;
        }
      } catch (e) {
        errors.push(`Record: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

async function uploadAnalytics(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const analytics = await getAnalyticsForSync(userId);
    logger.debug('sync', `📤 ${analytics.length} analytics days pending`);

    for (const day of analytics) {
      try {
        // Parse features_used JSON
        let featuresUsed: string[] = [];
        try {
          featuresUsed = JSON.parse(day.features_used || '[]');
        } catch {}

        const { error } = await supabase.from('analytics_daily').upsert({
          date: day.date,
          user_id: day.user_id,
          sessions_count: day.sessions_count,
          total_minutes: day.total_minutes,
          manual_entries: day.manual_entries,
          auto_entries: day.auto_entries,
          locations_created: day.locations_created,
          locations_deleted: day.locations_deleted,
          app_opens: day.app_opens,
          app_foreground_seconds: day.app_foreground_seconds,
          notifications_shown: day.notifications_shown,
          notifications_actioned: day.notifications_actioned,
          features_used: featuresUsed,
          errors_count: day.errors_count,
          sync_attempts: day.sync_attempts,
          sync_failures: day.sync_failures,
          geofence_triggers: day.geofence_triggers,
          geofence_accuracy_avg: day.geofence_accuracy_count > 0 
            ? day.geofence_accuracy_sum / day.geofence_accuracy_count 
            : null,
          app_version: day.app_version,
          os: day.os,
          device_model: day.device_model,
        });

        if (error) {
          errors.push(`Analytics ${day.date}: ${error.message}`);
        } else {
          await markAnalyticsSynced(day.date, day.user_id);
          count++;
        }
      } catch (e) {
        errors.push(`Analytics: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

async function uploadErrors(): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const errorLogs = await getErrorsForSync(100);
    logger.debug('sync', `📤 ${errorLogs.length} errors pending`);

    const idsToMark: string[] = [];

    for (const err of errorLogs) {
      try {
        // Parse context JSON
        let context = null;
        try {
          context = err.error_context ? JSON.parse(err.error_context) : null;
        } catch {}

        const { error } = await supabase.from('error_log').insert({
          id: err.id,
          user_id: err.user_id,
          error_type: err.error_type,
          error_message: err.error_message,
          error_stack: err.error_stack,
          error_context: context,
          app_version: err.app_version,
          os: err.os,
          os_version: err.os_version,
          device_model: err.device_model,
          occurred_at: err.occurred_at,
        });

        if (error) {
          errors.push(`Error log: ${error.message}`);
        } else {
          idsToMark.push(err.id);
          count++;
        }
      } catch (e) {
        errors.push(`Error log: ${e}`);
      }
    }

    if (idsToMark.length > 0) {
      await markErrorsSynced(idsToMark);
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

async function uploadAudit(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const audits = await getAuditForSync(userId, 100);
    logger.debug('sync', `📤 ${audits.length} audits pending`);

    const idsToMark: string[] = [];

    for (const audit of audits) {
      try {
        const { error } = await supabase.from('location_audit').insert({
          id: audit.id,
          user_id: audit.user_id,
          session_id: audit.session_id,
          event_type: audit.event_type,
          location_id: audit.location_id,
          location_name: audit.location_name,
          latitude: audit.latitude,
          longitude: audit.longitude,
          accuracy: audit.accuracy,
          occurred_at: audit.occurred_at,
        });

        if (error) {
          errors.push(`Audit: ${error.message}`);
        } else {
          idsToMark.push(audit.id);
          count++;
        }
      } catch (e) {
        errors.push(`Audit: ${e}`);
      }
    }

    if (idsToMark.length > 0) {
      await markAuditSynced(idsToMark);
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

// ============================================
// DOWNLOAD FUNCTIONS
// ============================================

async function downloadLocations(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      errors.push(error.message);
      return { count, errors };
    }

    logger.debug('sync', `📥 ${data?.length || 0} locations from Supabase`);

    for (const remote of data || []) {
      try {
        await upsertLocationFromSync({
          ...remote,
          synced_at: new Date().toISOString(),
        });
        count++;
      } catch (e) {
        errors.push(`Location ${remote.name}: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

async function downloadRecords(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const { data, error } = await supabase
      .from('records')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      errors.push(error.message);
      return { count, errors };
    }

    logger.debug('sync', `📥 ${data?.length || 0} records from Supabase`);

    for (const remote of data || []) {
      try {
        await upsertRecordFromSync({
          ...remote,
          manually_edited: remote.manually_edited ? 1 : 0,
          synced_at: new Date().toISOString(),
        });
        count++;
      } catch (e) {
        errors.push(`Record: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}
