/**
 * Record Store - OnSite Timekeeper
 * 
 * Manages work session persistence:
 * - Entry/Exit in SQLite
 * - Daily statistics
 * - Session history
 * - Delete and edit records
 * 
 * REFACTORED: Renamed from registroStore.ts, all PT names removed
 */

import { create } from 'zustand';
import { Share } from 'react-native';
import { logger } from '../lib/logger';
import {
  db,
  initDatabase,
  createEntryRecord,
  registerExit as dbRegisterExit,
  getGlobalActiveSession,
  getTodaySessions,
  getSessionsByPeriod,
  getTodayStats,
  formatDuration,
  type ComputedSession,
  type DayStats,
} from '../lib/database';
import { generateSessionReport, generateCompleteReport } from '../lib/reports';
import { useAuthStore } from './authStore';
import type { Coordinates } from '../lib/location';

// ============================================
// TYPES
// ============================================

interface RecordState {
  isInitialized: boolean;
  
  // Current session (if one is open)
  currentSession: ComputedSession | null;
  
  // Today's sessions
  todaySessions: ComputedSession[];
  
  // Statistics
  todayStats: DayStats;
  
  // Last finished session (to show report)
  lastFinishedSession: ComputedSession | null;

  // Actions
  initialize: () => Promise<void>;
  
  // Records
  registerEntry: (
    locationId: string,
    locationName: string,
    coords?: Coordinates & { accuracy?: number }
  ) => Promise<string>;
  
  registerExit: (
    locationId: string,
    coords?: Coordinates & { accuracy?: number }
  ) => Promise<void>;
  
  registerExitWithAdjustment: (
    locationId: string,
    coords?: Coordinates & { accuracy?: number },
    adjustmentMinutes?: number
  ) => Promise<void>;
  
  // Refresh
  reloadData: () => Promise<void>;
  
  // Reports
  shareLastSession: () => Promise<void>;
  shareReport: (startDate: string, endDate: string) => Promise<void>;
  clearLastSession: () => void;
  
  // Helpers
  getSessionsByPeriod: (startDate: string, endDate: string) => Promise<ComputedSession[]>;
  
  // CRUD
  deleteRecord: (id: string) => Promise<void>;
  editRecord: (id: string, updates: {
    entry_at?: string;
    exit_at?: string;
    manually_edited?: number;
    edit_reason?: string;
    pause_minutes?: number;
  }) => Promise<void>;
  
  // Manual entry
  createManualRecord: (params: {
    locationId: string;
    locationName: string;
    entry: string;
    exit: string;
    pauseMinutes?: number;
    absenceType?: string; // 'rain' | 'snow' | 'sick' | 'day_off' | 'holiday'
  }) => Promise<string>;
}

// ============================================
// DB INITIALIZATION CONTROL
// ============================================

let dbInitialized = false;
let dbInitializing = false;

