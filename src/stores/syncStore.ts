/**
 * Sync Store - OnSite Timekeeper
 * 
 * MODIFICADO: 
 * - Adiciona sync de telemetria em batch
 * - Rastreia sucesso/falha do sync na telemetria
 */

import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '../lib/logger';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  getLocaisParaSync,
  getRegistrosParaSync,
  marcarLocalSincronizado,
  marcarRegistroSincronizado,
  upsertLocalFromSync,
  upsertRegistroFromSync,
  registrarSyncLog,
  getLocais,
  // NOVO: Telemetria
  getTelemetriaParaSync,
  marcarTelemetriaSincronizada,
  limparTelemetriaAntiga,
  incrementarTelemetria,
  getTelemetriaStats,
  limparHeartbeatsAntigos,
  limparGeopontosAntigos,
  type LocalDB,
  type RegistroDB,
  type TelemetryDailyDB,
} from '../lib/database';
import { useAuthStore } from './authStore';
import { useLocationStore } from './locationStore';

// ============================================
// CONSTANTES
// ============================================

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutos - dados de negócio
const TELEMETRY_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hora - telemetria (mas só sobe dias anteriores)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 horas - limpeza

// ============================================
// TIPOS
// ============================================

interface SyncStats {
  uploadedLocais: number;
  uploadedRegistros: number;
  downloadedLocais: number;
  downloadedRegistros: number;
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
  syncLocais: () => Promise<void>;
  syncRegistros: () => Promise<void>;
  reconciliarNoBoot: () => Promise<void>;
  runCleanup: () => Promise<void>;
}

// ============================================
// TIMERS
// ============================================

