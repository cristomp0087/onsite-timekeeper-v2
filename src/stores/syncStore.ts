/**
 * Sync Store - OnSite Timekeeper
 * 
 * Handles synchronization between local SQLite and Supabase:
 * - Business data sync (locations, records)
 * - Telemetry sync (aggregated usage data)
 * - Cleanup of old data
 * 
 * REFACTORED: All PT names removed, English only
 */

import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '../lib/logger';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  getLocationsForSync,
  getRecordsForSync,
  markLocationSynced,
  markRecordSynced,
  upsertLocationFromSync,
  upsertRecordFromSync,
  // Telemetry
  getTelemetryForSync,
  markTelemetrySynced,
  cleanOldTelemetry,
  incrementTelemetry,
  getTelemetryStats,
  cleanOldHeartbeats,
  cleanOldGeopoints,
} from '../lib/database';
import { useAuthStore } from './authStore';
import { useLocationStore } from './locationStore';

// ============================================
// CONSTANTS
// ============================================

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes - business data
const TELEMETRY_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour - telemetry
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours - cleanup

// ============================================
// TYPES
// ============================================

interface SyncStats {
  uploadedLocations: number;
  uploadedRecords: number;
  downloadedLocations: number;
  downloadedRecords: number;
  uploadedTelemetry: number;
  errors: string[];
}

interface SyncState {
  isSyncing: boolean;
  lastSyncAt: Date | null;
  lastTelemetrySyncAt: Date | null;
  isOnline: boolean;
  autoSyncEnabled: boolean;
  lastSyncStats: SyncStats | null;

  initialize: () => Promise<() => void>;
  syncNow: () => Promise<void>;
  syncTelemetry: () => Promise<void>;
  forceFullSync: () => Promise<void>;
  debugSync: () => Promise<{ success: boolean; error?: string; stats?: any }>;
  toggleAutoSync: () => void;
  syncLocations: () => Promise<void>;
  syncRecords: () => Promise<void>;
  reconcileOnBoot: () => Promise<void>;
  runCleanup: () => Promise<void>;
}

// ============================================
// TIMERS
// ============================================

let syncInterval: ReturnType<typeof setInterval> | null = null;
let telemetrySyncInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let netInfoUnsubscribe: (() => void) | null = null;

// ============================================
// STORE
// ============================================

