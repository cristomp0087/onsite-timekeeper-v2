/**
 * Notification System - OnSite Timekeeper v2
 * 
 * SIMPLIFIED FLOW - Notification bar only (no fullscreen popup)
 * 
 * Timer values are passed as parameters (come from settingsStore)
 * 
 * ENTRY: X min timeout → auto-start
 *   Buttons: [Start Work] [Skip Today]
 * 
 * EXIT: X sec timeout → auto-end with adjustment
 *   Buttons: [OK] [Pause]
 * 
 * RETURN (during pause): X min timeout → auto-resume
 *   Buttons: [Resume] [Stop]
 * 
 * REPORT REMINDER: Weekly/biweekly/monthly notification
 *   Buttons: [Send Now] [Later]
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { logger } from './logger';
import type { ReportReminder } from '../stores/settingsStore';
import { getNextReminderDate } from '../stores/settingsStore';

// ============================================
// INITIAL CONFIGURATION
// ============================================

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ============================================
// TYPES
// ============================================

export type NotificationAction =
  | 'start'
  | 'skip_today'
  | 'ok'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'send_now'
  | 'remind_later'
  | 'timeout';

export interface GeofenceNotificationData {
  type: 'geofence_enter' | 'geofence_exit' | 'geofence_return' | 'auto_action' | 'reminder' | 'report_reminder';
  locationId?: string;
  locationName?: string;
  action?: NotificationAction;
  periodStart?: string;
  periodEnd?: string;
}

// ============================================
// CONSTANTS
// ============================================

const REPORT_REMINDER_ID = 'report-reminder-scheduled';

// ============================================
// PERMISSIONS
// ============================================

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      logger.warn('notification', 'Notification permission denied');
      return false;
    }

    if (Platform.OS === 'android') {
      // Geofence channel
      await Notifications.setNotificationChannelAsync('geofence', {
        name: 'Location Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3B82F6',
        sound: 'default',
      });

      // Report reminder channel
      await Notifications.setNotificationChannelAsync('report_reminder', {
        name: 'Report Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250],
        lightColor: '#F7B324',
        sound: 'default',
      });
    }

    logger.info('notification', '✅ Notification permission granted');
    return true;
  } catch (error) {
    logger.error('notification', 'Error requesting permission', { error: String(error) });
    return false;
  }
}

// ============================================
// ACTION CATEGORIES
// ============================================

export async function configureNotificationCategories(): Promise<void> {
  try {
    // Category for geofence ENTRY
    await Notifications.setNotificationCategoryAsync('geofence_enter', [
      {
        identifier: 'start',
        buttonTitle: '▶️ Start Work',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'skip_today',
        buttonTitle: '😴 Skip Today',
        options: { opensAppToForeground: false },
      },
    ]);

    // Category for geofence EXIT
    await Notifications.setNotificationCategoryAsync('geofence_exit', [
      {
        identifier: 'ok',
        buttonTitle: '✔ OK',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'pause',
        buttonTitle: '⏸️ Pause',
        options: { opensAppToForeground: false },
      },
    ]);

    // Category for RETURN during pause
    await Notifications.setNotificationCategoryAsync('geofence_return', [
      {
        identifier: 'resume',
        buttonTitle: '▶️ Resume',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'stop',
        buttonTitle: '⏹️ Stop',
        options: { opensAppToForeground: false },
      },
    ]);

    // Category for REPORT REMINDER (NEW)
    await Notifications.setNotificationCategoryAsync('report_reminder', [
      {
        identifier: 'send_now',
        buttonTitle: '📤 Send Now',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'remind_later',
        buttonTitle: '⏰ Later',
        options: { opensAppToForeground: false },
      },
    ]);

    logger.info('notification', '✅ Notification categories configured');
  } catch (error) {
    logger.error('notification', 'Error configuring categories', { error: String(error) });
  }
}

// ============================================
// GEOFENCE NOTIFICATIONS
// ============================================

/**
 * Show geofence ENTRY notification
 * @param timeoutMinutes - from settingsStore.entryTimeoutMinutes
 */
