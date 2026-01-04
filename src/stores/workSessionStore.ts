/**
 * Work Session Store - OnSite Timekeeper
 * 
 * Gerencia o fluxo de sessões de trabalho:
 * - Popup fullscreen de entrada/saída (estilo soneca)
 * - Auto-ação após 30 segundos
 * - Iniciar, pausar, continuar, encerrar cronômetro
 * - Integração com notificações
 */

import { create } from 'zustand';
import * as Notifications from 'expo-notifications';
import { logger } from '../lib/logger';
import {
  solicitarPermissaoNotificacao,
  configurarCategoriasNotificacao,
  mostrarNotificacaoEntrada,
  mostrarNotificacaoSaida,
  mostrarNotificacaoAutoAcao,
  agendarLembreteInicio,
  cancelarNotificacao,
  adicionarListenerResposta,
  type NotificationAction,
  type GeofenceNotificationData,
} from '../lib/notifications';
import { useRegistroStore } from './registroStore';
import { useAuthStore } from './authStore';
import type { Coordenadas } from '../lib/location';

// ============================================
// CONSTANTES
// ============================================

const AUTO_ACTION_TIMEOUT = 30000; // 30 segundos

// ============================================
// TIPOS
// ============================================

export interface PendingAction {
  type: 'enter' | 'exit';
  localId: string;
  localNome: string;
  notificationId: string;
  timeoutId: NodeJS.Timeout;
  coords?: Coordenadas & { accuracy?: number };
  startTime: number; // Para countdown
}

interface WorkSessionState {
  // Estado
  isInicializado: boolean;
  
  // Ação pendente (exibe popup fullscreen)
  pendingAction: PendingAction | null;
  
  // Locais ignorados hoje
  skippedToday: string[];
  
  // Lembretes agendados (localId -> notificationId)
  delayedStarts: Map<string, string>;

  // Actions
  initialize: () => Promise<void>;
  
  // Handlers de geofence (chamados pelo locationStore)
  handleGeofenceEnter: (
    localId: string,
    localNome: string,
    coords?: Coordenadas & { accuracy?: number }
  ) => Promise<void>;
  
  handleGeofenceExit: (
    localId: string,
    localNome: string,
    coords?: Coordenadas & { accuracy?: number }
  ) => Promise<void>;
  
  // Ações do usuário no popup
  acaoIniciar: () => Promise<void>;
  acaoIgnorarHoje: () => void;
  acaoDelay10Min: () => Promise<void>;
  acaoPausar: () => Promise<void>;
  acaoContinuar: () => void;
  acaoEncerrar: () => Promise<void>;
  acaoEncerrarComAjuste: (minutosAtras: number) => Promise<void>;
  
  // Helpers
  limparPending: () => void;
  resetSkippedToday: () => void;
  getTempoRestante: () => number;
}

// ============================================
// STORE
// ============================================