export const useSyncStore = create<SyncState>((set, get) => ({
  isSyncing: false,
  lastSyncAt: null,
  lastTelemetrySyncAt: null,
  isOnline: true,
  autoSyncEnabled: true,
  lastSyncStats: null,

  initialize: async () => {
    logger.info('boot', '🔄 Initializing sync store...');

    // Connectivity listener
    netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected;
      
      logger.info('sync', `📶 NetInfo: connected=${state.isConnected}, online=${online}`);
      set({ isOnline: online });

      // If came online and auto-sync is active, sync
      if (online && get().autoSyncEnabled && !get().isSyncing) {
        get().syncNow();
      }
    });

    // Initial check
    const state = await NetInfo.fetch();
    const online = !!state.isConnected;
    
    logger.info('sync', `📶 Initial connection: connected=${state.isConnected}, online=${online}`);
    set({ isOnline: online });

    // ============================================
    // INTERVAL: Business data (5 min)
    // ============================================
    syncInterval = setInterval(() => {
      const { isOnline, autoSyncEnabled, isSyncing } = get();
      if (isOnline && autoSyncEnabled && !isSyncing) {
        logger.debug('sync', '⏰ Auto-sync triggered');
        get().syncNow();
      }
    }, SYNC_INTERVAL);

    // ============================================
    // INTERVAL: Telemetry (1 hour)
    // ============================================
    telemetrySyncInterval = setInterval(() => {
      const { isOnline, autoSyncEnabled } = get();
      if (isOnline && autoSyncEnabled) {
        logger.debug('sync', '⏰ Telemetry sync triggered');
        get().syncTelemetry();
      }
    }, TELEMETRY_SYNC_INTERVAL);

    // ============================================
    // INTERVAL: Cleanup (24 hours)
    // ============================================
    cleanupInterval = setInterval(() => {
      get().runCleanup();
    }, CLEANUP_INTERVAL);

    // Initial sync
    if (isSupabaseConfigured()) {
      logger.info('sync', '🚀 Starting boot sync...');
      try {
        await get().syncNow();
        // Also sync telemetry on boot
        await get().syncTelemetry();
      } catch (error) {
        logger.error('sync', 'Boot sync error', { error: String(error) });
      }
    }

    logger.info('boot', '✅ Sync store initialized', { online });

    // Return cleanup function
    return () => {
      if (netInfoUnsubscribe) netInfoUnsubscribe();
      if (syncInterval) clearInterval(syncInterval);
      if (telemetrySyncInterval) clearInterval(telemetrySyncInterval);
      if (cleanupInterval) clearInterval(cleanupInterval);
    };
  },

  // ============================================
  // BUSINESS DATA SYNC (immediate)
  // ============================================
  syncNow: async () => {
    const { isSyncing } = get();
    
    if (isSyncing) {
      logger.warn('sync', 'Sync already in progress');
      return;
    }

    if (!isSupabaseConfigured()) {
      logger.warn('sync', '⚠️ Supabase not configured');
      return;
    }

    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      logger.warn('sync', '⚠️ User not authenticated');
      return;
    }

    set({ isSyncing: true, lastSyncStats: null });

    const stats: SyncStats = {
      uploadedLocations: 0,
      uploadedRecords: 0,
      downloadedLocations: 0,
      downloadedRecords: 0,
      uploadedTelemetry: 0,
      errors: [],
    };

    try {
      logger.info('sync', '🔄 Starting business sync...');

      // Increment sync attempt in telemetry
      await incrementTelemetry(userId, 'sync_attempts');

      // 1. Upload locations
      const locationsUp = await uploadLocations(userId);
      stats.uploadedLocations = locationsUp.count;
      stats.errors.push(...locationsUp.errors);

      // 2. Upload records
      const recordsUp = await uploadRecords(userId);
      stats.uploadedRecords = recordsUp.count;
      stats.errors.push(...recordsUp.errors);

      // 3. Download locations
      const locationsDown = await downloadLocations(userId);
      stats.downloadedLocations = locationsDown.count;
      stats.errors.push(...locationsDown.errors);

      // 4. Download records
      const recordsDown = await downloadRecords(userId);
      stats.downloadedRecords = recordsDown.count;
      stats.errors.push(...recordsDown.errors);

      // If there were errors, increment failures in telemetry
      if (stats.errors.length > 0) {
        await incrementTelemetry(userId, 'sync_failures');
      }

      set({ 
        lastSyncAt: new Date(),
        lastSyncStats: stats,
        isOnline: true,
      });

      logger.info('sync', '✅ Business sync completed', {
        up: `${stats.uploadedLocations}L/${stats.uploadedRecords}R`,
        down: `${stats.downloadedLocations}L/${stats.downloadedRecords}R`,
        errors: stats.errors.length,
      });

      // Reload locations
      await useLocationStore.getState().reloadLocations();

    } catch (error) {
      logger.error('sync', '❌ Sync error', { error: String(error) });
      stats.errors.push(String(error));
      set({ lastSyncStats: stats });
    } finally {
      set({ isSyncing: false });
    }
  },

  // ============================================
  // TELEMETRY SYNC (aggregated data)
  // ============================================
  syncTelemetry: async () => {
    if (!isSupabaseConfigured()) return;

    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;

    try {
      logger.info('sync', '📊 Starting telemetry sync...');

      // Get telemetry data that is not from today and not yet synced
      const telemetryData = await getTelemetryForSync(userId);
      
      if (telemetryData.length === 0) {
        logger.debug('sync', 'No telemetry to sync');
        set({ lastTelemetrySyncAt: new Date() });
        return;
      }

      let uploaded = 0;

      for (const item of telemetryData) {
        try {
          // Upsert to Supabase
          // Map local TelemetryDailyDB fields to Supabase table fields
          const { error } = await supabase.from('telemetry').upsert({
            user_id: item.user_id,
            date: item.date,
            app_opens: item.app_opens,
            geofence_entries: item.geofence_entries_count,
            geofence_exits: item.geofence_triggers, // Use triggers as proxy for exits
            manual_entries: item.manual_entries_count,
            heartbeat_checks: item.heartbeat_count,
            sync_attempts: item.sync_attempts,
            sync_failures: item.sync_failures,
            gps_samples: item.background_location_checks, // Use location checks as proxy
            background_wakeups: item.background_location_checks,
            updated_at: new Date().toISOString(),
          });

          if (error) {
            logger.warn('sync', 'Telemetry upload failed', { error: error.message, date: item.date });
          } else {
            // markTelemetrySynced expects (date, userId)
            await markTelemetrySynced(item.date, item.user_id);
            uploaded++;
          }
        } catch (e) {
          logger.warn('sync', 'Telemetry item error', { error: String(e) });
        }
      }

      set({ lastTelemetrySyncAt: new Date() });
      logger.info('sync', `✅ Telemetry sync: ${uploaded}/${telemetryData.length} uploaded`);

    } catch (error) {
      logger.error('sync', '❌ Telemetry sync error', { error: String(error) });
    }
  },

  // ============================================
  // CLEANUP (old data)
  // ============================================
  runCleanup: async () => {
    try {
      logger.info('sync', '🧹 Running cleanup...');

      // Clean old local telemetry (already synced, > 7 days)
      const telemetryCleaned = await cleanOldTelemetry(7);

      // Clean old heartbeats (> 30 days)
      const heartbeatsCleaned = await cleanOldHeartbeats(30);

      // Clean old geopoints (> 90 days)
      const geopointsCleaned = await cleanOldGeopoints(90);

      logger.info('sync', '✅ Cleanup completed', {
        telemetry: telemetryCleaned,
        heartbeats: heartbeatsCleaned,
        geopoints: geopointsCleaned,
      });
    } catch (error) {
      logger.error('sync', '❌ Cleanup error', { error: String(error) });
    }
  },

  forceFullSync: async () => {
    logger.info('sync', '🔄 Forcing full sync...');
    set({ isSyncing: false, isOnline: true });
    await get().syncNow();
    await get().syncTelemetry();
  },

  debugSync: async () => {
    const netState = await NetInfo.fetch();
    const userId = useAuthStore.getState().getUserId();
    
    // Include telemetry stats
    const telemetryStats = userId ? await getTelemetryStats(userId) : null;
    
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
          lastSyncAt: get().lastSyncAt?.toISOString() || null,
          lastTelemetrySyncAt: get().lastTelemetrySyncAt?.toISOString() || null,
        },
        supabase: {
          isConfigured: isSupabaseConfigured(),
        },
        auth: {
          userId: userId || 'NOT AUTHENTICATED',
        },
        telemetry: telemetryStats,
      },
    };
  },

  toggleAutoSync: () => {
    const newValue = !get().autoSyncEnabled;
    set({ autoSyncEnabled: newValue });
    logger.info('sync', `Auto-sync ${newValue ? 'enabled' : 'disabled'}`);
  },

  syncLocations: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    await uploadLocations(userId);
    await downloadLocations(userId);
    await useLocationStore.getState().reloadLocations();
  },

  syncRecords: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    await uploadRecords(userId);
    await downloadRecords(userId);
  },

  reconcileOnBoot: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    await downloadLocations(userId);
    await downloadRecords(userId);
    await useLocationStore.getState().reloadLocations();
  },
}));

