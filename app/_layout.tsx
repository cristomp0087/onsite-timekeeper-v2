/**
 * Root Layout - OnSite Timekeeper
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
import { GeofenceAlert } from '../src/components/GeofenceAlert';
import { useAuthStore } from '../src/stores/authStore';
import { useLocationStore } from '../src/stores/locationStore';
import { useRegistroStore } from '../src/stores/registroStore';
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
  
  // Ref to prevent double initialization
  const initRef = useRef(false);

  // Function to initialize stores (reusable)
  const initializeStores = async () => {
    if (storesInitialized) return;
    
    logger.info('boot', '📦 Initializing stores...');
    
    try {
      await useRegistroStore.getState().initialize();
      await useLocationStore.getState().initialize();
      await useWorkSessionStore.getState().initialize();
      await useSyncStore.getState().initialize();
      
      setStoresInitialized(true);
      logger.info('boot', '✅ Stores initialized');
    } catch (error) {
      logger.error('boot', 'Error initializing stores', { error: String(error) });
    }
  };

  // Initial bootstrap
  useEffect(() => {
    async function bootstrap() {
      if (initRef.current) return;
      initRef.current = true;
      
      logger.info('boot', '🚀 Starting OnSite Timekeeper...');

      try {
        // 1. Database
        await initDatabase();
        logger.info('boot', '✅ Database initialized');

        // 2. Settings
        await useSettingsStore.getState().loadSettings();

        // 3. Auth
        await initAuth();

        // 4. If already authenticated, initialize stores
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

  // Initialize stores when user LOGS IN
  useEffect(() => {
    if (isReady && isAuthenticated && !storesInitialized) {
      logger.info('boot', '🔑 Login detected - initializing stores...');
      initializeStores();
    }
  }, [isReady, isAuthenticated, storesInitialized]);

  // Auth-based navigation - ONLY NAVIGATE WHEN READY
  useEffect(() => {
    if (!isReady || authLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isReady, authLoading, isAuthenticated, segments]);

  // Loading while bootstrap runs
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
      
      <GeofenceAlert />
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
