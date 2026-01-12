/**
 * Settings Store - OnSite Timekeeper v2
 * 
 * User preferences with persistence.
 * Includes timer configurations for geofencing actions.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../lib/logger';

// ============================================
// TYPES
// ============================================

export type ContactType = 'whatsapp' | 'email';
export type ReminderFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface FavoriteContact {
  type: ContactType;
  value: string;
  name?: string;
}

export interface ReportReminder {
  enabled: boolean;
  frequency: ReminderFrequency;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  hour: number;
  minute: number;
}

export interface PendingReportExport {
  periodStart: string;
  periodEnd: string;
}

interface SettingsState {
  // ============================================
  // TIMER CONFIGURATIONS
  // ============================================
  
  /** Minutes before auto-start on geofence entry (0 = immediate) */
  entryTimeoutMinutes: number;
  
  /** Seconds before auto-stop on geofence exit */
  exitTimeoutSeconds: number;
  
  /** Minutes before auto-resume when returning during pause */
  returnTimeoutMinutes: number;
  
  /** Max pause duration in minutes before alarm */
  pauseLimitMinutes: number;
  
  /** Minutes to deduct from exit time on auto-stop */
  exitAdjustmentMinutes: number;

  // ============================================
  // NOTIFICATIONS
  // ============================================
  
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;

  // ============================================
  // AUTO-ACTIONS
  // ============================================
  
  autoStartEnabled: boolean;
  autoStopEnabled: boolean;

  // ============================================
  // GEOFENCING
  // ============================================
  
  defaultRadius: number;
  minimumLocationDistance: number;
  /** @deprecated Use minimumLocationDistance */
  distanciaMinimaLocais: number;

  // ============================================
  // AUTO-REPORT
  // ============================================
  
  favoriteContact: FavoriteContact | null;
  reportReminder: ReportReminder;
  pendingReportExport: PendingReportExport | null;

  // ============================================
  // DEBUG
  // ============================================
  
  devMonitorEnabled: boolean;

  // ============================================
  // ACTIONS
  // ============================================
  
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  updateSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  resetSettings: () => void;
  
  // Report export
  setPendingReportExport: (data: PendingReportExport | null) => void;
  clearPendingReportExport: () => void;
  
  // Getters for ms values (convenience)
  getEntryTimeoutMs: () => number;
  getExitTimeoutMs: () => number;
  getReturnTimeoutMs: () => number;
  getPauseLimitMs: () => number;
  getExitAdjustment: () => number;
}

// ============================================
// DEFAULTS
// ============================================

type SettingsData = Omit<SettingsState, 
  | 'loadSettings' 
  | 'saveSettings' 
  | 'updateSetting' 
  | 'resetSettings' 
  | 'setPendingReportExport'
  | 'clearPendingReportExport'
  | 'getEntryTimeoutMs' 
  | 'getExitTimeoutMs' 
  | 'getReturnTimeoutMs' 
  | 'getPauseLimitMs' 
  | 'getExitAdjustment'
>;

const DEFAULT_SETTINGS: SettingsData = {
  // Timers
  entryTimeoutMinutes: 5,
  exitTimeoutSeconds: 15,
  returnTimeoutMinutes: 5,
  pauseLimitMinutes: 30,
  exitAdjustmentMinutes: 10,
  
  // Notifications
  notificationsEnabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  
  // Auto-actions
  autoStartEnabled: true,
  autoStopEnabled: true,
  
  // Geofencing
  defaultRadius: 100,
  minimumLocationDistance: 200,
  distanciaMinimaLocais: 200, // deprecated alias
  
  // Auto-report
  favoriteContact: null,
  reportReminder: {
    enabled: false,
    frequency: 'weekly',
    dayOfWeek: 5, // Friday
    hour: 18,
    minute: 0,
  },
  pendingReportExport: null,
  
  // Debug
  devMonitorEnabled: false,
};

// ============================================
// OPTIONS FOR UI
// ============================================

export const TIMER_OPTIONS = {
  entryTimeout: [
    { value: 0, label: '⚡ Immediate' },
    { value: 0.5, label: '30 seconds' },
    { value: 1, label: '1 minute' },
    { value: 2, label: '2 minutes' },
    { value: 5, label: '5 minutes' },
    { value: 10, label: '10 minutes' },
  ],
  exitTimeout: [
    { value: 10, label: '10 seconds' },
    { value: 15, label: '15 seconds' },
    { value: 30, label: '30 seconds' },
    { value: 45, label: '45 seconds' },
    { value: 60, label: '1 minute' },
  ],
  returnTimeout: [
    { value: 1, label: '1 minute' },
    { value: 2, label: '2 minutes' },
    { value: 5, label: '5 minutes' },
    { value: 10, label: '10 minutes' },
  ],
  pauseLimit: [
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 45, label: '45 minutes' },
    { value: 60, label: '1 hour' },
  ],
  exitAdjustment: [
    { value: 0, label: 'None' },
    { value: 5, label: '5 minutes' },
    { value: 10, label: '10 minutes' },
    { value: 15, label: '15 minutes' },
  ],
} as const;

