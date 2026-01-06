/**
 * Root Layout - OnSite Timekeeper
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

// IMPORTANTE: Importa background tasks ANTES de qualquer coisa
import '../src/lib/backgroundTasks';

import { colors } from '../src/constants/colors';
import { logger } from '../src/lib/logger';
import { initDatabase } from '../src/lib/database';
import { GeofenceAlert } from '../src/components/GeofenceAlert';
import { DevMonitor } from '../src/components/DevMonitor';
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
  
  // Ref para evitar inicialização dupla
  const initRef = useRef(false);

  // Função para inicializar stores (reutilizável)
  const initializeStores = async () => {
    if (storesInitialized) return;
    
    logger.info('boot', '📦 Inicializando stores...');
    
    try {
      await useRegistroStore.getState().initialize();
      await useLocationStore.getState().initialize();
      await useWorkSessionStore.getState().initialize();
      await useSyncStore.getState().initialize();
      
      setStoresInitialized(true);
      logger.info('boot', '✅ Stores inicializados');
    } catch (error) {
      logger.error('boot', 'Erro ao inicializar stores', { error: String(error) });
    }
  };

  // Bootstrap inicial
  useEffect(() => {
    async function bootstrap() {
      if (initRef.current) return;
      initRef.current = true;
      
      logger.info('boot', '🚀 Iniciando OnSite Timekeeper...');

      try {
        // 1. Database
        await initDatabase();
        logger.info('boot', '✅ Database inicializado');

        // 2. Settings
        await useSettingsStore.getState().loadSettings();

        // 3. Auth
        await initAuth();

        // 4. Se já autenticado, inicializa stores
        if (useAuthStore.getState().isAuthenticated) {
          await initializeStores();
        }

        logger.info('boot', '✅ Bootstrap concluído');
      } catch (error) {
        logger.error('boot', 'Erro no bootstrap', { error: String(error) });
      } finally {
        setIsReady(true);
        await SplashScreen.hideAsync();
      }
    }

    bootstrap();
  }, []);

  // Inicializa stores quando usuário faz LOGIN
  useEffect(() => {
    if (isReady && isAuthenticated && !storesInitialized) {
      logger.info('boot', '🔑 Login detectado - inicializando stores...');
      initializeStores();
    }
  }, [isReady, isAuthenticated, storesInitialized]);

  // Navegação baseada em auth - SÓ NAVEGA QUANDO READY
  useEffect(() => {
    if (!isReady || authLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isReady, authLoading, isAuthenticated, segments]);

  // Loading enquanto bootstrap roda
  if (!isReady || authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      
      <GeofenceAlert />
      <DevMonitor />
    </>
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
