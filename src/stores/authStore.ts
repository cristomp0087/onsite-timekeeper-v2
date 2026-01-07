/**
 * Auth Store - OnSite Timekeeper
 * 
 * Gerencia autenticação com Supabase
 * - Login/Logout
 * - Registro de usuário
 * - Sessão persistente
 * - NOVO: Registra auth events para auditoria
 */

import { create } from 'zustand';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';
import { incrementarTelemetria } from '../lib/database';
import type { User, Session } from '@supabase/supabase-js';

// ============================================
// TIPOS
// ============================================

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  // Actions
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, nome: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  
  // Helpers
  getUserId: () => string | null;
  getUserEmail: () => string | null;
  getUserName: () => string | null;
}

// ============================================
// AUTH EVENT TYPES
// ============================================

type AuthEventType = 
  | 'signup'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'session_restored'
  | 'password_reset_requested';

interface AuthEventData {
  email?: string;
  error?: string;
  method?: string;
  [key: string]: unknown;
}

// ============================================
// HELPER: Registrar Auth Event
// ============================================

async function registrarAuthEvent(
  eventType: AuthEventType,
  userId: string | null,
  eventData?: AuthEventData
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    // Coleta info do device
    const deviceInfo = {
      model: Device.modelName || 'unknown',
      brand: Device.brand || 'unknown',
      os: Platform.OS,
      osVersion: Platform.Version?.toString() || 'unknown',
    };

    const appVersion = Application.nativeApplicationVersion || 'unknown';
    const osVersion = `${Platform.OS} ${Platform.Version}`;

    // Insere na tabela app_events
    const { error } = await supabase.from('app_events').insert({
      user_id: userId,
      event_type: eventType,
      event_data: {
        ...eventData,
        device: deviceInfo,
        app: 'timekeeper',
      },
      app_version: appVersion,
      os_version: osVersion,
      device_id: Device.deviceName || null,
    });

    if (error) {
      logger.warn('auth', 'Erro ao registrar auth event', { error: error.message });
    } else {
      logger.debug('auth', `📊 Auth event registrado: ${eventType}`);
    }
  } catch (error) {
    // Não falha silenciosamente, mas não bloqueia o fluxo
    logger.warn('auth', 'Exceção ao registrar auth event', { error: String(error) });
  }
}

