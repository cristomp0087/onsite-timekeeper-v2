/**
 * Root Layout - OnSite Timekeeper v2
 * 
 * SIMPLIFIED: No fullscreen popup (GeofenceAlert removed)
 * UPDATED: Added notification response handler for report reminders
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
import type { GeofenceNotificationData } from '../src/lib/notifications';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [storesInitialized, setStoresInitialized] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const isAuthenticated = useAuthStore(s => s.isAuthenticated());
  const authLoading = useAuthStore(s => s.isLoading);
  const initAuth = useAuthStore(s => s.initialize);
  
  const initRef = useRef(false);
  const notificationListenerRef = useRef<Notifications.Subscription | null>(null);

  // ============================================
  // STORE INITIALIZATION
  // ============================================

  const initializeStores = async () => {
    if (storesInitialized) return;
    
    logger.info('boot', '📦 Initializing stores...');
    
    try {
      await useRecordStore.getState().initialize();
      await useLocationStore.getState().initialize();
      await useWorkSessionStore.getState().initialize();
      await useSyncStore.getState().initialize();
      
      setStoresInitialized(true);
      logger.info('boot', '✅ Stores initialized');
    } catch (error) {
      logger.error('boot', 'Error initializing stores', { error: String(error) });
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
        // User clicked [Send Now] or tapped the notification
        logger.info('notification', '📤 Report reminder: Send Now');

        // Set pending export flag with period data
        useSettingsStore.getState().setPendingReportExport({
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
        });

        // Navigate to home tab
        router.push('/');

        // Reschedule next reminder
        const { reportReminder } = useSettingsStore.getState();
        if (reportReminder.enabled) {
          await scheduleReportReminder(reportReminder);
        }

      } else if (actionIdentifier === 'remind_later') {
        // User clicked [Later] - schedule reminder for 1 hour
        logger.info('notification', '⏰ Report reminder: Later');
        await scheduleRemindLater();
      }
    }
  };

  // ============================================
  // BOOTSTRAP
  // ============================================

  useEffect(() => {
    async function bootstrap() {
      if (initRef.current) return;
      initRef.current = true;
      
      logger.info('boot', '🚀 Starting OnSite Timekeeper v2...');

      try {
        await initDatabase();
        logger.info('boot', '✅ Database initialized');

        await useSettingsStore.getState().loadSettings();

        // Configure notification categories
        await configureNotificationCategories();

        await initAuth();

        if (useAuthStore.getState().isAuthenticated()) {
          await initializeStores();
          
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
  }, []);

  // ============================================
  // NOTIFICATION LISTENER
  // ============================================

  useEffect(() => {
    // Set up notification response listener
    notificationListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    // Check for notification that launched the app
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

  useEffect(() => {
    if (isReady && isAuthenticated && !storesInitialized) {
      logger.info('boot', '🔑 Login detected - initializing stores...');
      initializeStores();
    }
  }, [isReady, isAuthenticated, storesInitialized]);

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
