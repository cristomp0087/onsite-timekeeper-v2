/**
 * Permission Status Hook - OnSite Timekeeper
 * 
 * Monitors:
 * - Location permissions (foreground + background)
 * - Notification permissions
 * - Foreground service status (Android)
 * 
 * Shows banners when permissions are missing.
 * 
 * FIX: Added restartMonitoring and foregroundServiceKilled
 */

import { useState, useEffect, useCallback } from 'react';
import { AppState, AppStateStatus, Platform, Linking } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../lib/logger';
import { captureError } from '../lib/database/errors';
import { useLocationStore } from '../stores/locationStore';
import { LOCATION_TASK_NAME } from '../lib/constants';

// ============================================
// TYPES
// ============================================

export interface PermissionStatus {
  // Permissions
  locationForeground: boolean;
  locationBackground: boolean;
  notificationsEnabled: boolean;
  
  // Service status
  foregroundServiceKilled: boolean;
  
  // Computed
  canTrackReliably: boolean;
  needsAttention: boolean;
  
  // State
  isChecking: boolean;
  
  // Actions
  checkPermissions: () => Promise<void>;
  openAppSettings: () => void;
  openNotificationSettings: () => void;
  requestLocationPermission: () => Promise<boolean>;
  requestNotificationPermission: () => Promise<boolean>;
  restartMonitoring: () => Promise<boolean>;
}

// ============================================
// CONSTANTS
// ============================================

const NOTIFICATION_DISABLED_LOG_KEY = '@onsite:notificationDisabledLogDate';
const SERVICE_KILLED_KEY = '@onsite:foregroundServiceKilled';
const PERMISSION_CHECK_INTERVAL = 120000; // 2 minutes

// ============================================
// HOOK
// ============================================

