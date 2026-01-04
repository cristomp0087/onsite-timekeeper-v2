/**
 * Tabs Layout - OnSite Timekeeper
 * 
 * Navegação simplificada:
 * - Home (cronômetro + histórico integrado)
 * - Locais (mapa)
 * - Configurações
 */

import React from 'react';
import { Text, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { colors } from '../../src/constants/colors';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: colors.white,
        headerTitleStyle: {
          fontWeight: '600',
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          paddingBottom: Platform.OS === 'ios' ? 20 : 8,
          paddingTop: 8,
          height: Platform.OS === 'ios' ? 85 : 65,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'OnSite',
          headerTitle: 'OnSite Timekeeper',
          tabBarLabel: 'Home',
          tabBarIcon: () => <TabIcon emoji="🏠" />,
        }}
      />

      <Tabs.Screen
        name="map"
        options={{
          title: 'Locais',
          headerTitle: 'Meus Locais',
          tabBarLabel: 'Locais',
          tabBarIcon: () => <TabIcon emoji="📍" />,
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          headerTitle: 'Configurações',
          tabBarLabel: 'Ajustes',
          tabBarIcon: () => <TabIcon emoji="⚙️" />,
        }}
      />

      {/* ESCONDE a tab history se ainda existir o arquivo */}
      <Tabs.Screen
        name="history"
        options={{
          href: null, // Esconde da navegação
        }}
      />
    </Tabs>
  );
}

// Componente simples de ícone com emoji
function TabIcon({ emoji }: { emoji: string }) {
  return <Text style={{ fontSize: 22 }}>{emoji}</Text>;
}