export const REMINDER_FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
] as const;

export const DAYS_OF_WEEK = [
  { value: 0, label: 'S', fullLabel: 'Sunday' },
  { value: 1, label: 'M', fullLabel: 'Monday' },
  { value: 2, label: 'T', fullLabel: 'Tuesday' },
  { value: 3, label: 'W', fullLabel: 'Wednesday' },
  { value: 4, label: 'T', fullLabel: 'Thursday' },
  { value: 5, label: 'F', fullLabel: 'Friday' },
  { value: 6, label: 'S', fullLabel: 'Saturday' },
] as const;

// ============================================
// HELPERS
// ============================================

export function getDayShortLabel(day: number): string {
  return DAYS_OF_WEEK[day]?.label || '?';
}

export function getDayFullLabel(day: number): string {
  return DAYS_OF_WEEK[day]?.fullLabel || 'Unknown';
}

export function formatReminderTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}:${m} ${ampm}`;
}

export function getFrequencyLabel(frequency: ReminderFrequency): string {
  const option = REMINDER_FREQUENCY_OPTIONS.find(o => o.value === frequency);
  return option?.label || frequency;
}

export function getNextReminderDate(reminder: ReportReminder): Date {
  const now = new Date();
  const target = new Date();
  
  // Set time
  target.setHours(reminder.hour, reminder.minute, 0, 0);
  
  // Set day of week
  const currentDay = target.getDay();
  const daysUntilTarget = (reminder.dayOfWeek - currentDay + 7) % 7;
  target.setDate(target.getDate() + daysUntilTarget);
  
  // If target is in the past, move to next occurrence
  if (target <= now) {
    switch (reminder.frequency) {
      case 'weekly':
        target.setDate(target.getDate() + 7);
        break;
      case 'biweekly':
        target.setDate(target.getDate() + 14);
        break;
      case 'monthly':
        target.setMonth(target.getMonth() + 1);
        break;
    }
  }
  
  return target;
}

// ============================================
// STORE
// ============================================

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      loadSettings: async () => {
        logger.debug('settings', 'Loading settings...');
        // Persist middleware handles loading automatically
      },

      saveSettings: async () => {
        logger.debug('settings', 'Settings auto-saved by persist middleware');
      },

      updateSetting: (key, value) => {
        set({ [key]: value } as Partial<SettingsState>);
        
        // Keep deprecated alias in sync
        if (key === 'minimumLocationDistance') {
          set({ distanciaMinimaLocais: value as number });
        }
        
        logger.info('settings', `Setting updated: ${key}`, { value });
      },

      resetSettings: () => {
        set(DEFAULT_SETTINGS);
        logger.info('settings', 'Settings reset to defaults');
      },

      // ============================================
      // REPORT EXPORT
      // ============================================

      setPendingReportExport: (data) => {
        set({ pendingReportExport: data });
      },

      clearPendingReportExport: () => {
        set({ pendingReportExport: null });
      },

      // ============================================
      // GETTERS (for convenience)
      // ============================================

      getEntryTimeoutMs: () => {
        const minutes = get().entryTimeoutMinutes;
        return minutes * 60 * 1000;
      },

      getExitTimeoutMs: () => {
        const seconds = get().exitTimeoutSeconds;
        return seconds * 1000;
      },

      getReturnTimeoutMs: () => {
        const minutes = get().returnTimeoutMinutes;
        return minutes * 60 * 1000;
      },

      getPauseLimitMs: () => {
        const minutes = get().pauseLimitMinutes;
        return minutes * 60 * 1000;
      },

      getExitAdjustment: () => {
        return get().exitAdjustmentMinutes;
      },
    }),
    {
      name: 'onsite-settings-v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Only persist data, not functions
        entryTimeoutMinutes: state.entryTimeoutMinutes,
        exitTimeoutSeconds: state.exitTimeoutSeconds,
        returnTimeoutMinutes: state.returnTimeoutMinutes,
        pauseLimitMinutes: state.pauseLimitMinutes,
        exitAdjustmentMinutes: state.exitAdjustmentMinutes,
        notificationsEnabled: state.notificationsEnabled,
        soundEnabled: state.soundEnabled,
        vibrationEnabled: state.vibrationEnabled,
        autoStartEnabled: state.autoStartEnabled,
        autoStopEnabled: state.autoStopEnabled,
        defaultRadius: state.defaultRadius,
        minimumLocationDistance: state.minimumLocationDistance,
        distanciaMinimaLocais: state.distanciaMinimaLocais,
        favoriteContact: state.favoriteContact,
        reportReminder: state.reportReminder,
        pendingReportExport: state.pendingReportExport,
        devMonitorEnabled: state.devMonitorEnabled,
      }),
    }
  )
);