export async function showEntryNotification(
  locationId: string,
  locationName: string,
  timeoutMinutes: number = 5
): Promise<string> {
  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `📍 You arrived at ${locationName}`,
        body: `Timer will start in ${timeoutMinutes} min`,
        data: {
          type: 'geofence_enter',
          locationId,
          locationName,
        } as GeofenceNotificationData,
        categoryIdentifier: 'geofence_enter',
        sound: 'default',
      },
      trigger: null,
    });

    logger.info('notification', `📬 Entry notification: ${locationName}`, { notificationId });
    return notificationId;
  } catch (error) {
    logger.error('notification', 'Error showing entry notification', { error: String(error) });
    return '';
  }
}

/**
 * Show geofence EXIT notification
 * @param timeoutSeconds - from settingsStore.exitTimeoutSeconds
 */
export async function showExitNotification(
  locationId: string,
  locationName: string,
  timeoutSeconds: number = 15
): Promise<string> {
  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `🚪 You left ${locationName}`,
        body: `Session will end in ${timeoutSeconds}s`,
        data: {
          type: 'geofence_exit',
          locationId,
          locationName,
        } as GeofenceNotificationData,
        categoryIdentifier: 'geofence_exit',
        sound: 'default',
      },
      trigger: null,
    });

    logger.info('notification', `📬 Exit notification: ${locationName}`, { notificationId });
    return notificationId;
  } catch (error) {
    logger.error('notification', 'Error showing exit notification', { error: String(error) });
    return '';
  }
}

/**
 * Show RETURN notification (during pause)
 * @param timeoutMinutes - from settingsStore.returnTimeoutMinutes
 */
export async function showReturnNotification(
  locationId: string,
  locationName: string,
  timeoutMinutes: number = 5
): Promise<string> {
  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `🔄 You're back at ${locationName}`,
        body: `Timer will resume in ${timeoutMinutes} min`,
        data: {
          type: 'geofence_return',
          locationId,
          locationName,
        } as GeofenceNotificationData,
        categoryIdentifier: 'geofence_return',
        sound: 'default',
      },
      trigger: null,
    });

    logger.info('notification', `📬 Return notification: ${locationName}`, { notificationId });
    return notificationId;
  } catch (error) {
    logger.error('notification', 'Error showing return notification', { error: String(error) });
    return '';
  }
}

/**
 * Show auto-action notification (confirmation)
 */
export async function showAutoActionNotification(
  locationName: string,
  action: 'start' | 'stop' | 'pause' | 'resume'
): Promise<void> {
  try {
    const actionText = {
      start: '▶️ Timer started',
      stop: '⏹️ Timer stopped',
      pause: '⏸️ Timer paused',
      resume: '▶️ Timer resumed',
    };

    await Notifications.scheduleNotificationAsync({
      content: {
        title: actionText[action],
        body: locationName,
        data: { type: 'auto_action' } as GeofenceNotificationData,
        sound: 'default',
      },
      trigger: null,
    });

    logger.info('notification', `📬 Auto-action notification: ${action}`);
  } catch (error) {
    logger.error('notification', 'Error showing auto-action notification', { error: String(error) });
  }
}

// ============================================
// REPORT REMINDER NOTIFICATIONS (NEW)
// ============================================

/**
 * Schedule a report reminder notification
 * @param config - Report reminder configuration from settingsStore
 * @returns The scheduled notification ID
 */
export async function scheduleReportReminder(config: ReportReminder): Promise<string | null> {
  try {
    // Cancel any existing scheduled reminder first
    await cancelReportReminder();

    if (!config.enabled) {
      logger.info('notification', '🔔 Report reminder disabled, not scheduling');
      return null;
    }

    const triggerDate = getNextReminderDate(config);
    const now = new Date();

    // Calculate seconds until trigger
    const secondsUntil = Math.floor((triggerDate.getTime() - now.getTime()) / 1000);

    if (secondsUntil <= 0) {
      logger.warn('notification', '🔔 Trigger date is in the past, skipping');
      return null;
    }

    // Format period label
    const periodLabel = getPeriodLabel(config.frequency);

    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier: REPORT_REMINDER_ID,
      content: {
        title: '📊 Report Ready',
        body: `Your ${periodLabel} report is ready to send`,
        data: {
          type: 'report_reminder',
          periodStart: getPeriodStart(config.frequency).toISOString(),
          periodEnd: now.toISOString(),
        } as GeofenceNotificationData,
        categoryIdentifier: 'report_reminder',
        sound: 'default',
      },
      trigger: {
        seconds: secondsUntil,
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      },
    });

    logger.info('notification', '🔔 Report reminder scheduled', {
      notificationId,
      triggerDate: triggerDate.toISOString(),
      secondsUntil,
      frequency: config.frequency,
    });

    return notificationId;
  } catch (error) {
    logger.error('notification', 'Error scheduling report reminder', { error: String(error) });
    return null;
  }
}