// ============================================
// STORE
// ============================================

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    try {
      logger.info('boot', '🔐 Inicializando autenticação...');

      // Verifica se Supabase está configurado
      if (!isSupabaseConfigured()) {
        logger.warn('auth', 'Supabase não configurado - modo offline');
        set({ isLoading: false });
        return;
      }

      // Tenta restaurar sessão existente
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        logger.error('auth', 'Erro ao restaurar sessão', { error: error.message });
        set({ isLoading: false });
        return;
      }

      if (session) {
        set({
          user: session.user,
          session,
          isAuthenticated: true,
          isLoading: false,
        });
        
        logger.info('auth', '✅ Sessão restaurada', { 
          userId: session.user.id,
          email: session.user.email 
        });

        // Registra evento de sessão restaurada
        await registrarAuthEvent('session_restored', session.user.id, {
          email: session.user.email,
        });

        // Incrementa app_opens na telemetria
        await incrementarTelemetria(session.user.id, 'app_opens');
      } else {
        set({ isLoading: false });
        logger.info('auth', 'Nenhuma sessão ativa');
      }

      // Listener para mudanças de autenticação
      supabase.auth.onAuthStateChange((event, session) => {
        logger.debug('auth', `Auth event: ${event}`);
        
        // Ignora INITIAL_SESSION pois já tratamos no getSession()
        if (event === 'INITIAL_SESSION') {
          return;
        }
        
        set({
          user: session?.user ?? null,
          session: session ?? null,
          isAuthenticated: !!session,
        });

        if (event === 'SIGNED_IN') {
          logger.info('auth', '✅ Login realizado');
        } else if (event === 'SIGNED_OUT') {
          logger.info('auth', '👋 Logout realizado');
        }
      });
    } catch (error) {
      logger.error('auth', 'Erro na inicialização', { error: String(error) });
      set({ isLoading: false });
    }
  },

  signIn: async (email: string, password: string) => {
    try {
      logger.info('auth', '🔑 Tentando login...', { email });

      if (!isSupabaseConfigured()) {
        return { error: 'Supabase não configurado' };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        logger.warn('auth', '❌ Falha no login', { error: error.message });
        
        // Registra falha de login
        await registrarAuthEvent('login_failed', null, {
          email,
          error: error.message,
        });
        
        // Traduz mensagens de erro comuns
        let mensagem = error.message;
        if (error.message.includes('Invalid login')) {
          mensagem = 'Email ou senha incorretos';
        } else if (error.message.includes('Email not confirmed')) {
          mensagem = 'Confirme seu email antes de fazer login';
        }
        
        return { error: mensagem };
      }

      set({
        user: data.user,
        session: data.session,
        isAuthenticated: true,
      });

      // Registra login bem-sucedido
      await registrarAuthEvent('login', data.user?.id || null, {
        email,
        method: 'password',
      });

      // Incrementa app_opens na telemetria
      if (data.user?.id) {
        await incrementarTelemetria(data.user.id, 'app_opens');
      }

      logger.info('auth', '✅ Login bem-sucedido', { userId: data.user?.id });
      return { error: null };
    } catch (error) {
      logger.error('auth', 'Erro no login', { error: String(error) });
      return { error: 'Erro ao fazer login. Tente novamente.' };
    }
  },

  signUp: async (email: string, password: string, nome: string) => {
    try {
      logger.info('auth', '📝 Registrando novo usuário...', { email });

      if (!isSupabaseConfigured()) {
        return { error: 'Supabase não configurado' };
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { nome },
        },
      });

      if (error) {
        logger.warn('auth', '❌ Falha no registro', { error: error.message });
        
        let mensagem = error.message;
        if (error.message.includes('already registered')) {
          mensagem = 'Este email já está cadastrado';
        } else if (error.message.includes('Password')) {
          mensagem = 'Senha deve ter pelo menos 6 caracteres';
        }
        
        return { error: mensagem };
      }

      // Registra signup
      await registrarAuthEvent('signup', data.user?.id || null, {
        email,
        nome,
        requires_confirmation: !data.session,
      });

      // Supabase pode requerer confirmação de email
      if (data.user && !data.session) {
        logger.info('auth', '📧 Email de confirmação enviado');
        return { error: null };
      }

      if (data.session) {
        set({
          user: data.user,
          session: data.session,
          isAuthenticated: true,
        });

        // Incrementa app_opens na telemetria
        if (data.user?.id) {
          await incrementarTelemetria(data.user.id, 'app_opens');
        }
      }

      logger.info('auth', '✅ Registro bem-sucedido', { userId: data.user?.id });
      return { error: null };
    } catch (error) {
      logger.error('auth', 'Erro no registro', { error: String(error) });
      return { error: 'Erro ao criar conta. Tente novamente.' };
    }
  },

  signOut: async () => {
    try {
      logger.info('auth', '🚪 Fazendo logout...');

      const userId = get().user?.id || null;
      const userEmail = get().user?.email;

      // Registra logout ANTES de limpar o state
      await registrarAuthEvent('logout', userId, {
        email: userEmail,
      });

      if (isSupabaseConfigured()) {
        await supabase.auth.signOut();
      }

      set({
        user: null,
        session: null,
        isAuthenticated: false,
      });

      logger.info('auth', '✅ Logout realizado');
    } catch (error) {
      logger.error('auth', 'Erro no logout', { error: String(error) });
      // Força logout local mesmo se falhar no servidor
      set({
        user: null,
        session: null,
        isAuthenticated: false,
      });
    }
  },

  getUserId: () => {
    return get().user?.id ?? null;
  },

  getUserEmail: () => {
    return get().user?.email ?? null;
  },

  getUserName: () => {
    return get().user?.user_metadata?.nome ?? null;
  },
}));
