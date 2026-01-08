/**
 * Auth Store - OnSite Timekeeper
 * 
 * Manages authentication with Supabase
 * - Login/Logout
 * - User registration
 * - Persistent session
 * - Registers auth events for audit
 * - Persists userId for background tasks
 * 
 * REFACTORED: All PT names converted to EN
 */

import { create } from 'zustand';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';
import { incrementTelemetry } from '../lib/database';
import { 
  setBackgroundUserId, 
  clearBackgroundUserId,
  startHeartbeat,
  stopHeartbeat,
} from '../lib/backgroundTasks';
import type { User, Session } from '@supabase/supabase-js';

// ============================================
// TYPES
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
// HELPER: Register Auth Event
// ============================================

async function registerAuthEvent(
  eventType: AuthEventType,
  userId: string | null,
  eventData?: AuthEventData
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const deviceInfo = {
      model: Device.modelName || 'unknown',
      brand: Device.brand || 'unknown',
      os: Platform.OS,
      osVersion: Platform.Version?.toString() || 'unknown',
    };

    const appVersion = Application.nativeApplicationVersion || 'unknown';
    const osVersion = `${Platform.OS} ${Platform.Version}`;

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
      logger.warn('auth', 'Error registering auth event', { error: error.message });
    } else {
      logger.debug('auth', `📊 Auth event registered: ${eventType}`);
    }
  } catch (error) {
    logger.warn('auth', 'Exception registering auth event', { error: String(error) });
  }
}

// ============================================
// HELPER: Configure Background after Login
// ============================================

async function configureBackgroundForUser(userId: string): Promise<void> {
  try {
    // 1. Persist userId for background tasks
    await setBackgroundUserId(userId);
    logger.debug('auth', '✅ UserId saved for background');

    // 2. Start heartbeat (safety net)
    const heartbeatStarted = await startHeartbeat();
    if (heartbeatStarted) {
      logger.debug('auth', '✅ Heartbeat started');
    } else {
      logger.warn('auth', '⚠️ Heartbeat could not be started');
    }
  } catch (error) {
    logger.error('auth', 'Error configuring background', { error: String(error) });
  }
}

// ============================================
// HELPER: Clear Background after Logout
// ============================================

async function clearBackgroundForUser(): Promise<void> {
  try {
    // 1. Stop heartbeat
    await stopHeartbeat();
    logger.debug('auth', '✅ Heartbeat stopped');

    // 2. Remove userId from background
    await clearBackgroundUserId();
    logger.debug('auth', '✅ UserId removed from background');
  } catch (error) {
    logger.error('auth', 'Error clearing background', { error: String(error) });
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
      logger.info('boot', '🔐 Initializing authentication...');

      if (!isSupabaseConfigured()) {
        logger.warn('auth', 'Supabase not configured - offline mode');
        set({ isLoading: false });
        return;
      }

      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        logger.error('auth', 'Error restoring session', { error: error.message });
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
        
        logger.info('auth', '✅ Session restored', { 
          userId: session.user.id,
          email: session.user.email 
        });

        // ========================================
        // Configure background for user
        // ========================================
        await configureBackgroundForUser(session.user.id);

        // Register event
        await registerAuthEvent('session_restored', session.user.id, {
          email: session.user.email,
        });

        // Increment app_opens
        await incrementTelemetry(session.user.id, 'app_opens');
      } else {
        set({ isLoading: false });
        logger.info('auth', 'No active session');
      }

      // Listener for auth changes
      supabase.auth.onAuthStateChange(async (event, session) => {
        logger.debug('auth', `Auth event: ${event}`);
        
        if (event === 'INITIAL_SESSION') {
          return;
        }
        
        set({
          user: session?.user ?? null,
          session: session ?? null,
          isAuthenticated: !!session,
        });

        // ========================================
        // Update background based on event
        // ========================================
        if (event === 'SIGNED_IN' && session?.user) {
          logger.info('auth', '✅ Login completed');
          await configureBackgroundForUser(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          logger.info('auth', '👋 Logout completed');
          await clearBackgroundForUser();
        }
      });
    } catch (error) {
      logger.error('auth', 'Initialization error', { error: String(error) });
      set({ isLoading: false });
    }
  },

  signIn: async (email: string, password: string) => {
    try {
      logger.info('auth', '🔑 Attempting login...', { email });

      if (!isSupabaseConfigured()) {
        return { error: 'Supabase not configured' };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        logger.warn('auth', '❌ Login failed', { error: error.message });
        
        await registerAuthEvent('login_failed', null, {
          email,
          error: error.message,
        });
        
        let message = error.message;
        if (error.message.includes('Invalid login')) {
          message = 'Incorrect email or password';
        } else if (error.message.includes('Email not confirmed')) {
          message = 'Confirm your email before logging in';
        }
        
        return { error: message };
      }

      set({
        user: data.user,
        session: data.session,
        isAuthenticated: true,
      });

      // ========================================
      // Configure background for user
      // ========================================
      if (data.user?.id) {
        await configureBackgroundForUser(data.user.id);
      }

      await registerAuthEvent('login', data.user?.id || null, {
        email,
        method: 'password',
      });

      if (data.user?.id) {
        await incrementTelemetry(data.user.id, 'app_opens');
      }

      logger.info('auth', '✅ Login successful', { userId: data.user?.id });
      return { error: null };
    } catch (error) {
      logger.error('auth', 'Login error', { error: String(error) });
      return { error: 'Error logging in. Try again.' };
    }
  },

  signUp: async (email: string, password: string, nome: string) => {
    try {
      logger.info('auth', '📝 Registering new user...', { email });

      if (!isSupabaseConfigured()) {
        return { error: 'Supabase not configured' };
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { nome },
        },
      });

      if (error) {
        logger.warn('auth', '❌ Registration failed', { error: error.message });
        
        let message = error.message;
        if (error.message.includes('already registered')) {
          message = 'This email is already registered';
        } else if (error.message.includes('Password')) {
          message = 'Password must be at least 6 characters';
        }
        
        return { error: message };
      }

      await registerAuthEvent('signup', data.user?.id || null, {
        email,
        nome,
        requires_confirmation: !data.session,
      });

      // Supabase may require email confirmation
      if (data.user && !data.session) {
        logger.info('auth', '📧 Confirmation email sent');
        return { error: null };
      }

      if (data.session) {
        set({
          user: data.user,
          session: data.session,
          isAuthenticated: true,
        });

        // ========================================
        // Configure background for user
        // ========================================
        if (data.user?.id) {
          await configureBackgroundForUser(data.user.id);
          await incrementTelemetry(data.user.id, 'app_opens');
        }
      }

      logger.info('auth', '✅ Registration successful', { userId: data.user?.id });
      return { error: null };
    } catch (error) {
      logger.error('auth', 'Registration error', { error: String(error) });
      return { error: 'Error creating account. Try again.' };
    }
  },

  signOut: async () => {
    try {
      logger.info('auth', '🚪 Logging out...');

      const userId = get().user?.id || null;
      const userEmail = get().user?.email;

      // Register logout BEFORE clearing
      await registerAuthEvent('logout', userId, {
        email: userEmail,
      });

      // ========================================
      // Clear background BEFORE logout
      // ========================================
      await clearBackgroundForUser();

      if (isSupabaseConfigured()) {
        await supabase.auth.signOut();
      }

      set({
        user: null,
        session: null,
        isAuthenticated: false,
      });

      logger.info('auth', '✅ Logout completed');
    } catch (error) {
      logger.error('auth', 'Logout error', { error: String(error) });
      // Force local logout even if it fails
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
