/**
 * Settings Store - OnSite Timekeeper v2
 * 
 * User preferences:
 * - Timer configurations (entry, exit, pause, adjustment)
 * - Notification preferences
 * - Auto-action toggles
 * - Geofencing defaults
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../lib/logger';

// ============================================
// TYPES
// ============================================

interface SettingsState {
  // Timer configurations (NEW)
  entryTimeoutMinutes: number;      // Minutes before auto-start on entry (default: 5)
  exitTimeoutSeconds: number;       // Seconds before auto-stop on exit (default: 15)
  returnTimeoutMinutes: number;     // Minutes before auto-resume on return (default: 5)
  pauseLimitMinutes: number;        // Max pause duration before auto-stop (default: 30)
  exitAdjustmentMinutes: number;    // Minutes to deduct on auto-exit (default: 10)

  // Notifications
  notificacoesAtivas: boolean;
  somNotificacao: boolean;
  vibracaoNotificacao: boolean;
  
  // Auto-action toggles
  autoStartHabilitado: boolean;
  autoStopHabilitado: boolean;
  
  // Geofencing
  raioDefault: number;              // Default radius in meters
  distanciaMinimaLocais: number;    // Minimum distance between locations
  
  // Debug
  devMonitorHabilitado: boolean;

  // Actions
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  updateSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  resetSettings: () => Promise<void>;
  
  // Computed getters for workSessionStore
  getEntryTimeoutMs: () => number;
  getExitTimeoutMs: () => number;
  getReturnTimeoutMs: () => number;
  getPauseLimitMs: () => number;
  getExitAdjustment: () => number;
}

// ============================================
// DEFAULTS
// ============================================

const DEFAULT_SETTINGS = {
  // Timer configurations
  entryTimeoutMinutes: 5,
  exitTimeoutSeconds: 15,
  returnTimeoutMinutes: 5,
  pauseLimitMinutes: 30,
  exitAdjustmentMinutes: 10,

  // Notifications
  notificacoesAtivas: true,
  somNotificacao: true,
  vibracaoNotificacao: true,
  
  // Auto-action
  autoStartHabilitado: true,
  autoStopHabilitado: true,
  
  // Geofencing
  raioDefault: 100,
  distanciaMinimaLocais: 50,
  
  // Debug
  devMonitorHabilitado: __DEV__,
};

const STORAGE_KEY = '@onsite_settings';

// ============================================
// STORE
// ============================================

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,

  loadSettings: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new settings added in updates
        set({ ...DEFAULT_SETTINGS, ...parsed });
        logger.info('boot', '⚙️ Settings loaded');
      }
    } catch (error) {
      logger.error('database', 'Error loading settings', { error: String(error) });
    }
  },

  saveSettings: async () => {
    try {
      const state = get();
      const toSave = {
        // Timer configurations
        entryTimeoutMinutes: state.entryTimeoutMinutes,
        exitTimeoutSeconds: state.exitTimeoutSeconds,
        returnTimeoutMinutes: state.returnTimeoutMinutes,
        pauseLimitMinutes: state.pauseLimitMinutes,
        exitAdjustmentMinutes: state.exitAdjustmentMinutes,
        
        // Notifications
        notificacoesAtivas: state.notificacoesAtivas,
        somNotificacao: state.somNotificacao,
        vibracaoNotificacao: state.vibracaoNotificacao,
        
        // Auto-action
        autoStartHabilitado: state.autoStartHabilitado,
        autoStopHabilitado: state.autoStopHabilitado,
        
        // Geofencing
        raioDefault: state.raioDefault,
        distanciaMinimaLocais: state.distanciaMinimaLocais,
        
        // Debug
        devMonitorHabilitado: state.devMonitorHabilitado,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      logger.debug('database', 'Settings saved');
    } catch (error) {
      logger.error('database', 'Error saving settings', { error: String(error) });
    }
  },

  updateSetting: (key, value) => {
    set({ [key]: value } as any);
    get().saveSettings();
  },

  resetSettings: async () => {
    set(DEFAULT_SETTINGS);
    await AsyncStorage.removeItem(STORAGE_KEY);
    logger.info('database', 'Settings reset to defaults');
  },

  // ============================================
  // COMPUTED GETTERS (for workSessionStore)
  // ============================================
  
  getEntryTimeoutMs: () => {
    return get().entryTimeoutMinutes * 60 * 1000;
  },

  getExitTimeoutMs: () => {
    return get().exitTimeoutSeconds * 1000;
  },

  getReturnTimeoutMs: () => {
    return get().returnTimeoutMinutes * 60 * 1000;
  },

  getPauseLimitMs: () => {
    return get().pauseLimitMinutes * 60 * 1000;
  },

  getExitAdjustment: () => {
    return -get().exitAdjustmentMinutes; // Negative for time deduction
  },
}));