let syncInterval: NodeJS.Timeout | null = null;
let telemetrySyncInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;
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
    logger.info('boot', '🔄 Inicializando sync store...');

    // Listener de conectividade
    netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected;
      
      logger.info('sync', `📶 NetInfo: connected=${state.isConnected}, online=${online}`);
      set({ isOnline: online });

      // Se ficou online e auto-sync está ativo, sincroniza
      if (online && get().autoSyncEnabled && !get().isSyncing) {
        get().syncNow();
      }
    });

    // Verificação inicial
    const state = await NetInfo.fetch();
    const online = !!state.isConnected;
    
    logger.info('sync', `📶 Conexão inicial: connected=${state.isConnected}, online=${online}`);
    set({ isOnline: online });

    // ============================================
    // INTERVAL: Dados de negócio (5 min)
    // ============================================
    syncInterval = setInterval(() => {
      const { isOnline, autoSyncEnabled, isSyncing } = get();
      if (isOnline && autoSyncEnabled && !isSyncing) {
        logger.debug('sync', '⏰ Auto-sync triggered');
        get().syncNow();
      }
    }, SYNC_INTERVAL);

    // ============================================
    // INTERVAL: Telemetria (1 hora)
    // ============================================
    telemetrySyncInterval = setInterval(() => {
      const { isOnline, autoSyncEnabled } = get();
      if (isOnline && autoSyncEnabled) {
        logger.debug('sync', '⏰ Telemetry sync triggered');
        get().syncTelemetry();
      }
    }, TELEMETRY_SYNC_INTERVAL);

    // ============================================
    // INTERVAL: Cleanup (24 horas)
    // ============================================
    cleanupInterval = setInterval(() => {
      get().runCleanup();
    }, CLEANUP_INTERVAL);

    // Sync inicial
    if (isSupabaseConfigured()) {
      logger.info('sync', '🚀 Iniciando sync de boot...');
      try {
        await get().syncNow();
        // Também sincroniza telemetria no boot
        await get().syncTelemetry();
      } catch (error) {
        logger.error('sync', 'Erro no sync de boot', { error: String(error) });
      }
    }

    logger.info('boot', '✅ Sync store inicializado', { online });

    // Retorna cleanup function
    return () => {
      if (netInfoUnsubscribe) netInfoUnsubscribe();
      if (syncInterval) clearInterval(syncInterval);
      if (telemetrySyncInterval) clearInterval(telemetrySyncInterval);
      if (cleanupInterval) clearInterval(cleanupInterval);
    };
  },

  // ============================================
  // SYNC DE DADOS DE NEGÓCIO (imediato)
  // ============================================
  syncNow: async () => {
    const { isSyncing } = get();
    
    if (isSyncing) {
      logger.warn('sync', 'Sync já em andamento');
      return;
    }

    if (!isSupabaseConfigured()) {
      logger.warn('sync', '⚠️ Supabase não configurado');
      return;
    }

    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      logger.warn('sync', '⚠️ Usuário não autenticado');
      return;
    }

    set({ isSyncing: true, lastSyncStats: null });

    const stats: SyncStats = {
      uploadedLocais: 0,
      uploadedRegistros: 0,
      downloadedLocais: 0,
      downloadedRegistros: 0,
      uploadedTelemetry: 0,
      errors: [],
    };

    try {
      logger.info('sync', '🔄 Iniciando sync de negócio...');

      // NOVO: Incrementa tentativa de sync na telemetria
      await incrementarTelemetria(userId, 'sync_attempts');

      // 1. Upload locais
      const locaisUp = await uploadLocais(userId);
      stats.uploadedLocais = locaisUp.count;
      stats.errors.push(...locaisUp.errors);

      // 2. Upload registros
      const registrosUp = await uploadRegistros(userId);
      stats.uploadedRegistros = registrosUp.count;
      stats.errors.push(...registrosUp.errors);

      // 3. Download locais
      const locaisDown = await downloadLocais(userId);
      stats.downloadedLocais = locaisDown.count;
      stats.errors.push(...locaisDown.errors);

      // 4. Download registros
      const registrosDown = await downloadRegistros(userId);
      stats.downloadedRegistros = registrosDown.count;
      stats.errors.push(...registrosDown.errors);

      // NOVO: Se teve erros, incrementa falhas na telemetria
      if (stats.errors.length > 0) {
        await incrementarTelemetria(userId, 'sync_failures');
      }

      set({ 
        lastSyncAt: new Date(),
        lastSyncStats: stats,
        isOnline: true,
      });

      logger.info('sync', '✅ Sync de negócio concluído', {
        up: `${stats.uploadedLocais}L/${stats.uploadedRegistros}R`,
        down: `${stats.downloadedLocais}L/${stats.downloadedRegistros}R`,
        errors: stats.errors.length,
      });

      // Recarrega locais
      await useLocationStore.getState().recarregarLocais();

    } catch (error) {
      logger.error('sync', '❌ Erro no sync', { error: String(error) });
      
      // Incrementa falha na telemetria
      await incrementarTelemetria(userId, 'sync_failures');
      
      set({ 
        lastSyncStats: {
          ...stats,
          errors: [String(error)],
        }
      });
    } finally {
      set({ isSyncing: false });
    }
  },

  // ============================================
  // SYNC DE TELEMETRIA (batch)
  // ============================================
  syncTelemetry: async () => {
    if (!isSupabaseConfigured()) return;

    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;

    try {
      logger.info('sync', '📊 Iniciando sync de telemetria...');

      // Busca dias pendentes
      const pendingDays = await getTelemetriaParaSync(userId);
      
      if (pendingDays.length === 0) {
        logger.debug('sync', 'Nenhuma telemetria pendente');
        set({ lastTelemetrySyncAt: new Date() });
        return;
      }

      logger.info('sync', `📊 ${pendingDays.length} dias de telemetria para sync`);

      let syncedCount = 0;

      for (const day of pendingDays) {
        try {
          // Calcula médias
          const geofence_accuracy_avg = day.geofence_accuracy_count > 0
            ? day.geofence_accuracy_sum / day.geofence_accuracy_count
            : null;
          
          const battery_level_avg = day.battery_level_count > 0
            ? day.battery_level_sum / day.battery_level_count
            : null;

          // Upsert no Supabase
          const { error } = await supabase.from('timekeeper_telemetry_daily').upsert({
            user_id: userId,
            date: day.date,
            app_opens: day.app_opens,
            manual_entries_count: day.manual_entries_count,
            geofence_entries_count: day.geofence_entries_count,
            geofence_triggers: day.geofence_triggers,
            geofence_accuracy_avg,
            background_location_checks: day.background_location_checks,
            battery_level_avg,
            offline_entries_count: day.offline_entries_count,
            sync_attempts: day.sync_attempts,
            sync_failures: day.sync_failures,
            // Campos extras que podem não existir ainda no Supabase
            // heartbeat_count: day.heartbeat_count,
            // heartbeat_inside_fence_count: day.heartbeat_inside_fence_count,
          }, {
            onConflict: 'user_id,date',
          });

          if (error) {
            logger.error('sync', `❌ Erro ao sincronizar telemetria ${day.date}`, { error: error.message });
            continue;
          }

          // Marca como sincronizado localmente
          await marcarTelemetriaSincronizada(day.date, userId);
          syncedCount++;
          
          logger.debug('sync', `✅ Telemetria ${day.date} sincronizada`);
        } catch (e) {
          logger.error('sync', `❌ Exceção ao sincronizar telemetria ${day.date}`, { error: String(e) });
        }
      }

      set({ lastTelemetrySyncAt: new Date() });

      logger.info('sync', `✅ Telemetria sincronizada: ${syncedCount}/${pendingDays.length} dias`);

    } catch (error) {
      logger.error('sync', '❌ Erro no sync de telemetria', { error: String(error) });
    }
  },

  // ============================================
  // CLEANUP (dados antigos)
  // ============================================
  runCleanup: async () => {
    try {
      logger.info('sync', '🧹 Executando cleanup...');

      // Limpa telemetria local antiga (já sincronizada, > 7 dias)
      const telemetriaLimpa = await limparTelemetriaAntiga(7);

      // Limpa heartbeats antigos (> 30 dias)
      const heartbeatsLimpos = await limparHeartbeatsAntigos(30);

      // Limpa geopontos antigos (> 90 dias)
      const geopontosLimpos = await limparGeopontosAntigos(90);

      logger.info('sync', '✅ Cleanup concluído', {
        telemetria: telemetriaLimpa,
        heartbeats: heartbeatsLimpos,
        geopontos: geopontosLimpos,
      });
    } catch (error) {
      logger.error('sync', '❌ Erro no cleanup', { error: String(error) });
    }
  },

  forceFullSync: async () => {
    logger.info('sync', '🔄 Forçando sync completo...');
    set({ isSyncing: false, isOnline: true });
    await get().syncNow();
    await get().syncTelemetry();
  },

  debugSync: async () => {
    const netState = await NetInfo.fetch();
    const userId = useAuthStore.getState().getUserId();
    
    // NOVO: Inclui stats de telemetria
    const telemetryStats = userId ? await getTelemetriaStats(userId) : null;
    
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
    logger.info('sync', `Auto-sync ${newValue ? 'ativado' : 'desativado'}`);
  },

  syncLocais: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    await uploadLocais(userId);
    await downloadLocais(userId);
    await useLocationStore.getState().recarregarLocais();
  },

  syncRegistros: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    await uploadRegistros(userId);
    await downloadRegistros(userId);
  },

  reconciliarNoBoot: async () => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    await downloadLocais(userId);
    await downloadRegistros(userId);
    await useLocationStore.getState().recarregarLocais();
  },
}));

