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
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { logger } from './logger';

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
  | 'timeout';

export interface GeofenceNotificationData {
  type: 'geofence_enter' | 'geofence_exit' | 'geofence_return' | 'auto_action' | 'reminder';
  locationId: string;
  locationName: string;
  action?: NotificationAction;
}

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
      await Notifications.setNotificationChannelAsync('geofence', {
        name: 'Location Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3B82F6',
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
        buttonTitle: '✓ OK',
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
