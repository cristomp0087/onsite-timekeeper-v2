/**
 * Location Store - OnSite Timekeeper
 * 
 * Gerencia:
 * - Locais de trabalho (CRUD)
 * - Localização atual do usuário
 * - Geofencing (monitoramento de entrada/saída)
 * - Heartbeat (verificação periódica)
 * - Polling de backup
 * 
 * MODIFICADO: Usa telemetria agregada em vez de heartbeat_log individual
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../lib/logger';
import {
  obterLocalizacaoAtual,
  iniciarWatchPosicao,
  pararWatchPosicao,
  iniciarGeofencing,
  pararGeofencing,
  iniciarBackgroundLocation,
  pararBackgroundLocation,
  verificarPermissoes,
  calcularDistancia,
  estaDentroGeofence,
  type Coordenadas,
  type LocalizacaoResult,
  type GeofenceRegion,
  type PermissoesStatus,
} from '../lib/location';
import {
  criarLocal,
  getLocais,
  removerLocal,
  atualizarLocal,
  initDatabase,
  // LEGADO: ainda usamos por enquanto para manter histórico
  registrarHeartbeat,
  // NOVO: telemetria agregada
  incrementarTelemetria,
  incrementarTelemetriaHeartbeat,
  type LocalDB,
} from '../lib/database';
import {
  setGeofenceCallback,
  setHeartbeatCallback,
  updateActiveFences,
  startHeartbeat,
  stopHeartbeat,
  type GeofenceEvent,
  type HeartbeatResult,
  type ActiveFence,
} from '../lib/backgroundTasks';
import { useWorkSessionStore } from './workSessionStore';
import { useAuthStore } from './authStore';

// ============================================
// CONSTANTES
// ============================================

const POLLING_INTERVAL = 30000; // 30 segundos
const STORAGE_KEY_MONITORING = '@onsite_monitoring_active';
const HISTERESE_SAIDA = 1.5; // Saída usa raio × 1.5 (evita ping-pong)

// ============================================
// TIPOS
// ============================================

export interface LocalDeTrabalho {
  id: string;
  nome: string;
  latitude: number;
  longitude: number;
  raio: number;
  cor: string;
  status: string;
}

interface LocationState {
  // Permissões
  permissoes: PermissoesStatus;
  
  // Localização atual
  localizacaoAtual: Coordenadas | null;
  precisao: number | null;
  ultimaAtualizacao: number | null;
  
  // Locais de trabalho
  locais: LocalDeTrabalho[];
  
  // Estado do monitoramento
  geofenceAtivo: string | null; // ID do local onde está
  isGeofencingAtivo: boolean;
  isBackgroundAtivo: boolean;
  isPollingAtivo: boolean;
  isWatching: boolean;
  
  // Heartbeat
  lastHeartbeat: HeartbeatResult | null;
  isHeartbeatAtivo: boolean;
  
  // Controle de processamento
  isProcessandoEvento: boolean;
  ultimoEvento: GeofenceEvent | null;
  
  // Inicialização
  isInicializado: boolean;

  // Actions
  initialize: () => Promise<void>;
  atualizarLocalizacao: () => Promise<void>;
  iniciarTracking: () => Promise<void>;
  pararTracking: () => Promise<void>;
  
  // CRUD Locais
  adicionarLocal: (local: Omit<LocalDeTrabalho, 'id' | 'status'>) => Promise<string>;
  removerLocal: (id: string) => Promise<void>;
  editarLocal: (id: string, updates: Partial<LocalDeTrabalho>) => Promise<void>;
  recarregarLocais: () => Promise<void>;
  
  // Geofencing
  iniciarMonitoramento: () => Promise<void>;
  pararMonitoramento: () => Promise<void>;
  verificarGeofenceAtual: () => void;
  
  // Heartbeat
  atualizarFencesHeartbeat: () => void;
  
  // Polling
  iniciarPolling: () => void;
  pararPolling: () => void;
}

// ============================================
// POLLING TIMER
// ============================================

let pollingTimer: NodeJS.Timeout | null = null;

// ============================================
// STORE
// ============================================

export const useLocationStore = create<LocationState>((set, get) => ({
  permissoes: { foreground: false, background: false },
  localizacaoAtual: null,
  precisao: null,
  ultimaAtualizacao: null,
  locais: [],
  geofenceAtivo: null,
  isGeofencingAtivo: false,
  isBackgroundAtivo: false,
  isPollingAtivo: false,
  isWatching: false,
  lastHeartbeat: null,
  isHeartbeatAtivo: false,
  isProcessandoEvento: false,
  ultimoEvento: null,
  isInicializado: false,

  initialize: async () => {
    if (get().isInicializado) return;

    logger.info('boot', '📍 Inicializando location store...');

    try {
      // IMPORTANTE: Inicializa o banco primeiro
      await initDatabase();

      // Importa background tasks (registra as tasks)
      await import('../lib/backgroundTasks');

    // Verifica permissões - e pede se não tiver
      let permissoes = await verificarPermissoes();
      if (!permissoes.foreground || !permissoes.background) {
        const { solicitarTodasPermissoes } = await import('../lib/location');
        permissoes = await solicitarTodasPermissoes();
      }
      set({ permissoes });
      
      // ============================================
      // CALLBACK DE GEOFENCE NATIVO
      // ============================================
      setGeofenceCallback((evento) => {
        const { isProcessandoEvento } = get();

        if (isProcessandoEvento) {
          logger.warn('geofence', 'Evento ignorado - já processando outro');
          return;
        }

        logger.info('geofence', `📍 Evento: ${evento.type} - ${evento.regionIdentifier}`);
        set({ ultimoEvento: evento, isProcessandoEvento: true });

        // Processa o evento
        processarEventoGeofence(evento, get, set);

        // Libera processamento após 1s
        setTimeout(() => set({ isProcessandoEvento: false }), 1000);
      });

      // ============================================
      // CALLBACK DE HEARTBEAT (SAFETY NET)
      // MODIFICADO: Usa telemetria agregada
      // ============================================
      setHeartbeatCallback(async (result: HeartbeatResult) => {
        logger.info('heartbeat', '💓 Processando heartbeat', {
          inside: result.isInsideFence,
          fence: result.fenceName,
        });

        set({ lastHeartbeat: result });

        const userId = useAuthStore.getState().getUserId();
        
        // Importa registroStore dinamicamente para evitar circular dependency
        const { useRegistroStore } = await import('./registroStore');
        const registroStore = useRegistroStore.getState();
        const sessaoAtual = registroStore.sessaoAtual;

        // ============================================
        // MODIFICADO: Registra na telemetria agregada
        // (registrarHeartbeat também chama incrementarTelemetriaHeartbeat internamente)
        // ============================================
        if (userId && result.location) {
          try {
            // Ainda chama registrarHeartbeat por enquanto para manter compatibilidade
            // Mas a função já incrementa telemetria automaticamente
            await registrarHeartbeat(
              userId,
              result.location.latitude,
              result.location.longitude,
              result.location.accuracy,
              result.isInsideFence,
              result.fenceId,
              result.fenceName,
              sessaoAtual?.id || null,
              result.batteryLevel
            );
          } catch (error) {
            logger.error('heartbeat', 'Erro ao registrar heartbeat', { error: String(error) });
          }
        }

        // ============================================
        // LÓGICA DE NEGÓCIO: Detectar inconsistências
        // (Isso é o que realmente importa do heartbeat)
        // ============================================

        // Caso A: Tem sessão ativa mas está FORA da fence → saída perdida!
        if (sessaoAtual && sessaoAtual.status === 'ativa' && !result.isInsideFence) {
          logger.warn('heartbeat', '⚠️ SAÍDA DETECTADA POR HEARTBEAT!', {
            sessaoId: sessaoAtual.id,
            localNome: sessaoAtual.local_nome,
          });

          // Encerrar sessão automaticamente
          try {
            await registroStore.registrarSaida(sessaoAtual.local_id);
            logger.info('heartbeat', '✅ Sessão encerrada por heartbeat');
            
            // Atualiza geofenceAtivo
            set({ geofenceAtivo: null });
          } catch (error) {
            logger.error('heartbeat', 'Erro ao encerrar sessão por heartbeat', { error: String(error) });
          }
        }

        // Caso B: Sem sessão ativa mas DENTRO de fence → entrada perdida?
        // Por segurança, NÃO registramos automaticamente - só logamos
        if (!sessaoAtual && result.isInsideFence && result.fenceId) {
          logger.warn('heartbeat', '⚠️ POSSÍVEL ENTRADA PERDIDA', {
            fenceId: result.fenceId,
            fenceName: result.fenceName,
          });
          
          // Atualiza geofenceAtivo para UI mostrar corretamente
          set({ geofenceAtivo: result.fenceId });
          
          // TODO: Implementar notificação push para o usuário
          // "Você está em [local]. Deseja iniciar uma sessão?"
        }
      });

      // Carrega locais do banco
      await get().recarregarLocais();

      // Obtém localização atual
      const localizacao = await obterLocalizacaoAtual();
      if (localizacao) {
        set({
          localizacaoAtual: localizacao.coords,
          precisao: localizacao.accuracy,
          ultimaAtualizacao: localizacao.timestamp,
        });
      }

      set({ isInicializado: true });

      // Auto-inicia monitoramento se necessário
      await autoIniciarMonitoramento(get, set);

      // Verifica geofence atual
      get().verificarGeofenceAtual();

      logger.info('boot', '✅ Location store inicializado');
    } catch (error) {
      logger.error('gps', 'Erro na inicialização do location store', { error: String(error) });
      set({ isInicializado: true }); // Marca como inicializado mesmo com erro
    }
  },

  atualizarLocalizacao: async () => {
    try {
      const localizacao = await obterLocalizacaoAtual();
      if (localizacao) {
        set({
          localizacaoAtual: localizacao.coords,
          precisao: localizacao.accuracy,
          ultimaAtualizacao: localizacao.timestamp,
        });
        get().verificarGeofenceAtual();
      }
    } catch (error) {
      logger.error('gps', 'Erro ao atualizar localização', { error: String(error) });
    }
  },

  iniciarTracking: async () => {
    const success = await iniciarWatchPosicao((localizacao) => {
      set({
        localizacaoAtual: localizacao.coords,
        precisao: localizacao.accuracy,
        ultimaAtualizacao: localizacao.timestamp,
      });
      get().verificarGeofenceAtual();
    });

    if (success) {
      set({ isWatching: true });
      logger.info('gps', '👁️ Tracking em tempo real iniciado');
    }
  },

  pararTracking: async () => {
    await pararWatchPosicao();
    set({ isWatching: false });
    logger.info('gps', '⏹️ Tracking em tempo real parado');
  },

  adicionarLocal: async (local) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('Usuário não autenticado');
    }

    const { locais } = get();

    // ============================================
    // VALIDAÇÃO 1: Nome duplicado
    // ============================================
    const nomeDuplicado = locais.some(
      l => l.nome.toLowerCase().trim() === local.nome.toLowerCase().trim()
    );
    if (nomeDuplicado) {
      throw new Error(`Já existe um local com o nome "${local.nome}"`);
    }

    // ============================================
    // VALIDAÇÃO 2: Raio mínimo/máximo
    // ============================================
    const RAIO_MINIMO = 200;
    const RAIO_MAXIMO = 1500;
    
    if (local.raio < RAIO_MINIMO) {
      throw new Error(`Raio mínimo é ${RAIO_MINIMO} metros`);
    }
    if (local.raio > RAIO_MAXIMO) {
      throw new Error(`Raio máximo é ${RAIO_MAXIMO} metros`);
    }

    // ============================================
    // VALIDAÇÃO 3: Sobreposição de fences
    // ============================================
    const locaisAtivos = locais.filter(l => l.status === 'active');
    
    for (const existente of locaisAtivos) {
      const distancia = calcularDistancia(
        { latitude: local.latitude, longitude: local.longitude },
        { latitude: existente.latitude, longitude: existente.longitude }
      );
      
      const somaRaios = local.raio + existente.raio;
      
      if (distancia < somaRaios) {
        throw new Error(
          `Este local sobrepõe "${existente.nome}". ` +
          `Distância: ${Math.round(distancia)}m, mínimo necessário: ${somaRaios}m`
        );
      }
    }

    // ============================================
    // CRIAR LOCAL (passou nas validações)
    // ============================================
    logger.info('geofence', `➕ Adicionando local: ${local.nome}`);

    const id = await criarLocal({
      userId,
      nome: local.nome,
      latitude: local.latitude,
      longitude: local.longitude,
      raio: local.raio,
      cor: local.cor,
    });

    // Recarrega locais
    await get().recarregarLocais();

    // Reinicia geofencing para incluir novo local
    const { isGeofencingAtivo } = get();
    if (isGeofencingAtivo) {
      await get().pararMonitoramento();
      await get().iniciarMonitoramento();
    } else {
      // Auto-inicia monitoramento quando primeiro local é adicionado
      await get().iniciarMonitoramento();
    }

    // Atualiza fences no heartbeat
    get().atualizarFencesHeartbeat();

    logger.info('geofence', `✅ Local adicionado: ${local.nome}`, { id });
    return id;
  },

  removerLocal: async (id) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('Usuário não autenticado');
    }

    // VERIFICAR SE TEM SESSÃO ATIVA NESTE LOCAL
    const { useRegistroStore } = await import('./registroStore');
    const sessaoAtual = useRegistroStore.getState().sessaoAtual;
    
    if (sessaoAtual && sessaoAtual.local_id === id) {
      throw new Error('Não é possível excluir um local com sessão ativa. Encerre o cronômetro primeiro.');
    }

    logger.info('geofence', `🗑️ Removendo local`, { id });

    await removerLocal(userId, id);
    
    // Remove do estado
    set(state => ({
      locais: state.locais.filter(l => l.id !== id),
      geofenceAtivo: state.geofenceAtivo === id ? null : state.geofenceAtivo,
    }));

    // Reinicia geofencing
    const { locais, isGeofencingAtivo } = get();
    if (isGeofencingAtivo) {
      if (locais.length === 0) {
        await get().pararMonitoramento();
      } else {
        await get().pararMonitoramento();
        await get().iniciarMonitoramento();
      }
    }

    // Atualiza fences no heartbeat
    get().atualizarFencesHeartbeat();

    logger.info('geofence', '✅ Local removido');
  },

  editarLocal: async (id, updates) => {
    const userId = useAuthStore.getState().getUserId();
    if (!userId) {
      throw new Error('Usuário não autenticado');
    }

    await atualizarLocal(id, updates);
    await get().recarregarLocais();

    // Reinicia geofencing se estiver ativo
    const { isGeofencingAtivo } = get();
    if (isGeofencingAtivo) {
      await get().pararMonitoramento();
      await get().iniciarMonitoramento();
    }

    // Atualiza fences no heartbeat
    get().atualizarFencesHeartbeat();

    logger.info('geofence', '✅ Local editado', { id });
  },

  recarregarLocais: async () => {
    try {
      const userId = useAuthStore.getState().getUserId();
      if (!userId) {
        set({ locais: [] });
        return;
      }

      const locaisDB = await getLocais(userId);
      const locais: LocalDeTrabalho[] = locaisDB.map(l => ({
        id: l.id,
        nome: l.nome,
        latitude: l.latitude,
        longitude: l.longitude,
        raio: l.raio,
        cor: l.cor,
        status: l.status,
      }));

      set({ locais });
      
      // Atualiza fences no heartbeat
      get().atualizarFencesHeartbeat();
      
      logger.debug('gps', `${locais.length} locais carregados`);
    } catch (error) {
      logger.error('gps', 'Erro ao carregar locais', { error: String(error) });
    }
  },

  iniciarMonitoramento: async () => {
    const { locais } = get();
    const locaisAtivos = locais.filter(l => l.status === 'active');

    if (locaisAtivos.length === 0) {
      logger.warn('geofence', 'Nenhum local ativo para monitorar');
      return;
    }

    // Prepara regiões de geofence
    const regioes: GeofenceRegion[] = locaisAtivos.map(l => ({
      identifier: l.id,
      latitude: l.latitude,
      longitude: l.longitude,
      radius: l.raio,
      notifyOnEnter: true,
      notifyOnExit: true,
    }));

    // Inicia geofencing nativo
    const success = await iniciarGeofencing(regioes);
    if (success) {
      set({ isGeofencingAtivo: true });

      // Inicia background location como backup
      await iniciarBackgroundLocation();
      set({ isBackgroundAtivo: true });

      // Inicia polling ativo
      get().iniciarPolling();

      // ============================================
      // INICIA HEARTBEAT (a cada 15 min)
      // ============================================
      const heartbeatStarted = await startHeartbeat();
      set({ isHeartbeatAtivo: heartbeatStarted });
      
      if (heartbeatStarted) {
        logger.info('heartbeat', '💓 Heartbeat iniciado');
      } else {
        logger.warn('heartbeat', '⚠️ Heartbeat não pôde ser iniciado');
      }

      // Atualiza lista de fences para heartbeat
      get().atualizarFencesHeartbeat();

      // Salva estado
      await AsyncStorage.setItem(STORAGE_KEY_MONITORING, 'true');

      logger.info('geofence', '✅ Monitoramento completo iniciado (geofence + heartbeat + polling)');

      // Verifica geofence atual
      get().verificarGeofenceAtual();
    }
  },

  pararMonitoramento: async () => {
    get().pararPolling();
    await pararGeofencing();
    await pararBackgroundLocation();
    
    // ============================================
    // PARA HEARTBEAT
    // ============================================
    await stopHeartbeat();

    set({
      isGeofencingAtivo: false,
      isBackgroundAtivo: false,
      isPollingAtivo: false,
      isHeartbeatAtivo: false,
    });

    await AsyncStorage.setItem(STORAGE_KEY_MONITORING, 'false');
    logger.info('geofence', '⏹️ Monitoramento parado (geofence + heartbeat + polling)');
  },

  // ============================================
  // VERIFICAR GEOFENCE COM HISTERESE
  // ============================================
  verificarGeofenceAtual: () => {
    const { localizacaoAtual, locais, geofenceAtivo, isProcessandoEvento, precisao } = get();
    
    if (!localizacaoAtual) return;
    if (isProcessandoEvento) return;

    const locaisAtivos = locais.filter(l => l.status === 'active');

    // ============================================
    // VERIFICA ENTRADA (raio normal)
    // ============================================
    for (const local of locaisAtivos) {
      const distancia = calcularDistancia(localizacaoAtual, {
        latitude: local.latitude,
        longitude: local.longitude,
      });

      const dentroRaioNormal = distancia <= local.raio;

      if (dentroRaioNormal) {
        if (geofenceAtivo !== local.id) {
          // Entrou no geofence
          logger.info('geofence', `✅ ENTRADA: ${local.nome}`, {
            distancia: distancia.toFixed(0) + 'm',
            raio: local.raio + 'm',
          });

          set({ geofenceAtivo: local.id, isProcessandoEvento: true });

          // Notifica workSessionStore
          const workSession = useWorkSessionStore.getState();
          workSession.handleGeofenceEnter(local.id, local.nome, {
            ...localizacaoAtual,
            accuracy: precisao ?? undefined,
          });

          setTimeout(() => set({ isProcessandoEvento: false }), 1000);
        }
        return; // Está dentro de um geofence, não precisa verificar outros
      }
    }

    // ============================================
    // VERIFICA SAÍDA (raio × HISTERESE)
    // ============================================
    if (geofenceAtivo !== null) {
      const localAnterior = locais.find(l => l.id === geofenceAtivo);
      
      if (localAnterior) {
        const distancia = calcularDistancia(localizacaoAtual, {
          latitude: localAnterior.latitude,
          longitude: localAnterior.longitude,
        });

        const raioExpandido = localAnterior.raio * HISTERESE_SAIDA;
        const foraRaioExpandido = distancia > raioExpandido;

        if (foraRaioExpandido) {
          // Realmente saiu (passou do raio expandido)
          logger.info('geofence', `🚪 SAÍDA: ${localAnterior.nome}`, {
            distancia: distancia.toFixed(0) + 'm',
            raioExpandido: raioExpandido.toFixed(0) + 'm',
          });

          const workSession = useWorkSessionStore.getState();
          workSession.handleGeofenceExit(localAnterior.id, localAnterior.nome, {
            ...localizacaoAtual,
            accuracy: precisao ?? undefined,
          });

          set({ geofenceAtivo: null });
        } else {
          // Ainda dentro da zona de histerese - não faz nada
          logger.debug('geofence', `⏸️ Histerese: ${localAnterior.nome}`, {
            distancia: distancia.toFixed(0) + 'm',
            raioExpandido: raioExpandido.toFixed(0) + 'm',
          });
        }
      }
    }
  },

  // ============================================
  // ATUALIZA FENCES NO HEARTBEAT
  // ============================================
  atualizarFencesHeartbeat: () => {
    const { locais } = get();
    const locaisAtivos = locais.filter(l => l.status === 'active');
    
    const fences: ActiveFence[] = locaisAtivos.map(l => ({
      id: l.id,
      nome: l.nome,
      latitude: l.latitude,
      longitude: l.longitude,
      radius: l.raio,
    }));

    updateActiveFences(fences);
    logger.debug('heartbeat', `Fences atualizadas: ${fences.length}`);
  },

  iniciarPolling: () => {
    get().pararPolling();
    
    logger.info('gps', '🔄 Iniciando polling (30s)');
    
    // Atualiza imediatamente
    get().atualizarLocalizacao();

    // Configura intervalo
    pollingTimer = setInterval(() => {
      logger.debug('gps', 'Polling...');
      get().atualizarLocalizacao();
    }, POLLING_INTERVAL);

    set({ isPollingAtivo: true });
  },

  pararPolling: () => {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
      logger.info('gps', '⏹️ Polling parado');
    }
    set({ isPollingAtivo: false });
  },
}));

// ============================================
// HELPERS PRIVADOS
// ============================================

/**
 * Processa evento de geofence vindo do callback nativo
 * COM HISTERESE: Saída só é confirmada se estiver fora do raio expandido
 */