async function ensureDbInitialized(): Promise<boolean> {
  if (dbInitialized) return true;

  if (dbInitializing) {
    // Wait for ongoing initialization
    let attempts = 0;
    while (dbInitializing && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    return dbInitialized;
  }

  dbInitializing = true;
  try {
    await initDatabase();
    dbInitialized = true;
    return true;
  } catch (error) {
    logger.error('database', 'Failed to initialize database', { error: String(error) });
    return false;
  } finally {
    dbInitializing = false;
  }
}

// ============================================
// STORE
// ============================================

export const useRecordStore = create<RecordState>((set, get) => ({
  isInitialized: false,
  currentSession: null,
  todaySessions: [],
  todayStats: { total_minutes: 0, total_sessions: 0 },
  lastFinishedSession: null,

  initialize: async () => {
    if (get().isInitialized) return;

    try {
      logger.info('boot', '📝 Initializing record store...');

      const dbOk = await ensureDbInitialized();
      if (!dbOk) {
        logger.error('database', 'Could not initialize database');
        set({ isInitialized: true });
        return;
      }

      await get().reloadData();

      set({ isInitialized: true });
      logger.info('boot', '✅ Record store initialized');
    } catch (error) {
      logger.error('database', 'Error initializing record store', { error: String(error) });
      set({ isInitialized: true });
    }
  },

  registerEntry: async (locationId, locationName, _coords) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    try {
      const dbOk = await ensureDbInitialized();
      if (!dbOk) throw new Error('Database not available');

      logger.info('session', `📥 ENTRY: ${locationName}`, { locationId });

      const recordId = await createEntryRecord({
        userId,
        locationId,
        locationName,
        type: 'automatic',
      });

      await get().reloadData();

      return recordId;
    } catch (error) {
      logger.error('database', 'Error registering entry', { error: String(error) });
      throw error;
    }
  },

  registerExit: async (locationId, _coords) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    try {
      const dbOk = await ensureDbInitialized();
      if (!dbOk) throw new Error('Database not available');

      logger.info('session', `📤 EXIT`, { locationId });

      await dbRegisterExit(userId, locationId);

      await get().reloadData();

      // Store last finished session for report
      const { todaySessions } = get();
      const finishedSession = todaySessions.find(
        s => s.location_id === locationId && s.status === 'finished'
      );
      if (finishedSession) {
        set({ lastFinishedSession: finishedSession });
      }
    } catch (error) {
      logger.error('database', 'Error registering exit', { error: String(error) });
      throw error;
    }
  },

  registerExitWithAdjustment: async (locationId, _coords, adjustmentMinutes = 0) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    try {
      const dbOk = await ensureDbInitialized();
      if (!dbOk) throw new Error('Database not available');

      logger.info('session', `📤 EXIT (adjusted ${adjustmentMinutes} min)`, { locationId });

      // Get active session for this location
      const activeSession = await getGlobalActiveSession(userId);
      
      if (!activeSession || activeSession.location_id !== locationId) {
        throw new Error('No active session at this location');
      }

      // Calculate adjusted exit time
      const now = new Date();
      now.setMinutes(now.getMinutes() + adjustmentMinutes);
      const adjustedExit = now.toISOString();

      // Update record directly
      db.runSync(
        `UPDATE records SET 
          exit_at = ?, 
          manually_edited = 1, 
          edit_reason = ?,
          synced_at = NULL
        WHERE id = ? AND user_id = ?`,
        [adjustedExit, `Exit adjusted by ${adjustmentMinutes} minutes`, activeSession.id, userId]
      );

      await get().reloadData();

      // Store last finished session for report
      const { todaySessions } = get();
      const finishedSession = todaySessions.find(
        s => s.location_id === locationId && s.status === 'finished'
      );
      if (finishedSession) {
        set({ lastFinishedSession: finishedSession });
      }
    } catch (error) {
      logger.error('database', 'Error registering exit with adjustment', { error: String(error) });
      throw error;
    }
  },

  reloadData: async () => {
    try {
      const userId = useAuthStore.getState().getUserId();
      if (!userId) {
        set({
          currentSession: null,
          todaySessions: [],
          todayStats: { total_minutes: 0, total_sessions: 0 },
        });
        return;
      }

      const dbOk = await ensureDbInitialized();
      if (!dbOk) return;

      const [activeSession, sessions, stats] = await Promise.all([
        getGlobalActiveSession(userId),
        getTodaySessions(userId),
        getTodayStats(userId),
      ]);

      set({
        currentSession: activeSession,
        todaySessions: sessions,
        todayStats: stats,
      });

      logger.debug('database', 'Data reloaded', {
        hasActiveSession: !!activeSession,
        sessionsCount: sessions.length,
        totalMinutes: stats.total_minutes,
      });
    } catch (error) {
      logger.error('database', 'Error reloading data', { error: String(error) });
    }
  },

  shareLastSession: async () => {
    const { lastFinishedSession } = get();
    if (!lastFinishedSession) return;

    try {
      const userName = useAuthStore.getState().getUserName();
      const report = generateSessionReport(lastFinishedSession, userName ?? undefined);
      
      await Share.share({
        message: report,
        title: 'Work Record',
      });

      logger.info('database', 'Report shared');
    } catch (error) {
      logger.error('database', 'Error sharing', { error: String(error) });
    }
  },

  shareReport: async (startDate, endDate) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;

    try {
      const sessions = await getSessionsByPeriod(userId, startDate, endDate);
      const userName = useAuthStore.getState().getUserName();
      const report = generateCompleteReport(sessions, userName ?? undefined);

      await Share.share({
        message: report,
        title: 'Hours Report',
      });

      logger.info('database', 'Complete report shared');
    } catch (error) {
      logger.error('database', 'Error sharing report', { error: String(error) });
    }
  },

  clearLastSession: () => {
    set({ lastFinishedSession: null });
  },

  getSessionsByPeriod: async (startDate, endDate) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return [];

    try {
      return await getSessionsByPeriod(userId, startDate, endDate);
    } catch (error) {
      logger.error('database', 'Error fetching sessions by period', { error: String(error) });
      return [];
    }
  },

  // ============================================
  // DELETE RECORD
  // ============================================
  deleteRecord: async (id) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    try {
      const dbOk = await ensureDbInitialized();
      if (!dbOk) throw new Error('Database not available');

      // Check if record exists and belongs to user
      const record = db.getFirstSync<{ id: string; exit_at: string | null }>(
        `SELECT id, exit_at FROM records WHERE id = ? AND user_id = ?`,
        [id, userId]
      );

      if (!record) {
        throw new Error('Record not found');
      }

      // Don't allow deleting active session
      if (!record.exit_at) {
        throw new Error('Cannot delete an ongoing session');
      }

      // Delete from local SQLite
      db.runSync(`DELETE FROM records WHERE id = ? AND user_id = ?`, [id, userId]);
      logger.info('record', `🗑️ Record deleted locally: ${id}`);

      // Try to delete from Supabase too
      try {
        const { supabase } = await import('../lib/supabase');
        const { error } = await supabase
          .from('records')
          .delete()
          .eq('id', id)
          .eq('user_id', userId);

        if (error) {
          logger.warn('record', 'Error deleting from Supabase', { error: error.message });
        } else {
          logger.info('record', `🗑️ Record deleted from Supabase: ${id}`);
        }
      } catch (supabaseError) {
        logger.warn('record', 'Supabase unavailable for delete', { error: String(supabaseError) });
      }

      // Reload data
      await get().reloadData();
    } catch (error) {
      logger.error('record', 'Error deleting record', { error: String(error) });
      throw error;
    }
  },

  // ============================================
  // EDIT RECORD
  // ============================================
  editRecord: async (id, updates) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    try {
      const dbOk = await ensureDbInitialized();
      if (!dbOk) throw new Error('Database not available');

      // Check if record exists and belongs to user
      const record = db.getFirstSync<{ id: string }>(
        `SELECT id FROM records WHERE id = ? AND user_id = ?`,
        [id, userId]
      );

      if (!record) {
        throw new Error('Record not found');
      }

      // Build update query
      const setClauses: string[] = [];
      const values: any[] = [];

      if (updates.entry_at) {
        setClauses.push('entry_at = ?');
        values.push(updates.entry_at);
      }
      if (updates.exit_at) {
        setClauses.push('exit_at = ?');
        values.push(updates.exit_at);
      }
      if (updates.manually_edited !== undefined) {
        setClauses.push('manually_edited = ?');
        values.push(updates.manually_edited);
      }
      if (updates.edit_reason) {
        setClauses.push('edit_reason = ?');
        values.push(updates.edit_reason);
      }
      if (updates.pause_minutes !== undefined) {
        setClauses.push('pause_minutes = ?');
        values.push(updates.pause_minutes);
      }

      // Mark as not synced (will be re-sent to Supabase)
      setClauses.push('synced_at = NULL');

      if (setClauses.length === 1) { // only has synced_at
        throw new Error('No fields to update');
      }

      values.push(id, userId);

      db.runSync(
        `UPDATE records SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`,
        values
      );

      logger.info('record', `✏️ Record edited: ${id}`, { updates });

      // Reload data
      await get().reloadData();
    } catch (error) {
      logger.error('record', 'Error editing record', { error: String(error) });
      throw error;
    }
  },

  // ============================================
  // CREATE MANUAL RECORD
  // ============================================
  createManualRecord: async ({ locationId, locationName, entry, exit, pauseMinutes, absenceType }) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    try {
      const dbOk = await ensureDbInitialized();
      if (!dbOk) throw new Error('Database not available');

      // Generate unique ID
      const { generateUUID } = await import('../lib/database');
const id = generateUUID();

      // Determine edit_reason based on absence type
      let editReason = 'Manual entry by user';
      if (absenceType) {
        const absenceLabels: Record<string, string> = {
          rain: 'Rain Day',
          snow: 'Snow Day',
          sick: 'Sick Day',
          day_off: 'Day Off',
          holiday: 'Holiday',
        };
        editReason = `Absence: ${absenceLabels[absenceType] || absenceType}`;
      }

      // Insert complete record (with entry and exit)
      const result = db.runSync(
        `INSERT INTO records (
          id, user_id, location_id, location_name, entry_at, exit_at, 
          type, manually_edited, edit_reason, pause_minutes, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          id,
          userId,
          locationId,
          locationName,
          entry,
          exit,
          'manual',
          1,
          editReason,
          pauseMinutes || 0,
        ]
      );

      // Verify INSERT succeeded
      if (result.changes === 0) {
        logger.error('record', '❌ Manual record INSERT failed - no rows affected', { id, locationName });
        throw new Error('Failed to insert record');
      }

      logger.info('record', `✏️ Manual record created: ${id}`, { locationName, entry, exit, pauseMinutes, absenceType });

      // Reload data
      await get().reloadData();

      return id;
    } catch (error) {
      logger.error('record', 'Error creating manual record', { error: String(error) });
      throw error;
    }
  },
}));

// ============================================
// HELPER HOOK
// ============================================

export function useFormatDuration(minutes: number | null | undefined): string {
  return formatDuration(minutes);
}