// ============================================
// FUNÇÕES DE UPLOAD/DOWNLOAD
// ============================================

async function uploadLocais(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const locais = await getLocaisParaSync(userId);
    logger.info('sync', `📤 ${locais.length} locais pendentes`);

    for (const local of locais) {
      try {
        const { error } = await supabase.from('locais').upsert({
          id: local.id,
          user_id: local.user_id,
          nome: local.nome,
          latitude: local.latitude,
          longitude: local.longitude,
          raio: local.raio,
          cor: local.cor,
          status: local.status,
          deleted_at: local.deleted_at,
          last_seen_at: local.last_seen_at,
          created_at: local.created_at,
          updated_at: local.updated_at,
        });

        if (error) {
          errors.push(`${local.nome}: ${error.message}`);
          logger.error('sync', `❌ Upload local falhou: ${local.nome}`, { error: error.message });
        } else {
          await marcarLocalSincronizado(local.id);
          count++;
          logger.info('sync', `✅ Local uploaded: ${local.nome}`);
        }
      } catch (e) {
        errors.push(`${local.nome}: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

async function uploadRegistros(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const registros = await getRegistrosParaSync(userId);
    logger.info('sync', `📤 ${registros.length} registros pendentes`);

    for (const reg of registros) {
      try {
        const { error } = await supabase.from('registros').upsert({
          id: reg.id,
          user_id: reg.user_id,
          local_id: reg.local_id,
          local_nome: reg.local_nome,
          entrada: reg.entrada,
          saida: reg.saida,
          tipo: reg.tipo,
          editado_manualmente: reg.editado_manualmente === 1,
          motivo_edicao: reg.motivo_edicao,
          hash_integridade: reg.hash_integridade,
          cor: reg.cor,
          device_id: reg.device_id,
          pausa_minutos: reg.pausa_minutos || 0,
          created_at: reg.created_at,
        });

        if (error) {
          errors.push(`Registro: ${error.message}`);
          logger.error('sync', `❌ Upload registro falhou`, { error: error.message });
        } else {
          await marcarRegistroSincronizado(reg.id);
          count++;
          logger.info('sync', `✅ Registro uploaded: ${reg.id}`);
        }
      } catch (e) {
        errors.push(`Registro: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

async function downloadLocais(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const { data, error } = await supabase
      .from('locais')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      errors.push(error.message);
      return { count, errors };
    }

    logger.info('sync', `📥 ${data?.length || 0} locais do Supabase`);

    for (const remote of data || []) {
      try {
        await upsertLocalFromSync({
          ...remote,
          synced_at: new Date().toISOString(),
        });
        count++;
      } catch (e) {
        errors.push(`${remote.nome}: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}

async function downloadRegistros(userId: string): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  try {
    const { data, error } = await supabase
      .from('registros')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      errors.push(error.message);
      return { count, errors };
    }

    logger.info('sync', `📥 ${data?.length || 0} registros do Supabase`);

    for (const remote of data || []) {
      try {
        await upsertRegistroFromSync({
          ...remote,
          editado_manualmente: remote.editado_manualmente ? 1 : 0,
          synced_at: new Date().toISOString(),
        });
        count++;
      } catch (e) {
        errors.push(`Registro: ${e}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { count, errors };
}