export const useWorkSessionStore = create<WorkSessionState>((set, get) => ({
  isInicializado: false,
  pendingAction: null,
  skippedToday: [],
  delayedStarts: new Map(),

  initialize: async () => {
    if (get().isInicializado) return;

    try {
      logger.info('boot', '⏱️ Inicializando work session store...');

      // Solicita permissões de notificação
      await solicitarPermissaoNotificacao();

      // Configura categorias de ações
      await configurarCategoriasNotificacao();

      // Listener para respostas às notificações
      adicionarListenerResposta((response) => {
        const actionId = response.actionIdentifier;
        const data = response.notification.request.content.data as GeofenceNotificationData;

        logger.info('notification', `📲 Ação recebida: ${actionId}`, { data });

        // Mapeia ação
        switch (actionId) {
          case 'start':
            get().acaoIniciar();
            break;
          case 'skip_today':
            get().acaoIgnorarHoje();
            break;
          case 'delay_10min':
            get().acaoDelay10Min();
            break;
          case 'pause':
            get().acaoPausar();
            break;
          case 'continue':
            get().acaoContinuar();
            break;
          case 'stop':
            get().acaoEncerrar();
            break;
          case Notifications.DEFAULT_ACTION_IDENTIFIER:
            // Usuário tocou na notificação (sem botão específico)
            // Abre o app - ação será decidida pelo popup
            break;
        }
      });

      set({ isInicializado: true });
      logger.info('boot', '✅ Work session store inicializado');
    } catch (error) {
      logger.error('session', 'Erro na inicialização', { error: String(error) });
      set({ isInicializado: true });
    }
  },

  handleGeofenceEnter: async (localId, localNome, coords) => {
    const { skippedToday, pendingAction } = get();
    const registroStore = useRegistroStore.getState();

    // Verifica se local foi ignorado hoje
    if (skippedToday.includes(localId)) {
      logger.info('session', `Local ignorado hoje: ${localNome}`);
      return;
    }

    // Verifica se já tem sessão ativa neste local
    const sessaoAtual = registroStore.sessaoAtual;
    if (sessaoAtual?.local_id === localId && sessaoAtual.status === 'ativa') {
      logger.debug('session', 'Já trabalhando neste local');
      return;
    }

    // Verifica se já tem sessão ativa em OUTRO local
    if (sessaoAtual && sessaoAtual.status === 'ativa' && sessaoAtual.local_id !== localId) {
      logger.warn('session', 'Sessão ativa em outro local - ignorando entrada', {
        localAtivo: sessaoAtual.local_id,
        novoLocal: localId,
      });
      return;
    }

    // Cancela pending anterior se houver
    if (pendingAction) {
      clearTimeout(pendingAction.timeoutId);
      await cancelarNotificacao(pendingAction.notificationId);
    }

    logger.info('session', `📍 ENTRADA: ${localNome}`);

    // Mostra notificação
    //const notificationId = await mostrarNotificacaoEntrada(localId, localNome);//

    const notificationId = '';

    // Configura auto-start em 30 segundos
    const timeoutId = setTimeout(async () => {
      logger.info('session', '⏱️ Auto-START (30s timeout)');
      await get().acaoIniciar();
      await mostrarNotificacaoAutoAcao(localNome, 'start');
    }, AUTO_ACTION_TIMEOUT);

    set({
      pendingAction: {
        type: 'enter',
        localId,
        localNome,
        notificationId,
        timeoutId,
        coords,
        startTime: Date.now(),
      },
    });
  },

  handleGeofenceExit: async (localId, localNome, coords) => {
    const { pendingAction } = get();
    const registroStore = useRegistroStore.getState();

    // Se tinha entrada pendente, cancela (saiu antes de decidir)
    if (pendingAction?.type === 'enter' && pendingAction.localId === localId) {
      clearTimeout(pendingAction.timeoutId);
      await cancelarNotificacao(pendingAction.notificationId);
      set({ pendingAction: null });
      logger.info('session', 'Entrada cancelada - saiu rapidamente');
      return;
    }

    // Verifica se está trabalhando neste local
    const sessaoAtual = registroStore.sessaoAtual;
    if (!sessaoAtual || sessaoAtual.local_id !== localId || sessaoAtual.status !== 'ativa') {
      logger.debug('session', 'Não estava trabalhando neste local');
      return;
    }

    // Cancela pending anterior se houver
    if (pendingAction) {
      clearTimeout(pendingAction.timeoutId);
      await cancelarNotificacao(pendingAction.notificationId);
    }

    logger.info('session', `🚪 SAÍDA: ${localNome}`);

    // Mostra notificação
    const notificationId = await mostrarNotificacaoSaida(localId, localNome);

    // Configura auto-STOP em 30 segundos
    const timeoutId = setTimeout(async () => {
      logger.info('session', '⏱️ Auto-STOP (30s timeout)');
      await get().acaoEncerrar();
      await mostrarNotificacaoAutoAcao(localNome, 'stop');
    }, AUTO_ACTION_TIMEOUT);

    set({
      pendingAction: {
        type: 'exit',
        localId,
        localNome,
        notificationId,
        timeoutId,
        coords,
        startTime: Date.now(),
      },
    });
  },

  acaoIniciar: async () => {
    const { pendingAction } = get();
    if (!pendingAction || pendingAction.type !== 'enter') return;

    logger.info('session', `▶️ INICIAR: ${pendingAction.localNome}`);

    // Limpa pending
    clearTimeout(pendingAction.timeoutId);
    await cancelarNotificacao(pendingAction.notificationId);

    // Registra entrada
    const registroStore = useRegistroStore.getState();
    await registroStore.registrarEntrada(
      pendingAction.localId,
      pendingAction.localNome,
      pendingAction.coords
    );

    set({ pendingAction: null });
  },

  acaoIgnorarHoje: () => {
    const { pendingAction, skippedToday } = get();
    if (!pendingAction) return;

    logger.info('session', `😴 IGNORAR HOJE: ${pendingAction.localNome}`);

    // Limpa pending
    clearTimeout(pendingAction.timeoutId);
    cancelarNotificacao(pendingAction.notificationId);

    // Adiciona à lista de ignorados
    set({
      pendingAction: null,
      skippedToday: [...skippedToday, pendingAction.localId],
    });
  },

  acaoDelay10Min: async () => {
    const { pendingAction, delayedStarts } = get();
    if (!pendingAction || pendingAction.type !== 'enter') return;

    logger.info('session', `⏰ DELAY 10 MIN: ${pendingAction.localNome}`);

    // Limpa pending atual
    clearTimeout(pendingAction.timeoutId);
    await cancelarNotificacao(pendingAction.notificationId);

    // Agenda lembrete
    const notificationId = await agendarLembreteInicio(
      pendingAction.localId,
      pendingAction.localNome,
      10
    );

    const newDelayed = new Map(delayedStarts);
    newDelayed.set(pendingAction.localId, notificationId);

    set({
      pendingAction: null,
      delayedStarts: newDelayed,
    });
  },

  acaoPausar: async () => {
    const { pendingAction } = get();
    if (!pendingAction || pendingAction.type !== 'exit') return;

    logger.info('session', `⏸️ PAUSAR: ${pendingAction.localNome}`);

    // Limpa pending
    clearTimeout(pendingAction.timeoutId);
    await cancelarNotificacao(pendingAction.notificationId);

    // Por enquanto, pausar = encerrar (simplificação)
    // TODO: Implementar estado de pausa real
    const registroStore = useRegistroStore.getState();
    await registroStore.registrarSaida(pendingAction.localId, pendingAction.coords);

    await mostrarNotificacaoAutoAcao(pendingAction.localNome, 'pause');

    set({ pendingAction: null });
  },

  acaoContinuar: () => {
    const { pendingAction } = get();
    if (!pendingAction || pendingAction.type !== 'exit') return;

    logger.info('session', `▶️ CONTINUAR: ${pendingAction.localNome}`);

    // Limpa pending sem fazer nada (continua contando)
    clearTimeout(pendingAction.timeoutId);
    cancelarNotificacao(pendingAction.notificationId);

    set({ pendingAction: null });
  },

  acaoEncerrar: async () => {
    const { pendingAction } = get();
    if (!pendingAction || pendingAction.type !== 'exit') return;

    logger.info('session', `⏹️ ENCERRAR: ${pendingAction.localNome}`);

    // Limpa pending
    clearTimeout(pendingAction.timeoutId);
    await cancelarNotificacao(pendingAction.notificationId);

    // Registra saída
    const registroStore = useRegistroStore.getState();
    await registroStore.registrarSaida(pendingAction.localId, pendingAction.coords);

    set({ pendingAction: null });
  },

  acaoEncerrarComAjuste: async (minutosAtras) => {
    const { pendingAction } = get();
    if (!pendingAction || pendingAction.type !== 'exit') return;

    logger.info('session', `⏹️ ENCERRAR (há ${minutosAtras} min): ${pendingAction.localNome}`);

    // Limpa pending
    clearTimeout(pendingAction.timeoutId);
    await cancelarNotificacao(pendingAction.notificationId);

    // Registra saída com ajuste negativo
    const registroStore = useRegistroStore.getState();
    await registroStore.registrarSaidaComAjuste(
      pendingAction.localId,
      pendingAction.coords,
      -minutosAtras // Negativo = desconta tempo
    );

    set({ pendingAction: null });
  },

  limparPending: () => {
    const { pendingAction } = get();
    if (pendingAction) {
      clearTimeout(pendingAction.timeoutId);
      cancelarNotificacao(pendingAction.notificationId);
    }
    set({ pendingAction: null });
  },

  resetSkippedToday: () => {
    set({ skippedToday: [], delayedStarts: new Map() });
    logger.info('session', 'Lista de ignorados resetada');
  },

  getTempoRestante: () => {
    const { pendingAction } = get();
    if (!pendingAction) return 0;
    
    const elapsed = Date.now() - pendingAction.startTime;
    const remaining = Math.max(0, AUTO_ACTION_TIMEOUT - elapsed);
    return Math.ceil(remaining / 1000);
  },
}));
