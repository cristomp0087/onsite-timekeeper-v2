/**
 * Home/Dashboard Screen - OnSite Timekeeper
 * 
 * Orchestrates:
 * - TimerCard
 * - CalendarView
 * - DayReport
 * - ManualEntryModal
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Platform,
  Share,
  Image,
  StatusBar,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { colors } from '../../src/constants/colors';
import { useAuthStore } from '../../src/stores/authStore';
import { useLocationStore } from '../../src/stores/locationStore';
import { useRegistroStore } from '../../src/stores/registroStore';
import { useSyncStore } from '../../src/stores/syncStore';
import { formatarDuracao } from '../../src/lib/database';
import type { SessaoComputada } from '../../src/lib/database';
import { gerarRelatorioCompleto } from '../../src/lib/reports';

// Components
import { TimerCard } from '../../src/components/home/TimerCard';
import { CalendarView, getDayKey } from '../../src/components/home/CalendarView';
import { DayReport } from '../../src/components/home/DayReport';
import { ManualEntryModal } from '../../src/components/home/ManualEntryModal';

// ============================================
// HELPERS
// ============================================

function getInicioSemana(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getFimSemana(date: Date): Date {
  const inicio = getInicioSemana(date);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 6);
  fim.setHours(23, 59, 59, 999);
  return fim;
}

function getInicioMes(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getFimMes(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

// ============================================
// COMPONENT
// ============================================

export default function HomeScreen() {
  const userName = useAuthStore(s => s.getUserName());
  const { locais, geofenceAtivo, isGeofencingAtivo } = useLocationStore();
  const { 
    sessaoAtual, 
    recarregarDados, 
    registrarSaida, 
    registrarEntrada,
    compartilharUltimaSessao, 
    ultimaSessaoFinalizada, 
    limparUltimaSessao,
    getSessoesPeriodo,
    criarRegistroManual,
    editarRegistro,
    deletarRegistro,
  } = useRegistroStore();
  const { syncNow } = useSyncStore();

  // ============================================
  // STATES
  // ============================================
  
  const [refreshing, setRefreshing] = useState(false);
  const [cronometro, setCronometro] = useState('00:00:00');
  const [isPaused, setIsPaused] = useState(false);

  // Pause timer
  const [pausaAcumuladaSegundos, setPausaAcumuladaSegundos] = useState(0);
  const [pausaCronometro, setPausaCronometro] = useState('00:00:00');
  const [pausaInicioTimestamp, setPausaInicioTimestamp] = useState<number | null>(null);

  // Calendar
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [semanaAtual, setSemanaAtual] = useState(new Date());
  const [mesAtual, setMesAtual] = useState(new Date());
  const [sessoesSemana, setSessoesSemana] = useState<SessaoComputada[]>([]);
  const [sessoesMes, setSessoesMes] = useState<SessaoComputada[]>([]);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  
  // Selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());

  // Manual entry modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualDate, setManualDate] = useState<Date>(new Date());
  const [manualLocalId, setManualLocalId] = useState<string>('');
  const [manualEntrada, setManualEntrada] = useState('');
  const [manualSaida, setManualSaida] = useState('');
  const [manualPausa, setManualPausa] = useState('');

  // Derived
  const localAtivo = geofenceAtivo ? locais.find(l => l.id === geofenceAtivo) : null;
  const sessoes = viewMode === 'week' ? sessoesSemana : sessoesMes;

  // ============================================
  // TIMER EFFECTS
  // ============================================

  useEffect(() => {
    if (!sessaoAtual || sessaoAtual.status !== 'ativa') {
      setCronometro('00:00:00');
      setIsPaused(false);
      setPausaAcumuladaSegundos(0);
      setPausaCronometro('00:00:00');
      setPausaInicioTimestamp(null);
      return;
    }

    const updateCronometro = () => {
      const inicio = new Date(sessaoAtual.entrada).getTime();
      const agora = Date.now();
      const diffSec = Math.floor((agora - inicio) / 1000);
      
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;
      
      setCronometro(
        `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      );
    };

    updateCronometro();
    const interval = setInterval(updateCronometro, 1000);
    return () => clearInterval(interval);
  }, [sessaoAtual]);

  useEffect(() => {
    if (!sessaoAtual || sessaoAtual.status !== 'ativa') return;

    const updatePausaCronometro = () => {
      let totalPausaSegundos = pausaAcumuladaSegundos;
      
      if (isPaused && pausaInicioTimestamp) {
        totalPausaSegundos += Math.floor((Date.now() - pausaInicioTimestamp) / 1000);
      }
      
      const hours = Math.floor(totalPausaSegundos / 3600);
      const mins = Math.floor((totalPausaSegundos % 3600) / 60);
      const secs = totalPausaSegundos % 60;
      
      setPausaCronometro(
        `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      );
    };

    updatePausaCronometro();
    const interval = setInterval(updatePausaCronometro, 1000);
    return () => clearInterval(interval);
  }, [isPaused, pausaInicioTimestamp, pausaAcumuladaSegundos, sessaoAtual]);

  // Session finished alert
  useEffect(() => {
    if (ultimaSessaoFinalizada) {
      Alert.alert(
        '✅ Session Finished',
        `Location: ${ultimaSessaoFinalizada.local_nome}\nDuration: ${formatarDuracao(ultimaSessaoFinalizada.duracao_minutos)}`,
        [
          { text: 'OK', onPress: limparUltimaSessao },
          { text: '📤 Share', onPress: () => { compartilharUltimaSessao(); limparUltimaSessao(); } },
        ]
      );
    }
  }, [ultimaSessaoFinalizada]);

  // ============================================
  // LOAD DATA
  // ============================================

  const loadSessoesSemana = useCallback(async () => {
    const inicio = getInicioSemana(semanaAtual);
    const fim = getFimSemana(semanaAtual);
    const result = await getSessoesPeriodo(inicio.toISOString(), fim.toISOString());
    setSessoesSemana(result);
  }, [semanaAtual, getSessoesPeriodo]);

  const loadSessoesMes = useCallback(async () => {
    const inicio = getInicioMes(mesAtual);
    const fim = getFimMes(mesAtual);
    const result = await getSessoesPeriodo(inicio.toISOString(), fim.toISOString());
    setSessoesMes(result);
  }, [mesAtual, getSessoesPeriodo]);

  useEffect(() => {
    if (viewMode === 'week') {
      loadSessoesSemana();
    } else {
      loadSessoesMes();
    }
  }, [viewMode, semanaAtual, mesAtual, loadSessoesSemana, loadSessoesMes]);

  useEffect(() => {
    if (viewMode === 'week') {
      loadSessoesSemana();
    } else {
      loadSessoesMes();
    }
  }, [sessaoAtual]);

  const onRefresh = async () => {
    setRefreshing(true);
    await recarregarDados();
    if (viewMode === 'week') {
      await loadSessoesSemana();
    } else {
      await loadSessoesMes();
    }
    await syncNow();
    setRefreshing(false);
  };

  // ============================================
  // TIMER HANDLERS
  // ============================================

  const handlePause = () => {
    setIsPaused(true);
    setPausaInicioTimestamp(Date.now());
  };

  const handleResume = () => {
    if (pausaInicioTimestamp) {
      const pausaDuracao = Math.floor((Date.now() - pausaInicioTimestamp) / 1000);
      setPausaAcumuladaSegundos(prev => prev + pausaDuracao);
    }
    setPausaInicioTimestamp(null);
    setIsPaused(false);
  };

  const handleStop = () => {
    if (!sessaoAtual) return;
    
    let pausaTotalSegundos = pausaAcumuladaSegundos;
    if (isPaused && pausaInicioTimestamp) {
      pausaTotalSegundos += Math.floor((Date.now() - pausaInicioTimestamp) / 1000);
    }
    const pausaTotalMinutos = Math.floor(pausaTotalSegundos / 60);

    Alert.alert(
      '⏹️ Stop Timer',
      `End current session?${pausaTotalMinutos > 0 ? `\n\nTotal break: ${pausaTotalMinutos} minutes` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            try {
              await registrarSaida(sessaoAtual.local_id);
              
              if (pausaTotalMinutos > 0) {
                await editarRegistro(sessaoAtual.id, {
                  pausa_minutos: pausaTotalMinutos,
                  editado_manualmente: 1,
                  motivo_edicao: 'Break recorded automatically',
                });
              }
              
              setIsPaused(false);
              setPausaAcumuladaSegundos(0);
              setPausaInicioTimestamp(null);
              setPausaCronometro('00:00:00');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Could not stop session');
            }
          },
        },
      ]
    );
  };

  const handleStart = async () => {
    if (!localAtivo) return;
    Alert.alert(
      '▶️ Start New Session',
      `Start timer at "${localAtivo.nome}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            try {
              await registrarEntrada(localAtivo.id, localAtivo.nome);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Could not start');
            }
          },
        },
      ]
    );
  };

  // ============================================
  // CALENDAR HANDLERS
  // ============================================

  const handleViewModeChange = (mode: 'week' | 'month') => {
    setViewMode(mode);
    setExpandedDay(null);
    cancelSelection();
  };

  const handlePrevious = () => {
    if (viewMode === 'week') {
      const newDate = new Date(semanaAtual);
      newDate.setDate(newDate.getDate() - 7);
      setSemanaAtual(newDate);
    } else {
      const newDate = new Date(mesAtual);
      newDate.setMonth(newDate.getMonth() - 1);
      setMesAtual(newDate);
    }
    setExpandedDay(null);
    cancelSelection();
  };

  const handleNext = () => {
    if (viewMode === 'week') {
      const newDate = new Date(semanaAtual);
      newDate.setDate(newDate.getDate() + 7);
      setSemanaAtual(newDate);
    } else {
      const newDate = new Date(mesAtual);
      newDate.setMonth(newDate.getMonth() + 1);
      setMesAtual(newDate);
    }
    setExpandedDay(null);
    cancelSelection();
  };

  const handleToday = () => {
    if (viewMode === 'week') {
      setSemanaAtual(new Date());
    } else {
      setMesAtual(new Date());
    }
    setExpandedDay(null);
    cancelSelection();
  };

  // ============================================
  // DAY SELECTION
  // ============================================

  const handleDayPress = (dayKey: string, hasSessoes: boolean) => {
    if (selectionMode) {
      if (hasSessoes) {
        toggleSelectDay(dayKey);
      }
    } else if (hasSessoes) {
      setExpandedDay(expandedDay === dayKey ? null : dayKey);
    }
  };

  const handleDayLongPress = (dayKey: string, hasSessoes: boolean) => {
    if (!hasSessoes) return;
    
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedDays(new Set([dayKey]));
      setExpandedDay(null);
    } else {
      toggleSelectDay(dayKey);
    }
  };

  const toggleSelectDay = (dayKey: string) => {
    const newSet = new Set(selectedDays);
    if (newSet.has(dayKey)) {
      newSet.delete(dayKey);
      if (newSet.size === 0) {
        setSelectionMode(false);
      }
    } else {
      newSet.add(dayKey);
    }
    setSelectedDays(newSet);
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedDays(new Set());
  };

  // ============================================
  // MANUAL ENTRY
  // ============================================

  const openManualEntry = (date: Date) => {
    setManualDate(date);
    setManualLocalId(locais[0]?.id || '');
    setManualEntrada('');
    setManualSaida('');
    setManualPausa('');
    setShowManualModal(true);
  };

  const handleSaveManual = async () => {
    if (!manualLocalId) {
      Alert.alert('Error', 'Select a location');
      return;
    }
    if (!manualEntrada || !manualSaida) {
      Alert.alert('Error', 'Fill in entry and exit times');
      return;
    }

    const [entradaH, entradaM] = manualEntrada.split(':').map(Number);
    const [saidaH, saidaM] = manualSaida.split(':').map(Number);

    if (isNaN(entradaH) || isNaN(entradaM) || isNaN(saidaH) || isNaN(saidaM)) {
      Alert.alert('Error', 'Invalid time format. Use HH:MM');
      return;
    }

    const entradaDate = new Date(manualDate);
    entradaDate.setHours(entradaH, entradaM, 0, 0);

    const saidaDate = new Date(manualDate);
    saidaDate.setHours(saidaH, saidaM, 0, 0);

    if (saidaDate <= entradaDate) {
      Alert.alert('Error', 'Exit must be after entry');
      return;
    }

    const pausaMinutos = manualPausa ? parseInt(manualPausa, 10) : 0;

    try {
      const local = locais.find(l => l.id === manualLocalId);
      await criarRegistroManual({
        localId: manualLocalId,
        localNome: local?.nome || 'Location',
        entrada: entradaDate.toISOString(),
        saida: saidaDate.toISOString(),
        pausaMinutos: pausaMinutos,
      });
      Alert.alert('✅ Success', 'Record added!');

      setShowManualModal(false);
      if (viewMode === 'week') {
        loadSessoesSemana();
      } else {
        loadSessoesMes();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not save');
    }
  };

  // ============================================
  // DELETE DAY
  // ============================================

  const handleDeleteDay = (sessoesDodia: SessaoComputada[]) => {
    const sessoesFinalizadas = sessoesDodia.filter(s => s.saida);
    if (sessoesFinalizadas.length === 0) return;

    Alert.alert(
      '🗑️ Delete Day',
      `Delete all ${sessoesFinalizadas.length} record(s) from this day?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              for (const sessao of sessoesFinalizadas) {
                await deletarRegistro(sessao.id);
              }
              setExpandedDay(null);
              if (viewMode === 'week') {
                loadSessoesSemana();
              } else {
                loadSessoesMes();
              }
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Could not delete');
            }
          },
        },
      ]
    );
  };

  // ============================================
  // EXPORT
  // ============================================

  const handleExport = async () => {
    let sessoesToExport: SessaoComputada[];
    
    if (selectionMode && selectedDays.size > 0) {
      sessoesToExport = sessoes.filter(s => {
        const sessaoDate = new Date(s.entrada);
        const dayKey = getDayKey(sessaoDate);
        return selectedDays.has(dayKey);
      });
    } else {
      sessoesToExport = sessoes;
    }

    const sessoesFinalizadas = sessoesToExport.filter(s => s.saida);

    if (sessoesFinalizadas.length === 0) {
      Alert.alert('Warning', 'No completed sessions to export');
      return;
    }

    Alert.alert(
      '📤 Export Report',
      'How would you like to export?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '💬 Text (WhatsApp)', onPress: () => exportAsText(sessoesFinalizadas) },
        { text: '📄 File', onPress: () => exportAsFile(sessoesFinalizadas) },
      ]
    );
  };

  const exportAsText = async (sessoesToExport: SessaoComputada[]) => {
    const txt = gerarRelatorioCompleto(sessoesToExport, userName || undefined);
    try {
      await Share.share({ message: txt, title: 'Time Report' });
      cancelSelection();
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const exportAsFile = async (sessoesToExport: SessaoComputada[]) => {
    const txt = gerarRelatorioCompleto(sessoesToExport, userName || undefined);
    try {
      const now = new Date();
      const fileName = `report_${now.toISOString().split('T')[0]}.txt`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(filePath, txt, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'text/plain',
          dialogTitle: 'Save Report',
        });
      }
      cancelSelection();
    } catch (error) {
      console.error('Error exporting file:', error);
      Alert.alert('Error', 'Could not create file');
    }
  };

  // ============================================
  // RENDER DAY REPORT
  // ============================================

  const renderDayReport = (date: Date) => (
    <DayReport
      date={date}
      sessoes={sessoes}
      onAddManual={openManualEntry}
      onDeleteDay={handleDeleteDay}
    />
  );

  // ============================================
  // RENDER
  // ============================================

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* HEADER */}
      <View style={styles.header}>
        <Image 
          source={require('../../assets/logo-text-white.png')} 
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <Text style={styles.greeting}>Hello, {userName || 'Worker'}</Text>
      </View>

      {/* TIMER */}
      <TimerCard
        sessaoAtual={sessaoAtual}
        localAtivo={localAtivo ? { id: localAtivo.id, nome: localAtivo.nome } : null}
        isGeofencingAtivo={isGeofencingAtivo}
        cronometro={cronometro}
        pausaCronometro={pausaCronometro}
        isPaused={isPaused}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onStart={handleStart}
      />

      <View style={styles.sectionDivider} />

      {/* SELECTION BAR */}
      {selectionMode && (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionText}>{selectedDays.size} day(s) selected</Text>
          <TouchableOpacity onPress={cancelSelection}>
            <Text style={styles.selectionCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* CALENDAR */}
      <CalendarView
        viewMode={viewMode}
        semanaAtual={semanaAtual}
        mesAtual={mesAtual}
        sessoesSemana={sessoesSemana}
        sessoesMes={sessoesMes}
        expandedDay={expandedDay}
        selectionMode={selectionMode}
        selectedDays={selectedDays}
        onViewModeChange={handleViewModeChange}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onDayPress={handleDayPress}
        onDayLongPress={handleDayLongPress}
        onAddManual={openManualEntry}
        renderDayReport={renderDayReport}
      />

      {/* EXPORT BUTTON */}
      {selectionMode ? (
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
          <Text style={styles.exportBtnText}>📤 Export {selectedDays.size} day(s)</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.exportBtnSecondary} onPress={handleExport}>
          <Text style={styles.exportBtnSecondaryText}>
            📤 Export {viewMode === 'week' ? 'Week' : 'Month'}
          </Text>
        </TouchableOpacity>
      )}

      {/* MANUAL ENTRY MODAL */}
      <ManualEntryModal
        visible={showManualModal}
        date={manualDate}
        locais={locais.map(l => ({ id: l.id, nome: l.nome, cor: l.cor }))}
        selectedLocalId={manualLocalId}
        entrada={manualEntrada}
        saida={manualSaida}
        pausa={manualPausa}
        onLocalChange={setManualLocalId}
        onEntradaChange={setManualEntrada}
        onSaidaChange={setManualSaida}
        onPausaChange={setManualPausa}
        onSave={handleSaveManual}
        onClose={() => setShowManualModal(false)}
      />

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: colors.background 
  },
  content: { 
    padding: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 16 : 60,
  },

  // Header
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  headerLogo: { 
    width: 100, 
    height: 32 
  },
  greeting: { 
    fontSize: 16, 
    fontWeight: '500', 
    color: colors.textSecondary 
  },

  sectionDivider: { 
    height: 1, 
    backgroundColor: colors.border, 
    marginVertical: 16, 
    marginHorizontal: 20, 
    opacity: 0.5 
  },

  // Selection
  selectionBar: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: colors.primary, 
    paddingVertical: 8, 
    paddingHorizontal: 16, 
    borderRadius: 8, 
    marginBottom: 12 
  },
  selectionText: { 
    color: colors.black, 
    fontSize: 14, 
    fontWeight: '500' 
  },
  selectionCancel: { 
    color: colors.black, 
    fontSize: 14, 
    fontWeight: '600' 
  },

  // Export
  exportBtn: { 
    backgroundColor: colors.primary, 
    paddingVertical: 14, 
    borderRadius: 10, 
    alignItems: 'center', 
    marginTop: 12 
  },
  exportBtnText: { 
    color: colors.black, 
    fontSize: 15, 
    fontWeight: '600' 
  },
  exportBtnSecondary: { 
    backgroundColor: colors.backgroundSecondary, 
    paddingVertical: 14, 
    borderRadius: 10, 
    alignItems: 'center', 
    marginTop: 12, 
    borderWidth: 1, 
    borderColor: colors.primary 
  },
  exportBtnSecondaryText: { 
    color: colors.primary, 
    fontSize: 15, 
    fontWeight: '600' 
  },
});
