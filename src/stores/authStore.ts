/**
 * Auth Store - OnSite Timekeeper V2
 * 
 * Handles authentication state and user session.
 * BACKWARD COMPATIBLE with V1 API
 */

import { create } from 'zustand';
import { AppState, AppStateStatus } from 'react-native';
import { logger } from '../lib/logger';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { initDatabase, trackMetric } from '../lib/database';
import { setBackgroundUserId, clearBackgroundUserId } from '../lib/backgroundTasks';
import type { Session, User } from '@supabase/supabase-js';

// ============================================
// TYPES
// ============================================

export interface AuthState {
  // State
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  
  // Actions
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  
  // Helpers
  getUserId: () => string | null;
  getUserEmail: () => string | null;
  getUserName: () => string | null;
  isAuthenticated: () => boolean;
}

// ============================================
// STORE
// ============================================

export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  session: null,
  user: null,
  isLoading: true,
  isInitialized: false,
  error: null,

  // ============================================
  // INITIALIZE
  // ============================================
  initialize: async () => {
    logger.info('boot', '🔐 Initializing auth store V2...');
    set({ isLoading: true, error: null });

    try {
      // Initialize database first
      await initDatabase();

      // Check if Supabase is configured
      if (!isSupabaseConfigured()) {
        logger.warn('auth', 'Supabase not configured - running in offline mode');
        set({ isLoading: false, isInitialized: true });
        return;
      }

      // Get existing session
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        logger.error('auth', 'Error getting session', { error: error.message });
        set({ isLoading: false, isInitialized: true, error: error.message });
        return;
      }

      if (session) {
        logger.info('auth', `✅ Session found: ${session.user.email}`);
        set({ session, user: session.user });
        
        // Set userId for background tasks
        await setBackgroundUserId(session.user.id);

        // V2: Track app open
        try {
          await trackMetric(session.user.id, 'app_opens');
        } catch (e) {
          // Ignore tracking errors
        }
      } else {
        logger.info('auth', 'No active session');
      }

      // Listen for auth changes
      supabase.auth.onAuthStateChange(async (event, newSession) => {
        logger.info('auth', `Auth state change: ${event}`);

        if (event === 'SIGNED_IN' && newSession) {
          set({ session: newSession, user: newSession.user, error: null });
          await setBackgroundUserId(newSession.user.id);
          
          // V2: Track app open on sign in
          try {
            await trackMetric(newSession.user.id, 'app_opens');
          } catch (e) {
            // Ignore tracking errors
          }
        }

        if (event === 'SIGNED_OUT') {
          set({ session: null, user: null });
          await clearBackgroundUserId();
        }

        if (event === 'TOKEN_REFRESHED' && newSession) {
          set({ session: newSession, user: newSession.user });
        }
      });

      // Setup app state listener for tracking
      AppState.addEventListener('change', async (state: AppStateStatus) => {
        if (state === 'active') {
          const userId = get().getUserId();
          if (userId) {
            // V2: Track when app comes to foreground
            try {
              await trackMetric(userId, 'app_opens');
            } catch (e) {
              // Ignore tracking errors
            }
          }
          
          // Refresh session when app becomes active
          await get().refreshSession();
        }
      });

      set({ isLoading: false, isInitialized: true });
      logger.info('boot', '✅ Auth store V2 initialized');

    } catch (error) {
      const errorMsg = String(error);
      logger.error('auth', 'Error initializing auth', { error: errorMsg });
      set({ isLoading: false, isInitialized: true, error: errorMsg });
    }
  },

  // ============================================
  // SIGN IN
  // ============================================
  signIn: async (email, password) => {
    set({ isLoading: true, error: null });

    try {
      if (!isSupabaseConfigured()) {
        set({ isLoading: false });
        return { success: false, error: 'Supabase not configured' };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        logger.error('auth', 'Sign in error', { error: error.message });
        set({ isLoading: false, error: error.message });
        return { success: false, error: error.message };
      }

      if (data.session) {
        logger.info('auth', `✅ Signed in: ${data.session.user.email}`);
        set({ 
          session: data.session, 
          user: data.session.user, 
          isLoading: false,
          error: null,
        });
        
        await setBackgroundUserId(data.session.user.id);
        
        // V2: Track sign in as app open
        try {
          await trackMetric(data.session.user.id, 'app_opens');
        } catch (e) {
          // Ignore tracking errors
        }
        
        return { success: true };
      }

      set({ isLoading: false });
      return { success: false, error: 'No session returned' };

    } catch (error) {
      const errorMsg = String(error);
      logger.error('auth', 'Sign in exception', { error: errorMsg });
      set({ isLoading: false, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  },

  // ============================================
  // SIGN UP
  // ============================================
  signUp: async (email, password) => {
    set({ isLoading: true, error: null });

    try {
      if (!isSupabaseConfigured()) {
        set({ isLoading: false });
        return { success: false, error: 'Supabase not configured' };
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        logger.error('auth', 'Sign up error', { error: error.message });
        set({ isLoading: false, error: error.message });
        return { success: false, error: error.message };
      }

      if (data.session) {
        logger.info('auth', `✅ Signed up and logged in: ${data.session.user.email}`);
        set({ 
          session: data.session, 
          user: data.session.user, 
          isLoading: false,
          error: null,
        });
        
        await setBackgroundUserId(data.session.user.id);
        
        // V2: Track first app open
        try {
          await trackMetric(data.session.user.id, 'app_opens');
        } catch (e) {
          // Ignore tracking errors
        }
        
        return { success: true };
      }

      // Email confirmation required
      if (data.user && !data.session) {
        logger.info('auth', 'Email confirmation required');
        set({ isLoading: false });
        return { success: true }; // Success but need to confirm email
      }

      set({ isLoading: false });
      return { success: false, error: 'Unknown error during sign up' };

    } catch (error) {
      const errorMsg = String(error);
      logger.error('auth', 'Sign up exception', { error: errorMsg });
      set({ isLoading: false, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  },

  // ============================================
  // SIGN OUT
  // ============================================
  signOut: async () => {
    set({ isLoading: true });

    try {
      if (isSupabaseConfigured()) {
        await supabase.auth.signOut();
      }

      await clearBackgroundUserId();

      set({ 
        session: null, 
        user: null, 
        isLoading: false,
        error: null,
      });

      logger.info('auth', '👋 Signed out');

    } catch (error) {
      logger.error('auth', 'Sign out error', { error: String(error) });
      
      // Force clear state even on error
      set({ 
        session: null, 
        user: null, 
        isLoading: false,
      });
    }
  },

  // ============================================
  // REFRESH SESSION
  // ============================================
  refreshSession: async () => {
    if (!isSupabaseConfigured()) return;

    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        logger.warn('auth', 'Session refresh error', { error: error.message });
        return;
      }

      if (session) {
        set({ session, user: session.user });
      }
    } catch (error) {
      logger.error('auth', 'Session refresh exception', { error: String(error) });
    }
  },

  // ============================================
  // HELPERS (BACKWARD COMPATIBLE)
  // ============================================
  getUserId: () => {
    return get().user?.id || null;
  },

  getUserEmail: () => {
    return get().user?.email || null;
  },

  getUserName: () => {
    // Try to get name from user metadata, fallback to email prefix
    const user = get().user;
    if (!user) return null;
    
    // Check user_metadata for name
    const metadata = user.user_metadata;
    if (metadata?.name) return metadata.name;
    if (metadata?.full_name) return metadata.full_name;
    if (metadata?.display_name) return metadata.display_name;
    
    // Fallback to email prefix
    if (user.email) {
      return user.email.split('@')[0];
    }
    
    return null;
  },

  isAuthenticated: () => {
    return !!get().session;
  },
}));