function processarEventoGeofence(
  evento: GeofenceEvent,
  get: () => LocationState,
  set: (partial: Partial<LocationState>) => void
) {
  const { locais, localizacaoAtual, precisao } = get();
  const local = locais.find(l => l.id === evento.regionIdentifier);

  if (!local) {
    logger.warn('geofence', 'Local não encontrado para evento', { id: evento.regionIdentifier });
    return;
  }

  const workSession = useWorkSessionStore.getState();
  const coords = localizacaoAtual ? {
    ...localizacaoAtual,
    accuracy: precisao ?? undefined,
  } : undefined;

  if (evento.type === 'enter') {
    set({ geofenceAtivo: local.id });
    workSession.handleGeofenceEnter(local.id, local.nome, coords);
  } else {
    // ============================================
    // SAÍDA: Verificar histerese antes de confirmar
    // ============================================
    if (localizacaoAtual) {
      const distancia = calcularDistancia(localizacaoAtual, {
        latitude: local.latitude,
        longitude: local.longitude,
      });

      const raioExpandido = local.raio * HISTERESE_SAIDA;

      if (distancia <= raioExpandido) {
        // Ainda dentro da zona de histerese - ignora evento de saída
        logger.info('geofence', `⏸️ Saída ignorada (histerese): ${local.nome}`, {
          distancia: distancia.toFixed(0) + 'm',
          raioExpandido: raioExpandido.toFixed(0) + 'm',
        });
        return;
      }
    }

    // Confirmada saída
    set({ geofenceAtivo: null });
    workSession.handleGeofenceExit(local.id, local.nome, coords);
  }
}

/**
 * Auto-inicia monitoramento se estava ativo antes
 */
async function autoIniciarMonitoramento(
  get: () => LocationState,
  set: (partial: Partial<LocationState>) => void
) {
  const { locais, isGeofencingAtivo } = get();

  if (isGeofencingAtivo) return;
  if (locais.length === 0) {
    logger.info('gps', 'Sem locais para monitorar');
    return;
  }

  try {
    const eraAtivo = await AsyncStorage.getItem(STORAGE_KEY_MONITORING);
    
    if (eraAtivo === 'true' || eraAtivo === null) {
      logger.info('gps', '🔄 Auto-iniciando monitoramento...');
      await get().iniciarMonitoramento();
    }
  } catch (error) {
    logger.error('gps', 'Erro ao verificar estado de monitoramento', { error: String(error) });
    // Inicia mesmo assim se há locais
    await get().iniciarMonitoramento();
  }
}
