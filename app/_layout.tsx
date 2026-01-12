/**
 * Root Layout - OnSite Timekeeper v2
 * 
 * UPDATED: Integrated singleton bootstrap for listeners
 * FIX: Added initialization lock to prevent boot loop
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';

// IMPORTANT: Import background tasks BEFORE anything else
import '../src/lib/backgroundTasks';

import { colors } from '../src/constants/colors';
import { logger } from '../src/lib/logger';
import { initDatabase } from '../src/lib/database';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { useAuthStore } from '../src/stores/authStore';
import { useLocationStore } from '../src/stores/locationStore';
import { useRecordStore } from '../src/stores/recordStore';
import { useWorkSessionStore } from '../src/stores/workSessionStore';
import { useSyncStore } from '../src/stores/syncStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import { 
  scheduleReportReminder, 
  scheduleRemindLater,
  configureNotificationCategories,
} from '../src/lib/notifications';
import {
  initializeListeners,
  cleanupListeners,
  onUserLogin,
  onUserLogout,
} from '../src/lib/bootstrap';
import type { GeofenceNotificationData } from '../src/lib/notifications';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [storesInitialized, setStoresInitialized] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const isAuthenticated = useAuthStore(s => s.isAuthenticated());
  const authLoading = useAuthStore(s => s.isLoading);
  const user = useAuthStore(s => s.user);
  const initAuth = useAuthStore(s => s.initialize);
  
  // Refs for singleton control
  const initRef = useRef(false);
  const userSessionRef = useRef<string | null>(null);
  const notificationListenerRef = useRef<Notifications.Subscription | null>(null);
  
  // FIX: Lock to prevent initialization loop
  const storesInitInProgress = useRef(false);

  // ============================================
  // STORE INITIALIZATION
  // ============================================

  const initializeStores = async () => {
    // Double-check both state and ref
    if (storesInitialized || storesInitInProgress.current) {
      logger.debug('boot', '⚠️ Stores init skipped (already done or in progress)');
      return;
    }
    
    // LOCK IMMEDIATELY before any async operation
    storesInitInProgress.current = true;
    
    logger.info('boot', '📦 Initializing stores...');
    
    try {
      // Initialize record store first (loads data)
      logger.info('boot', '📝 Initializing record store...');
      await useRecordStore.getState().initialize();
      logger.info('boot', '✅ Record store initialized');
      
      // Location store (permissions + geofencing)
      await useLocationStore.getState().initialize();
      
      // Sync store
      await useSyncStore.getState().initialize();
      
      setStoresInitialized(true);
      logger.info('boot', '✅ Stores initialized');
    } catch (error) {
      logger.error('boot', 'Error initializing stores', { error: String(error) });
      // Reset lock on error so retry is possible
      storesInitInProgress.current = false;
    }
  };

  // ============================================
  // NOTIFICATION RESPONSE HANDLER
  // ============================================

  const handleNotificationResponse = async (response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data as GeofenceNotificationData | undefined;
    const actionIdentifier = response.actionIdentifier;

    logger.info('notification', '🔔 Notification response received', {
      type: data?.type,
      action: actionIdentifier,
    });

    // Handle report reminder notifications
    if (data?.type === 'report_reminder') {
      if (actionIdentifier === 'send_now' || actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        logger.info('notification', '📤 Report reminder: Send Now');

        if (data?.periodStart && data?.periodEnd) {
          useSettingsStore.getState().setPendingReportExport({
            periodStart: data.periodStart,
            periodEnd: data.periodEnd,
          });
        }
        router.push('/');

        const { reportReminder } = useSettingsStore.getState();
        if (reportReminder.enabled) {
          await scheduleReportReminder(reportReminder);
        }

      } else if (actionIdentifier === 'remind_later') {
        logger.info('notification', '⏰ Report reminder: Later');
        await scheduleRemindLater();
      }
    }
  };

  // ============================================
  // BOOTSTRAP (runs once)
  // ============================================

  useEffect(() => {
    async function bootstrap() {
      if (initRef.current) return;
      initRef.current = true;
      
      logger.info('boot', '🚀 Starting OnSite Timekeeper v2...');

      try {
        // 1. Database
        await initDatabase();
        logger.info('boot', '✅ Database initialized');

        // 2. Settings
        await useSettingsStore.getState().loadSettings();

        // 3. Notification categories
        await configureNotificationCategories();

        // 4. SINGLETON LISTENERS (AppState, geofence callback, heartbeat)
        await initializeListeners();

        // 5. Auth
        logger.info('boot', '🔐 Initializing auth store V2...');
        await initAuth();
        logger.info('boot', '✅ Auth store V2 initialized');

        // 6. If authenticated, init stores + user session
        if (useAuthStore.getState().isAuthenticated()) {
          await initializeStores();
          
          const currentUser = useAuthStore.getState().user;
          if (currentUser) {
            await onUserLogin(currentUser.id);
            userSessionRef.current = currentUser.id;
          }
          
          // Schedule report reminder if enabled
          const { reportReminder } = useSettingsStore.getState();
          if (reportReminder.enabled) {
            await scheduleReportReminder(reportReminder);
          }
        }

        logger.info('boot', '✅ Bootstrap completed');
      } catch (error) {
        logger.error('boot', 'Bootstrap error', { error: String(error) });
      } finally {
        setIsReady(true);
        await SplashScreen.hideAsync();
      }
    }

    bootstrap();

    // Cleanup on unmount (app close)
    return () => {
      cleanupListeners();
    };
  }, []);

  // ============================================
  // NOTIFICATION LISTENER
  // ============================================

  useEffect(() => {
    notificationListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    return () => {
      if (notificationListenerRef.current) {
        notificationListenerRef.current.remove();
      }
    };
  }, []);

  // ============================================
  // AUTH STATE EFFECTS
  // ============================================

  // Handle login (stores init + user session)
  // FIX: Removed 'user' from dependencies to prevent loop
  useEffect(() => {
    if (!isReady || !isAuthenticated || storesInitialized || storesInitInProgress.current) {
      return;
    }
    
    logger.info('boot', '🔑 Login detected - initializing stores...');
    
    initializeStores().then(async () => {
      // Get user fresh from store after init completes
      const currentUser = useAuthStore.getState().user;
      if (currentUser && userSessionRef.current !== currentUser.id) {
        await onUserLogin(currentUser.id);
        userSessionRef.current = currentUser.id;
      }
    });
  }, [isReady, isAuthenticated, storesInitialized]); // FIX: Removed 'user' dependency

  // Handle logout
  useEffect(() => {
    if (isReady && !isAuthenticated && userSessionRef.current) {
      logger.info('boot', '🚪 Logout detected - cleaning up...');
      onUserLogout().then(() => {
        userSessionRef.current = null;
        setStoresInitialized(false);
        storesInitInProgress.current = false; // Reset lock for next login
      });
    }
  }, [isReady, isAuthenticated]);

  // Navigation guard
  useEffect(() => {
    if (!isReady || authLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isReady, authLoading, isAuthenticated, segments]);

  // ============================================
  // RENDER
  // ============================================

  if (!isReady || authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
