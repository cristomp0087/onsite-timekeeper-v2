/**
 * DevMonitor - OnSite Timekeeper
 * 
 * Painel de debug para desenvolvedores
 * Escondido sob botão DEV na UI de produção
 */

import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  Alert,
  Modal,
} from 'react-native';
import { useLocationStore } from '../stores/locationStore';
import { useSyncStore } from '../stores/syncStore';
import { useAuthStore } from '../stores/authStore';
import { useWorkSessionStore } from '../stores/workSessionStore';
import { useRegistroStore } from '../stores/registroStore';
import { supabase, isSupabaseConfigured, getSupabaseConfig } from '../lib/supabase';
import { 
  getLocaisPendentesSync, 
  getRegistrosPendentesSync,
  getHeartbeatStats,
  getDbStats,
} from '../lib/database';
import { 
  getTasksStatus, 
  executeHeartbeatNow,
  isHeartbeatRunning,
} from '../lib/backgroundTasks';
import NetInfo from '@react-native-community/netinfo';

const colors = {
  primary: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  text: '#1F2937',
  textSecondary: '#6B7280',
  background: '#FFFFFF',
  border: '#E5E7EB',
};

export function DevMonitor() {
  const [visible, setVisible] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [tasksStatus, setTasksStatus] = useState<any>(null);
  const [heartbeatStats, setHeartbeatStats] = useState<any>(null);

  const locationStore = useLocationStore();
  const syncStore = useSyncStore();
  const authStore = useAuthStore();
  const workStore = useWorkSessionStore();
  const registroStore = useRegistroStore();

  // Atualiza status das tasks periodicamente quando visível
  useEffect(() => {
    if (!visible) return;
    
    const updateStatus = async () => {
      const tasks = await getTasksStatus();
      setTasksStatus(tasks);
      
      const userId = authStore.getUserId();
      if (userId) {
        const hbStats = await getHeartbeatStats(userId);
        setHeartbeatStats(hbStats);
      }
    };
    
    updateStatus();
    const interval = setInterval(updateStatus, 5000);
    return () => clearInterval(interval);
  }, [visible]);

  const runFullDebug = async () => {
    try {
      const netState = await NetInfo.fetch();
      const supabaseConfig = getSupabaseConfig();
      const userId = authStore.getUserId();
      const dbStats = await getDbStats();
      const tasks = await getTasksStatus();

      const info = {
        network: {
          isConnected: netState.isConnected,
          isInternetReachable: netState.isInternetReachable,
          type: netState.type,
          storeIsOnline: syncStore.isOnline,
        },
        supabase: supabaseConfig,
        auth: {
          userId: userId || 'NOT AUTHENTICATED',
          isAuthenticated: authStore.isAuthenticated,
        },
        sync: {
          lastSyncAt: syncStore.lastSyncAt?.toISOString() || 'Nunca',
          autoSyncEnabled: syncStore.autoSyncEnabled,
          isSyncing: syncStore.isSyncing,
        },
        tasks,
        database: dbStats,
        location: {
          hasPermission: locationStore.hasPermission,
          hasBackgroundPermission: locationStore.hasBackgroundPermission,
          isGeofencingActive: locationStore.isGeofencingActive,
          locaisCount: locationStore.locais.length,
          activeGeofence: locationStore.activeGeofence,
        },
      };

      setDebugInfo(info);

      Alert.alert(
        '🔍 Debug Completo',
        `📡 Net: ${netState.isConnected ? 'OK' : 'OFFLINE'}\n` +
        `📱 Store: ${syncStore.isOnline ? 'Online' : 'Offline'}\n` +
        `💓 Heartbeat: ${tasks.heartbeat ? 'Ativo' : 'Inativo'}\n` +
        `🔑 Supabase: ${isSupabaseConfigured() ? 'OK' : 'ERRO'}\n` +
        `👤 Auth: ${userId ? 'OK' : 'NÃO'}\n` +
        `📍 Fences: ${tasks.activeFences}\n` +
        `📊 DB: ${dbStats.locais_total}L / ${dbStats.registros_total}R`
      );

      console.log('🔍 DEBUG COMPLETO:', JSON.stringify(info, null, 2));
    } catch (error) {
      Alert.alert('Erro', String(error));
    }
  };

  const testHeartbeat = async () => {
    try {
      Alert.alert('Heartbeat', 'Executando heartbeat manual...');
      const result = await executeHeartbeatNow();
      
      if (result) {
        Alert.alert(
          '💓 Heartbeat',
          `📍 ${result.location?.latitude.toFixed(6)}, ${result.location?.longitude.toFixed(6)}\n` +
          `📏 Precisão: ${result.location?.accuracy?.toFixed(0)}m\n` +
          `🏠 Dentro: ${result.isInsideFence ? `SIM (${result.fenceName})` : 'NÃO'}`
        );
      } else {
        Alert.alert('Erro', 'Não foi possível executar heartbeat');
      }
    } catch (error) {
      Alert.alert('Erro', String(error));
    }
  };

  const checkPendingSync = async () => {
    const userId = authStore.getUserId();
    if (!userId) {
      Alert.alert('Erro', 'Não autenticado');
      return;
    }

    const locais = await getLocaisPendentesSync(userId);
    const registros = await getRegistrosPendentesSync(userId);

    Alert.alert(
      '📋 Pendentes de Sync',
      `📍 Locais: ${locais.length}\n` +
      `📝 Registros: ${registros.length}\n\n` +
      (locais.length > 0 ? `Locais:\n${locais.map(l => `• ${l.nome}`).join('\n')}` : 'Nenhum local pendente')
    );
  };

  const forceSync = async () => {
    try {
      useSyncStore.setState({ isOnline: true });
      await syncStore.syncNow();
      Alert.alert('✅ Sync', 'Sincronização forçada concluída!');
    } catch (error) {
      Alert.alert('Erro', String(error));
    }
  };

  const testSupabase = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        Alert.alert('Erro', `Auth: ${authError?.message || 'Não autenticado'}`);
        return;
      }

      const { data: selectData, error: selectError } = await supabase
        .from('locais')
        .select('*')
        .eq('user_id', user.id)
        .limit(5);

      Alert.alert(
        '🧪 Teste Supabase',
        `✅ Auth: OK (${user.id.substring(0, 8)}...)\n` +
        `${selectError ? `❌ SELECT: ${selectError.message}` : `✅ SELECT: ${selectData?.length || 0} locais`}`
      );
    } catch (error) {
      Alert.alert('Erro', String(error));
    }
  };

  // Botão flutuante
  if (!visible) {
    return (
      <TouchableOpacity style={styles.fab} onPress={() => setVisible(true)}>
        <Text style={styles.fabText}>🔧</Text>
      </TouchableOpacity>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setVisible(false)}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>🔧 Dev Monitor</Text>
          <TouchableOpacity onPress={() => setVisible(false)}>
            <Text style={styles.closeButton}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {/* SYNC STATUS */}
          <Section title="📡 Sync">
            <Row label="Conexão" value={syncStore.isOnline ? 'Online' : 'Offline'} 
                 color={syncStore.isOnline ? colors.success : colors.error} />
            <Row label="Último sync" value={syncStore.lastSyncAt ? 
                 new Date(syncStore.lastSyncAt).toLocaleTimeString() : 'Nunca'} />
            <Row label="Auto-sync" value={syncStore.autoSyncEnabled ? 'Ativo' : 'Inativo'} />
            <Row label="Supabase" value={isSupabaseConfigured() ? 'OK' : 'NÃO'} 
                 color={isSupabaseConfigured() ? colors.success : colors.error} />
          </Section>

          {/* HEARTBEAT STATUS */}
          <Section title="💓 Heartbeat">
            <Row label="Status" value={tasksStatus?.heartbeat ? 'Ativo' : 'Inativo'} 
                 color={tasksStatus?.heartbeat ? colors.success : colors.warning} />
            <Row label="Background Fetch" value={tasksStatus?.backgroundFetchStatus || 'N/A'} />
            <Row label="Fences ativas" value={`${tasksStatus?.activeFences || 0}`} />
            {heartbeatStats && (
              <>
                <Row label="Total logs" value={`${heartbeatStats.total}`} />
                <Row label="Hoje" value={`${heartbeatStats.hoje}`} />
                <Row label="Último" value={heartbeatStats.ultimoTimestamp ? 
                     new Date(heartbeatStats.ultimoTimestamp).toLocaleTimeString() : 'Nunca'} />
              </>
            )}
          </Section>

          {/* LOCATION */}
          <Section title="📍 Location">
            <Row label="Permissão" value={locationStore.hasPermission ? 'OK' : 'NÃO'} 
                 color={locationStore.hasPermission ? colors.success : colors.error} />
            <Row label="Background" value={locationStore.hasBackgroundPermission ? 'OK' : 'NÃO'} 
                 color={locationStore.hasBackgroundPermission ? colors.success : colors.error} />
            <Row label="Geofencing" value={locationStore.isGeofencingActive ? 'Ativo' : 'Inativo'} 
                 color={locationStore.isGeofencingActive ? colors.success : colors.warning} />
            <Row label="Locais" value={`${locationStore.locais.length}`} />
            <Row label="Dentro de" value={locationStore.activeGeofence ? 
                 locationStore.locais.find(l => l.id === locationStore.activeGeofence)?.nome || 'ID' : 
                 'Nenhum'} />
          </Section>

          {/* SESSÃO */}
          <Section title="⏱️ Sessão">
            <Row label="Ativa" value={registroStore.sessaoAtual ? 'Sim' : 'Não'} 
                 color={registroStore.sessaoAtual ? colors.success : colors.textSecondary} />
            {registroStore.sessaoAtual && (
              <>
                <Row label="Local" value={registroStore.sessaoAtual.local_nome || 'N/A'} />
                <Row label="Entrada" value={new Date(registroStore.sessaoAtual.entrada).toLocaleTimeString()} />
              </>
            )}
          </Section>

          {/* AUTH */}
          <Section title="👤 Auth">
            <Row label="Status" value={authStore.isAuthenticated ? 'Autenticado' : 'Não'} 
                 color={authStore.isAuthenticated ? colors.success : colors.error} />
            <Row label="User ID" value={authStore.getUserId()?.substring(0, 12) + '...' || 'N/A'} />
          </Section>

          {/* LAST SYNC STATS */}
          {syncStore.lastSyncStats && (
            <Section title="📊 Último Sync">
              <Row label="⬆️ Locais" value={`${syncStore.lastSyncStats.uploadedLocais}`} />
              <Row label="⬆️ Registros" value={`${syncStore.lastSyncStats.uploadedRegistros}`} />
              <Row label="⬇️ Locais" value={`${syncStore.lastSyncStats.downloadedLocais}`} />
              <Row label="⬇️ Registros" value={`${syncStore.lastSyncStats.downloadedRegistros}`} />
              {syncStore.lastSyncStats.errors.length > 0 && (
                <Row label="❌ Erros" value={`${syncStore.lastSyncStats.errors.length}`} color={colors.error} />
              )}
            </Section>
          )}

          {/* DEBUG INFO */}
          {debugInfo && (
            <Section title="🔍 Debug Info">
              <ScrollView style={styles.debugScroll} horizontal>
                <Text style={styles.debugText}>
                  {JSON.stringify(debugInfo, null, 2)}
                </Text>
              </ScrollView>
            </Section>
          )}

          {/* AÇÕES */}
          <Section title="🛠️ Ações">
            <Button label="🔍 Debug Completo" onPress={runFullDebug} />
            <Button label="💓 Testar Heartbeat" onPress={testHeartbeat} />
            <Button label="📋 Ver Pendentes" onPress={checkPendingSync} />
            <Button label="🧪 Testar Supabase" onPress={testSupabase} />
            <Button label="🔄 Forçar Sync" onPress={forceSync} primary />
            <Button 
              label={syncStore.autoSyncEnabled ? '⏸️ Desativar Auto-Sync' : '▶️ Ativar Auto-Sync'} 
              onPress={() => syncStore.toggleAutoSync()} 
            />
          </Section>

          <View style={{ height: 50 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// Componentes auxiliares
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, color && { color }]}>{value}</Text>
    </View>
  );
}

function Button({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <TouchableOpacity 
      style={[styles.button, primary && styles.buttonPrimary]} 
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 1000,
  },
  fabText: {
    fontSize: 20,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  closeButton: {
    fontSize: 24,
    color: colors.textSecondary,
    padding: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
  },
  debugScroll: {
    maxHeight: 200,
  },
  debugText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: colors.textSecondary,
  },
  button: {
    backgroundColor: colors.primary,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: colors.success,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
});
