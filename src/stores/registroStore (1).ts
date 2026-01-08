/**
 * Record Store - OnSite Timekeeper
 * 
 * Manages work session persistence:
 * - Entry/Exit in SQLite
 * - Daily statistics
 * - Session history
 * - Delete and edit records
 */

import { create } from 'zustand';
import { Share } from 'react-native';
import { logger } from '../lib/logger';
import {
  db,
  initDatabase,
  criarRegistroEntrada,
  registrarSaida as dbRegistrarSaida,
  getSessaoAtivaGlobal,
  getSessoesHoje,
  getSessoesPorPeriodo,
  getEstatisticasHoje,
  formatarDuracao,
  type SessaoComputada,
  type EstatisticasDia,
} from '../lib/database';
import { gerarRelatorioSessao, gerarRelatorioCompleto } from '../lib/reports';
import { useAuthStore } from './authStore';
import type { Coordenadas } from '../lib/location';

// ============================================
// TYPES
// ============================================

interface RecordState {
  isInitialized: boolean;
  
  // Current session (if one is open)
  currentSession: SessaoComputada | null;
  
  // Today's sessions
  todaySessions: SessaoComputada[];
  
  // Statistics
  todayStats: EstatisticasDia;
  
  // Last finished session (to show report)
  lastFinishedSession: SessaoComputada | null;

  // Legacy accessors (for compatibility)
  isInicializado: boolean;
  sessaoAtual: SessaoComputada | null;
  sessoesHoje: SessaoComputada[];
  estatisticasHoje: EstatisticasDia;
  ultimaSessaoFinalizada: SessaoComputada | null;

  // Actions
  initialize: () => Promise<void>;
  
  // Records
  registerEntry: (
    locationId: string,
    locationName: string,
    coords?: Coordenadas & { accuracy?: number }
  ) => Promise<string>;
  
  registerExit: (
    locationId: string,
    coords?: Coordenadas & { accuracy?: number }
  ) => Promise<void>;
  
  registerExitWithAdjustment: (
    locationId: string,
    coords?: Coordenadas & { accuracy?: number },
    adjustmentMinutes?: number
  ) => Promise<void>;
  
  // Refresh
  reloadData: () => Promise<void>;
  
  // Reports
  shareLastSession: () => Promise<void>;
  shareReport: (startDate: string, endDate: string) => Promise<void>;
  clearLastSession: () => void;
  
  // Helpers
  getSessionsByPeriod: (startDate: string, endDate: string) => Promise<SessaoComputada[]>;
  
  // CRUD
  deleteRecord: (id: string) => Promise<void>;
  editRecord: (id: string, updates: {
    entrada?: string;
    saida?: string;
    editado_manualmente?: number;
    motivo_edicao?: string;
    pausa_minutos?: number;
  }) => Promise<void>;
  
  // Manual entry
  createManualRecord: (params: {
    locationId: string;
    locationName: string;
    entry: string;
    exit: string;
    pauseMinutes?: number;
  }) => Promise<string>;

