/**
 * Settings Store - OnSite Timekeeper v2
 * 
 * User preferences:
 * - Timer configurations (entry, exit, pause, adjustment)
 * - Notification preferences
 * - Auto-action toggles
 * - Geofencing defaults
 * - Favorite contact for quick export
 * - Report reminder scheduling
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../lib/logger';

// ============================================
// TYPES
// ============================================

export interface FavoriteContact {
  type: 'whatsapp' | 'email';
  value: string;       // phone number or email address
  name?: string;       // optional label (e.g., "Supervisor")
}

export interface ReportReminder {
  enabled: boolean;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  dayOfWeek: number;   // 0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday
  hour: number;        // 0-23
  minute: number;      // 0-59
}

interface SettingsState {
  // Timer configurations
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
  
  // Auto-Report (NEW)
  favoriteContact: FavoriteContact | null;
  reportReminder: ReportReminder;
  
  // Pending export from notification (NEW)
  pendingReportExport: {
    trigger: boolean;
    periodStart?: string;
    periodEnd?: string;
  } | null;
  
  // Debug
  devMonitorHabilitado: boolean;

  // Actions
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  updateSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  resetSettings: () => Promise<void>;
  
  // Favorite Contact actions (NEW)
  setFavoriteContact: (contact: FavoriteContact | null) => void;
  clearFavoriteContact: () => void;
  
  // Report Reminder actions (NEW)
  updateReportReminder: (updates: Partial<ReportReminder>) => void;
  toggleReportReminder: (enabled: boolean) => void;
  
  // Pending export actions (NEW)
  setPendingReportExport: (data: { periodStart?: string; periodEnd?: string } | null) => void;
  clearPendingReportExport: () => void;
  
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

const DEFAULT_REPORT_REMINDER: ReportReminder = {
  enabled: false,
  frequency: 'weekly',
  dayOfWeek: 5,  // Friday
  hour: 18,
  minute: 0,
};

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
  
  // Auto-Report (NEW)
  favoriteContact: null as FavoriteContact | null,
  reportReminder: DEFAULT_REPORT_REMINDER,
  
  // Pending export (NEW) - not persisted
  pendingReportExport: null as { trigger: boolean; periodStart?: string; periodEnd?: string } | null,
  
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
        set({ 
          ...DEFAULT_SETTINGS, 
          ...parsed,
          // Ensure nested objects are properly merged
          reportReminder: {
            ...DEFAULT_REPORT_REMINDER,
            ...(parsed.reportReminder || {}),
          },
        });
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
        
        // Auto-Report (NEW)
        favoriteContact: state.favoriteContact,
        reportReminder: state.reportReminder,
        
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
  // FAVORITE CONTACT ACTIONS (NEW)
  // ============================================

  setFavoriteContact: (contact) => {
    set({ favoriteContact: contact });
    get().saveSettings();
    logger.info('database', '👤 Favorite contact saved', { 
      type: contact?.type, 
      hasName: !!contact?.name 
    });
  },

  clearFavoriteContact: () => {
    set({ favoriteContact: null });
    get().saveSettings();
    logger.info('database', '👤 Favorite contact cleared');
  },

  // ============================================
  // REPORT REMINDER ACTIONS (NEW)
  // ============================================

  updateReportReminder: (updates) => {
    const current = get().reportReminder;
    const updated = { ...current, ...updates };
    set({ reportReminder: updated });
    get().saveSettings();
    logger.info('database', '🔔 Report reminder updated', updates);
  },

  toggleReportReminder: (enabled) => {
    const current = get().reportReminder;
    set({ reportReminder: { ...current, enabled } });
    get().saveSettings();
    logger.info('database', `🔔 Report reminder ${enabled ? 'enabled' : 'disabled'}`);
  },

  // ============================================
  // PENDING REPORT EXPORT ACTIONS (NEW)
  // ============================================

  setPendingReportExport: (data) => {
    if (data) {
      set({ pendingReportExport: { trigger: true, ...data } });
      logger.info('database', '📤 Pending report export set', data);
    } else {
      set({ pendingReportExport: null });
    }
  },

  clearPendingReportExport: () => {
    set({ pendingReportExport: null });
    logger.debug('database', '📤 Pending report export cleared');
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

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get the label for a day of week
 */
export function getDayLabel(dayOfWeek: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek] || 'Friday';
}

/**
 * Get short label for a day of week
 */
export function getDayShortLabel(dayOfWeek: number): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[dayOfWeek] || 'Fri';
}

/**
 * Format time as HH:MM
 */
export function formatReminderTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

/**
 * Get frequency label
 */
export function getFrequencyLabel(frequency: ReportReminder['frequency']): string {
  switch (frequency) {
    case 'weekly': return 'Weekly';
    case 'biweekly': return 'Bi-weekly';
    case 'monthly': return 'Monthly (1st & 15th)';
    default: return 'Weekly';
  }
}

/**
 * Calculate next reminder date based on config
 */
export function getNextReminderDate(config: ReportReminder): Date {
  const now = new Date();
  const target = new Date();
  
  // Set time
  target.setHours(config.hour, config.minute, 0, 0);
  
  // Find next occurrence of dayOfWeek
  const currentDay = now.getDay();
  let daysUntil = config.dayOfWeek - currentDay;
  
  // If today but time already passed, or day is in the past this week
  if (daysUntil < 0 || (daysUntil === 0 && now >= target)) {
    daysUntil += 7;
  }
  
  target.setDate(now.getDate() + daysUntil);
  
  // For biweekly, we need to track which week we're on
  // Simple approach: use week number parity
  if (config.frequency === 'biweekly') {
    const weekNumber = Math.floor(target.getTime() / (7 * 24 * 60 * 60 * 1000));
    if (weekNumber % 2 !== 0) {
      target.setDate(target.getDate() + 7);
    }
  }
  
  // For monthly, find next 1st or 15th
  if (config.frequency === 'monthly') {
    const currentDate = now.getDate();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    let targetDay: number;
    let targetMonth = now.getMonth();
    let targetYear = now.getFullYear();
    
    if (currentDate < 1 || (currentDate === 1 && (currentHour < config.hour || (currentHour === config.hour && currentMinute < config.minute)))) {
      targetDay = 1;
    } else if (currentDate < 15 || (currentDate === 15 && (currentHour < config.hour || (currentHour === config.hour && currentMinute < config.minute)))) {
      targetDay = 15;
    } else {
      // Next month's 1st
      targetDay = 1;
      targetMonth += 1;
      if (targetMonth > 11) {
        targetMonth = 0;
        targetYear += 1;
      }
    }
    
    target.setFullYear(targetYear, targetMonth, targetDay);
    target.setHours(config.hour, config.minute, 0, 0);
  }
  
  return target;
}