/**
 * Cancel any scheduled report reminder
 */
export async function cancelReportReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(REPORT_REMINDER_ID);
    logger.info('notification', '🔔 Report reminder cancelled');
  } catch (error) {
    // Ignore errors if notification doesn't exist
    logger.debug('notification', 'No existing report reminder to cancel');
  }
}

/**
 * Show immediate "report ready" notification
 * Used when user wants to be reminded in 1 hour
 */
export async function showReportReadyNotification(
  totalHours: string,
  periodLabel: string
): Promise<string> {
  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: '📊 Report Ready',
        body: `You worked ${totalHours} ${periodLabel}`,
        data: {
          type: 'report_reminder',
        } as GeofenceNotificationData,
        categoryIdentifier: 'report_reminder',
        sound: 'default',
      },
      trigger: null,
    });

    logger.info('notification', `📬 Report ready notification shown`, { totalHours });
    return notificationId;
  } catch (error) {
    logger.error('notification', 'Error showing report ready notification', { error: String(error) });
    return '';
  }
}

/**
 * Schedule "remind later" - triggers in 1 hour
 */
export async function scheduleRemindLater(): Promise<string | null> {
  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier: 'report-reminder-later',
      content: {
        title: '📊 Report Reminder',
        body: "Don't forget to send your time report",
        data: {
          type: 'report_reminder',
        } as GeofenceNotificationData,
        categoryIdentifier: 'report_reminder',
        sound: 'default',
      },
      trigger: {
        seconds: 3600, // 1 hour
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      },
    });

    logger.info('notification', '🔔 Remind later scheduled (1 hour)');
    return notificationId;
  } catch (error) {
    logger.error('notification', 'Error scheduling remind later', { error: String(error) });
    return null;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getPeriodLabel(frequency: ReportReminder['frequency']): string {
  switch (frequency) {
    case 'weekly': return 'weekly';
    case 'biweekly': return 'bi-weekly';
    case 'monthly': return 'monthly';
    default: return 'weekly';
  }
}

function getPeriodStart(frequency: ReportReminder['frequency']): Date {
  const now = new Date();
  const start = new Date(now);

  switch (frequency) {
    case 'weekly':
      // Start of current week (Sunday)
      start.setDate(now.getDate() - now.getDay());
      break;
    case 'biweekly':
      // 2 weeks ago
      start.setDate(now.getDate() - 14);
      break;
    case 'monthly':
      // Start of month
      start.setDate(1);
      break;
  }

  start.setHours(0, 0, 0, 0);
  return start;
}

// ============================================
// MANAGEMENT
// ============================================

export async function cancelNotification(notificationId: string): Promise<void> {
  if (!notificationId) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
    await Notifications.dismissNotificationAsync(notificationId);
    logger.debug('notification', 'Notification cancelled', { notificationId });
  } catch (error) {
    logger.error('notification', 'Error cancelling notification', { error: String(error) });
  }
}

export async function cancelAllNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    logger.info('notification', 'All notifications cancelled');
  } catch (error) {
    logger.error('notification', 'Error cancelling all notifications', { error: String(error) });
  }
}

export async function clearNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch (error) {
    logger.error('notification', 'Error clearing notifications', { error: String(error) });
  }
}

/**
 * Get all scheduled notifications (for debugging)
 */
export async function getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    logger.error('notification', 'Error getting scheduled notifications', { error: String(error) });
    return [];
  }
}

// ============================================
// LISTENERS
// ============================================

export function addResponseListener(
  callback: (response: Notifications.NotificationResponse) => void
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

export function addReceivedListener(
  callback: (notification: Notifications.Notification) => void
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(callback);
}

export async function getLastNotificationResponse(): Promise<Notifications.NotificationResponse | null> {
  return await Notifications.getLastNotificationResponseAsync();
}