export function usePermissionStatus(): PermissionStatus {
  const [locationForeground, setLocationForeground] = useState(true);
  const [locationBackground, setLocationBackground] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [foregroundServiceKilled, setForegroundServiceKilled] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  // Get restartMonitoring from location store
  const storeRestartMonitoring = useLocationStore(s => s.restartMonitoring);
  const isMonitoring = useLocationStore(s => s.isMonitoring);

  // ============================================
  // CHECK FOREGROUND SERVICE STATUS
  // ============================================
  
  const checkForegroundServiceStatus = useCallback(async () => {
    try {
      // Check if the background location task is registered and running
      const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      
      // If monitoring should be active but task is not registered, service was killed
      if (isMonitoring && !isTaskRegistered) {
        setForegroundServiceKilled(true);
        await AsyncStorage.setItem(SERVICE_KILLED_KEY, 'true');
        logger.warn('permissions', '⚠️ Foreground service was killed by system');
      } else {
        // Check stored state
        const wasKilled = await AsyncStorage.getItem(SERVICE_KILLED_KEY);
        if (wasKilled === 'true' && isTaskRegistered) {
          // Service was restored
          setForegroundServiceKilled(false);
          await AsyncStorage.removeItem(SERVICE_KILLED_KEY);
          logger.info('permissions', '✅ Foreground service restored');
        } else if (wasKilled === 'true') {
          setForegroundServiceKilled(true);
        } else {
          setForegroundServiceKilled(false);
        }
      }
    } catch (error) {
      logger.debug('permissions', 'Error checking foreground service', { error: String(error) });
    }
  }, [isMonitoring]);

  // ============================================
  // CHECK PERMISSIONS
  // ============================================
  
  const checkPermissions = useCallback(async () => {
    setIsChecking(true);
    
    try {
      // Check location permissions
      const { status: fgStatus } = await Location.getForegroundPermissionsAsync();
      const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
      
      const hasForeground = fgStatus === 'granted';
      const hasBackground = bgStatus === 'granted';
      
      setLocationForeground(hasForeground);
      setLocationBackground(hasBackground);
      
      // Check notification permission
      const { status: notifStatus } = await Notifications.getPermissionsAsync();
      const hasNotifications = notifStatus === 'granted';
      setNotificationsEnabled(hasNotifications);
      
      // Check if foreground service was killed (Android only)
      if (Platform.OS === 'android') {
        await checkForegroundServiceStatus();
      }
      
      logger.debug('permissions', 'Permission check completed', {
        locationForeground: hasForeground,
        locationBackground: hasBackground,
        notificationsEnabled: hasNotifications,
      });
      
      // Log to Supabase if notifications disabled (once per day)
      if (!hasNotifications) {
        await logNotificationDisabledOnce();
      }
      
    } catch (error) {
      logger.error('permissions', 'Error checking permissions', { error: String(error) });
    } finally {
      setIsChecking(false);
    }
  }, [checkForegroundServiceStatus]);

  // ============================================
  // LOG NOTIFICATION DISABLED (ONCE PER DAY)
  // ============================================
  
  async function logNotificationDisabledOnce(): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const lastLogDate = await AsyncStorage.getItem(NOTIFICATION_DISABLED_LOG_KEY);
      
      if (lastLogDate === today) {
        return; // Already logged today
      }
      
      // Log to Supabase
      await captureError(
        new Error('User has notifications disabled'),
        'notification_error',
        {
          platform: Platform.OS,
          action: 'permission_check',
        }
      );
      
      await AsyncStorage.setItem(NOTIFICATION_DISABLED_LOG_KEY, today);
      logger.info('permissions', '📝 Logged notification disabled to Supabase');
      
    } catch (error) {
      // Ignore errors - this is non-critical
      logger.debug('permissions', 'Error logging notification disabled', { error: String(error) });
    }
  }

  // ============================================
  // ACTIONS
  // ============================================
  
  const openAppSettings = useCallback(() => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, []);

  const openNotificationSettings = useCallback(() => {
    if (Platform.OS === 'android') {
      Linking.openSettings();
    } else {
      Linking.openURL('app-settings:');
    }
  }, []);

  const requestLocationPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        return false;
      }
      
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      
      setLocationForeground(fgStatus === 'granted');
      setLocationBackground(bgStatus === 'granted');
      
      return bgStatus === 'granted';
    } catch (error) {
      logger.error('permissions', 'Error requesting location permission', { error: String(error) });
      return false;
    }
  }, []);

  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      setNotificationsEnabled(granted);
      return granted;
    } catch (error) {
      logger.error('permissions', 'Error requesting notification permission', { error: String(error) });
      return false;
    }
  }, []);

  // ============================================
  // RESTART MONITORING
  // ============================================
  
  const restartMonitoring = useCallback(async (): Promise<boolean> => {
    try {
      logger.info('permissions', '🔄 Restarting monitoring from permission banner...');
      
      // Clear the killed flag
      await AsyncStorage.removeItem(SERVICE_KILLED_KEY);
      setForegroundServiceKilled(false);
      
      // Use store's restart function
      const success = await storeRestartMonitoring();
      
      if (success) {
        logger.info('permissions', '✅ Monitoring restarted successfully');
      } else {
        logger.warn('permissions', '⚠️ Failed to restart monitoring');
      }
      
      return success;
    } catch (error) {
      logger.error('permissions', 'Error restarting monitoring', { error: String(error) });
      return false;
    }
  }, [storeRestartMonitoring]);

  // ============================================
  // EFFECTS
  // ============================================
  
  // Check on mount
  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  // Check when app returns to foreground
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        checkPermissions();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [checkPermissions]);

  // Periodic check every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      checkPermissions();
    }, PERMISSION_CHECK_INTERVAL);
    
    return () => clearInterval(interval);
  }, [checkPermissions]);

  // ============================================
  // COMPUTED VALUES
  // ============================================
  
  const canTrackReliably = 
    locationForeground && 
    locationBackground && 
    notificationsEnabled &&
    !foregroundServiceKilled;
  
  const needsAttention = 
    !locationForeground || 
    !locationBackground || 
    !notificationsEnabled ||
    foregroundServiceKilled;

  return {
    // Permissions
    locationForeground,
    locationBackground,
    notificationsEnabled,
    
    // Service status
    foregroundServiceKilled,
    
    // Computed
    canTrackReliably,
    needsAttention,
    
    // State
    isChecking,
    
    // Actions
    checkPermissions,
    openAppSettings,
    openNotificationSettings,
    requestLocationPermission,
    requestNotificationPermission,
    restartMonitoring,
  };
}
