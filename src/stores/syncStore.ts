/**
 * Sync Store - OnSite Timekeeper
 * 
 * CORRIGIDO: isOnline agora funciona corretamente
 */

import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '../lib/logger';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  getLocaisPendentesSync,
  getRegistrosPendentesSync,
  marcarLocalSincronizado,
  marcarRegistroSincronizado,
  upsertLocalFromSync,
  upsertRegistroFromSync,
  purgeLocaisDeletados,
  registrarSyncLog,
  getTodosLocais,
  type LocalDB,
  type RegistroDB,
} from '../lib/database';
import { useAuthStore } from './authStore';
import { useLocationStore } from './locationStore';

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutos

interface SyncState {
  isSyncing: boolean;
  lastSyncAt: Date | null;
  isOnline: boolean;
  autoSyncEnabled: boolean;
  lastSyncStats: {
    uploadedLocais: number;
    uploadedRegistros: number;
    downloadedLocais: number;
    downloadedRegistros: number;
    errors: string[];
  } | null;

  initialize: () => Promise<() => void>;
  syncNow: () => Promise<void>;
  forceFullSync: () => Promise<void>;
  debugSync: () => Promise<{ success: boolean; error?: string; stats?: any }>;
  toggleAutoSync: () => void;
  syncLocais: () => Promise<void>;
  syncRegistros: () => Promise<void>;
  reconciliarNoBoot: () => Promise<void>;
}

let syncInterval: NodeJS.Timeout | null = null;
let netInfoUnsubscribe: (() => void) | null = null;

export const useSyncStore = create<SyncState>((set, get) => ({
  isSyncing: false,
  lastSyncAt: null,
  isOnline: true,  // ✅ CORRIGIDO: Começa TRUE, assume online
  autoSyncEnabled: true,
  lastSyncStats: null,

  initialize: async () => {
    logger.info('boot', '🔄 Inicializando sync store...');

    // ✅ CORRIGIDO: Listener simplificado - confia no isConnected
    netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      // Se está conectado, está online. Simples.
      const online = !!state.isConnected;
      
      logger.info('sync', `📶 NetInfo: connected=${state.isConnected}, online=${online}`);
      set({ isOnline: online });

      // Se ficou online e auto-sync está ativo, sincroniza
      if (online && get().autoSyncEnabled && !get().isSyncing) {
        get().syncNow();
      }
    });

    // ✅ CORRIGIDO: Verificação inicial simplificada
    const state = await NetInfo.fetch();
    const online = !!state.isConnected;
    
    logger.info('sync', `📶 Conexão inicial: connected=${state.isConnected}, online=${online}`);
    set({ isOnline: online });

    // Auto-sync a cada 5 minutos
    syncInterval = setInterval(() => {
      const { isOnline, autoSyncEnabled, isSyncing } = get();
      if (isOnline && autoSyncEnabled && !isSyncing) {
        logger.debug('sync', '⏰ Auto-sync triggered');
        get().syncNow();
      }
    }, SYNC_INTERVAL);

    // Sync inicial
    if (isSupabaseConfigured()) {
      logger.info('sync', '🚀 Iniciando sync de boot...');
      try {
        await get().syncNow();
      } catch (error) {
        logger.error('sync', 'Erro no sync de boot', { error: String(error) });
      }
    }

    logger.info('boot', '✅ Sync store inicializado', { online });

    return () => {
      if (netInfoUnsubscribe) netInfoUnsubscribe();
      if (syncInterval) clearInterval(syncInterval);
    };
  },

  syncNow: async () => {
    const { isSyncing } = get();
    
    if (isSyncing) {
      logger.warn('sync', 'Sync já em andamento');
      return;
    }

    // ✅ CORRIGIDO: Não verifica isOnline aqui - tenta sincronizar sempre
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

    try {
      logger.info('sync', '🔄 Iniciando sync...');

      const stats = {
        uploadedLocais: 0,
        uploadedRegistros: 0,
        downloadedLocais: 0,
        downloadedRegistros: 0,
        errors: [] as string[],
      };

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

      // 5. Purge
      await purgeLocaisDeletados(7);

      // ✅ Se chegou aqui sem erro, está online!
      set({ 
        lastSyncAt: new Date(),
        lastSyncStats: stats,
        isOnline: true,
      });

      logger.info('sync', '✅ Sync concluído', {
        up: `${stats.uploadedLocais}L/${stats.uploadedRegistros}R`,
        down: `${stats.downloadedLocais}L/${stats.downloadedRegistros}R`,
        errors: stats.errors.length,
      });

      // Recarrega locais
      await useLocationStore.getState().recarregarLocais();

    } catch (error) {
      logger.error('sync', '❌ Erro no sync', { error: String(error) });
      set({ 
        lastSyncStats: {
          uploadedLocais: 0,
          uploadedRegistros: 0,
          downloadedLocais: 0,
          downloadedRegistros: 0,
          errors: [String(error)],
        }
      });
    } finally {
      set({ isSyncing: false });
    }
  },

  forceFullSync: async () => {
    logger.info('sync', '🔄 Forçando sync...');
    set({ isSyncing: false, isOnline: true }); // ✅ Força online
    await get().syncNow();
  },

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
          lastSyncAt: get().lastSyncAt?.toISOString() || null,
        },
        supabase: {
          isConfigured: isSupabaseConfigured(),
        },
        auth: {
          userId: userId || 'NOT AUTHENTICATED',
        },
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
    const locais = await getLocaisPendentesSync(userId);
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
    const registros = await getRegistrosPendentesSync(userId);
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
      .eq('user_id', userId)
      .eq('status', 'active');

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