// ============================================
// UPLOAD/DOWNLOAD FUNCTIONS
// ============================================

async function uploadLocations(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const locations = await getLocationsForSync(userId);
    logger.info('sync', `📤 ${locations.length} locations pending`);

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
          errors.push(`${location.name}: ${error.message}`);
          logger.error('sync', `❌ Location upload failed: ${location.name}`, { error: error.message });
        } else {
          await markLocationSynced(location.id);
          count++;
          logger.info('sync', `✅ Location uploaded: ${location.name}`);
        }
      } catch (e) {
        errors.push(`${location.name}: ${e}`);
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
    logger.info('sync', `📤 ${records.length} records pending`);

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
          logger.error('sync', `❌ Record upload failed`, { error: error.message });
        } else {
          await markRecordSynced(record.id);
          count++;
          logger.info('sync', `✅ Record uploaded: ${record.id}`);
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

    logger.info('sync', `📥 ${data?.length || 0} locations from Supabase`);

    for (const remote of data || []) {
      try {
        await upsertLocationFromSync({
          ...remote,
          synced_at: new Date().toISOString(),
        });
        count++;
      } catch (e) {
        errors.push(`${remote.name}: ${e}`);
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

    logger.info('sync', `📥 ${data?.length || 0} records from Supabase`);

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
