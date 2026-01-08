/**
 * Root Layout - OnSite Timekeeper v2
 * 
 * SIMPLIFIED: No fullscreen popup (GeofenceAlert removed)
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

// IMPORTANT: Import background tasks BEFORE anything else
import '../src/lib/backgroundTasks';

import { colors } from '../src/constants/colors';
import { logger } from '../src/lib/logger';
import { initDatabase } from '../src/lib/database';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
// REMOVED: GeofenceAlert no longer needed
import { useAuthStore } from '../src/stores/authStore';
import { useLocationStore } from '../src/stores/locationStore';
import { useRecordStore } from '../src/stores/recordStore';
import { useWorkSessionStore } from '../src/stores/workSessionStore';
import { useSyncStore } from '../src/stores/syncStore';
import { useSettingsStore } from '../src/stores/settingsStore';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [storesInitialized, setStoresInitialized] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const { isAuthenticated, isLoading: authLoading, initialize: initAuth } = useAuthStore();
  
  const initRef = useRef(false);

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

  useEffect(() => {
    async function bootstrap() {
      if (initRef.current) return;
      initRef.current = true;
      
      logger.info('boot', '🚀 Starting OnSite Timekeeper v2...');

      try {
        await initDatabase();
        logger.info('boot', '✅ Database initialized');

        await useSettingsStore.getState().loadSettings();

        await initAuth();

        if (useAuthStore.getState().isAuthenticated) {
          await initializeStores();
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
      {/* REMOVED: <GeofenceAlert /> - Now using notification bar only */}
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