  // Legacy methods (for compatibility)
  registrarEntrada: (
    localId: string,
    localNome: string,
    coords?: Coordenadas & { accuracy?: number }
  ) => Promise<string>;
  registrarSaida: (
    localId: string,
    coords?: Coordenadas & { accuracy?: number }
  ) => Promise<void>;
  registrarSaidaComAjuste: (
    localId: string,
    coords?: Coordenadas & { accuracy?: number },
    ajusteMinutos?: number
  ) => Promise<void>;
  recarregarDados: () => Promise<void>;
  compartilharUltimaSessao: () => Promise<void>;
  compartilharRelatorio: (dataInicio: string, dataFim: string) => Promise<void>;
  limparUltimaSessao: () => void;
  getSessoesPeriodo: (dataInicio: string, dataFim: string) => Promise<SessaoComputada[]>;
  deletarRegistro: (id: string) => Promise<void>;
  editarRegistro: (id: string, updates: {
    entrada?: string;
    saida?: string;
    editado_manualmente?: number;
    motivo_edicao?: string;
    pausa_minutos?: number;
  }) => Promise<void>;
  criarRegistroManual: (params: {
    localId: string;
    localNome: string;
    entrada: string;
    saida: string;
    pausaMinutos?: number;
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

export const useRegistroStore = create<RecordState>((set, get) => ({
  isInitialized: false,
  currentSession: null,
  todaySessions: [],
  todayStats: { total_minutos: 0, total_sessoes: 0 },
  lastFinishedSession: null,

  // Legacy property aliases
  get isInicializado() { return get().isInitialized; },
  get sessaoAtual() { return get().currentSession; },
  get sessoesHoje() { return get().todaySessions; },
  get estatisticasHoje() { return get().todayStats; },
  get ultimaSessaoFinalizada() { return get().lastFinishedSession; },

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

      const recordId = await criarRegistroEntrada({
        userId,
        localId: locationId,
        localNome: locationName,
        tipo: 'automatico',
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

      await dbRegistrarSaida(userId, locationId);

      await get().reloadData();

      // Store last finished session for report
      const { todaySessions } = get();
      const finishedSession = todaySessions.find(
        s => s.local_id === locationId && s.status === 'finalizada'
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

      logger.info('session', `📤 EXIT (adjustment: ${adjustmentMinutes}min)`, { locationId });

      await dbRegistrarSaida(userId, locationId, adjustmentMinutes);

      await get().reloadData();

      // Store last finished session
      const { todaySessions } = get();
      const finishedSession = todaySessions.find(
        s => s.local_id === locationId && s.status === 'finalizada'
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
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      set({
        currentSession: null,
        todaySessions: [],
        todayStats: { total_minutos: 0, total_sessoes: 0 },
      });
      return;
    }

    try {
      const dbOk = await ensureDbInitialized();
      if (!dbOk) return;

      const [currentSession, todaySessions, todayStats] = await Promise.all([
        getSessaoAtivaGlobal(userId),
        getSessoesHoje(userId),
        getEstatisticasHoje(userId),
      ]);

      set({ currentSession, todaySessions, todayStats });

      logger.debug('database', 'Data reloaded', {
        activeSession: currentSession?.local_nome ?? 'none',
        sessions: todaySessions.length,
        minutes: todayStats.total_minutos,
      });
    } catch (error) {
      logger.error('database', 'Error reloading data', { error: String(error) });
    }
  },

  shareLastSession: async () => {
    const { lastFinishedSession } = get();
    if (!lastFinishedSession) {
      logger.warn('database', 'No session to share');
      return;
    }

    try {
      const userName = useAuthStore.getState().getUserName();
      const report = gerarRelatorioSessao(lastFinishedSession, userName ?? undefined);
      
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
      const sessions = await getSessoesPorPeriodo(userId, startDate, endDate);
      const userName = useAuthStore.getState().getUserName();
      const report = gerarRelatorioCompleto(sessions, userName ?? undefined);

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
      return await getSessoesPorPeriodo(userId, startDate, endDate);
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
      const record = db.getFirstSync<{ id: string; saida: string | null }>(
        `SELECT id, saida FROM registros WHERE id = ? AND user_id = ?`,
        [id, userId]
      );

      if (!record) {
        throw new Error('Record not found');
      }

      // Don't allow deleting active session
      if (!record.saida) {
        throw new Error('Cannot delete an ongoing session');
      }

      // Delete from local SQLite
      db.runSync(`DELETE FROM registros WHERE id = ? AND user_id = ?`, [id, userId]);
      logger.info('record', `🗑️ Record deleted locally: ${id}`);

      // Try to delete from Supabase too
      try {
        const { supabase } = await import('../lib/supabase');
        const { error } = await supabase
          .from('registros')
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
        `SELECT id FROM registros WHERE id = ? AND user_id = ?`,
        [id, userId]
      );

      if (!record) {
        throw new Error('Record not found');
      }

      // Build update query
      const setClauses: string[] = [];
      const values: any[] = [];

      if (updates.entrada) {
        setClauses.push('entrada = ?');
        values.push(updates.entrada);
      }
      if (updates.saida) {
        setClauses.push('saida = ?');
        values.push(updates.saida);
      }
      if (updates.editado_manualmente !== undefined) {
        setClauses.push('editado_manualmente = ?');
        values.push(updates.editado_manualmente);
      }
      if (updates.motivo_edicao) {
        setClauses.push('motivo_edicao = ?');
        values.push(updates.motivo_edicao);
      }
      if (updates.pausa_minutos !== undefined) {
        setClauses.push('pausa_minutos = ?');
        values.push(updates.pausa_minutos);
      }

      // Mark as not synced (will be re-sent to Supabase)
      setClauses.push('synced_at = NULL');

      if (setClauses.length === 1) { // only has synced_at
        throw new Error('No fields to update');
      }

      values.push(id, userId);

      db.runSync(
        `UPDATE registros SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`,
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
  createManualRecord: async ({ locationId, locationName, entry, exit, pauseMinutes }) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    try {
      const dbOk = await ensureDbInitialized();
      if (!dbOk) throw new Error('Database not available');

      // Generate unique ID
      const id = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Insert complete record (with entry and exit)
      db.runSync(
        `INSERT INTO registros (
          id, user_id, local_id, local_nome, entrada, saida, 
          tipo, editado_manualmente, motivo_edicao, pausa_minutos, synced_at
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
          'Manual entry by user',
          pauseMinutes || 0,
        ]
      );

      logger.info('record', `✏️ Manual record created: ${id}`, { locationName, entry, exit, pauseMinutes });

      // Reload data
      await get().reloadData();

      return id;
    } catch (error) {
      logger.error('record', 'Error creating manual record', { error: String(error) });
      throw error;
    }
  },

  // ============================================
  // LEGACY METHOD ALIASES (for compatibility)
  // ============================================
  registrarEntrada: async (localId, localNome, coords) => 
    get().registerEntry(localId, localNome, coords),
  
  registrarSaida: async (localId, coords) => 
    get().registerExit(localId, coords),
  
  registrarSaidaComAjuste: async (localId, coords, ajusteMinutos) => 
    get().registerExitWithAdjustment(localId, coords, ajusteMinutos),
  
  recarregarDados: async () => 
    get().reloadData(),
  
  compartilharUltimaSessao: async () => 
    get().shareLastSession(),
  
  compartilharRelatorio: async (dataInicio, dataFim) => 
    get().shareReport(dataInicio, dataFim),
  
  limparUltimaSessao: () => 
    get().clearLastSession(),
  
  getSessoesPeriodo: async (dataInicio, dataFim) => 
    get().getSessionsByPeriod(dataInicio, dataFim),
  
  deletarRegistro: async (id) => 
    get().deleteRecord(id),
  
  editarRegistro: async (id, updates) => 
    get().editRecord(id, updates),
  
  criarRegistroManual: async (params) => 
    get().createManualRecord({
      locationId: params.localId,
      locationName: params.localNome,
      entry: params.entrada,
      exit: params.saida,
      pauseMinutes: params.pausaMinutos,
    }),
}));

// ============================================
// HELPER HOOK
// ============================================

export function useFormatDuration(minutes: number | null | undefined): string {
  return formatarDuracao(minutes);
}

// Legacy export
export const useFormatarDuracao = useFormatDuration;
