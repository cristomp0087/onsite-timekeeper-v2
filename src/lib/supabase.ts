/**
 * Cliente Supabase
 * 
 * Configuração do cliente com storage compatível
 * para React Native (AsyncStorage) e Web (localStorage)
 */

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ============================================
// CREDENCIAIS - MÚLTIPLAS FONTES
// ============================================

// 1. process.env - funciona no Expo Go com .env
// 2. Constants.expoConfig.extra - funciona no EAS Build
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL 
  || Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL 
  || '';

const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY 
  || Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY 
  || '';

// Log de debug na inicialização
console.log('🔑 Supabase URL:', supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'NÃO CONFIGURADO');
console.log('🔑 Supabase Key:', supabaseAnonKey ? `${supabaseAnonKey.substring(0, 20)}...` : 'NÃO CONFIGURADO');
console.log('📦 Source:', process.env.EXPO_PUBLIC_SUPABASE_URL ? 'process.env' : (Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL ? 'Constants.extra' : 'NONE'));

// Validação em dev
if (__DEV__ && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn(
    '⚠️ Supabase credentials not configured!\n' +
    'For Expo Go: Create a .env file\n' +
    'For EAS Build: Add to app.json extra\n' +
    'EXPO_PUBLIC_SUPABASE_URL=your_url\n' +
    'EXPO_PUBLIC_SUPABASE_ANON_KEY=your_key'
  );
}

// ============================================
// STORAGE ADAPTER
// ============================================

const customStorage = Platform.OS === 'web'
  ? {
      getItem: (key: string) => {
        if (typeof window !== 'undefined') {
          return Promise.resolve(window.localStorage.getItem(key));
        }
        return Promise.resolve(null);
      },
      setItem: (key: string, value: string) => {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, value);
        }
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(key);
        }
        return Promise.resolve();
      },
    }
  : AsyncStorage;

// ============================================
// CLIENTE SUPABASE
// ============================================

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ============================================
// HELPERS
// ============================================

/**
 * Verifica se Supabase está configurado
 */
export function isSupabaseConfigured(): boolean {
  const configured = Boolean(supabaseUrl && supabaseAnonKey);
  return configured;
}

/**
 * Retorna config do Supabase para debug
 */
export function getSupabaseConfig() {
  return {
    url: supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'NOT SET',
    keySet: supabaseAnonKey ? 'YES' : 'NO',
    source: process.env.EXPO_PUBLIC_SUPABASE_URL 
      ? 'process.env' 
      : (Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL ? 'Constants.extra' : 'NONE'),
    isConfigured: isSupabaseConfigured(),
  };
}

// ============================================
// TIPOS DO BANCO DE DADOS
// ============================================

export interface Database {
  public: {
    Tables: {
      locais: {
        Row: {
          id: string;
          user_id: string;
          nome: string;
          latitude: number;
          longitude: number;
          raio: number;
          cor: string;
          status: 'active' | 'deleted' | 'pending_delete' | 'syncing';
          deleted_at: string | null;
          last_seen_at: string;
          created_at: string;
          updated_at: string;
          synced_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['locais']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['locais']['Insert']>;
      };
      registros: {
        Row: {
          id: string;
          user_id: string;
          local_id: string;
          local_nome: string | null;
          entrada: string;
          saida: string | null;
          tipo: 'automatico' | 'manual';
          editado_manualmente: boolean;
          motivo_edicao: string | null;
          hash_integridade: string | null;
          cor: string | null;
          device_id: string | null;
          created_at: string;
          synced_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['registros']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['registros']['Insert']>;
      };
      sync_log: {
        Row: {
          id: string;
          user_id: string;
          entity_type: 'local' | 'registro';
          entity_id: string;
          action: 'create' | 'update' | 'delete' | 'sync_up' | 'sync_down';
          old_value: string | null;
          new_value: string | null;
          sync_status: 'pending' | 'synced' | 'conflict' | 'failed';
          error_message: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['sync_log']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['sync_log']['Insert']>;
      };
    };
  };
}
