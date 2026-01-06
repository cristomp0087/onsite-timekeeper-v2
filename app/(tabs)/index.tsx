/**
 * Home/Dashboard Screen - OnSite Timekeeper
 * 
 * Features:
 * - Header with logo and greeting
 * - Timer with location badge
 * - Pause timer
 * - Week/Month calendar toggle
 * - Day-based selection for export/delete
 * - Manual entry modal
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Platform,
  Share,
  Image,
  StatusBar,
  Dimensions,
  type ViewStyle,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { colors, withOpacity } from '../../src/constants/colors';
import { Card } from '../../src/components/ui/Button';
import { useAuthStore } from '../../src/stores/authStore';
import { useLocationStore } from '../../src/stores/locationStore';
import { useRegistroStore } from '../../src/stores/registroStore';
import { useSyncStore } from '../../src/stores/syncStore';
import { formatarDuracao } from '../../src/lib/database';
import type { SessaoComputada } from '../../src/lib/database';
import { gerarRelatorioCompleto } from '../../src/lib/reports';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================
// HELPERS
// ============================================

const DIAS_SEMANA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DIAS_SEMANA_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

function formatDateRange(inicio: Date, fim: Date): string {
  const formatDay = (d: Date) => d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  return `${formatDay(inicio)} - ${formatDay(fim)}`;
}

function formatMonthYear(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function formatTimeAMPM(iso: string): string {
  const date = new Date(iso);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

function getDayKey(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

function getMonthCalendarDays(date: Date): (Date | null)[] {
  const inicio = getInicioMes(date);
  const fim = getFimMes(date);
  const days: (Date | null)[] = [];
  
  const firstDayOfWeek = inicio.getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    days.push(null);
  }
  
  const current = new Date(inicio);
  while (current <= fim) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  return days;
}

interface DiaCalendario {
  data: Date;
  diaSemana: string;
  diaNumero: number;
  sessoes: SessaoComputada[];
  totalMinutos: number;
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

  // Calendar view mode
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  
  // Week view
  const [semanaAtual, setSemanaAtual] = useState(new Date());
  const [sessoesSemana, setSessoesSemana] = useState<SessaoComputada[]>([]);
  
  // Month view
  const [mesAtual, setMesAtual] = useState(new Date());
  const [sessoesMes, setSessoesMes] = useState<SessaoComputada[]>([]);
  
  // Expanded day (shows report)
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  
  // Multi-select (by day)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());

  // Manual entry modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualDate, setManualDate] = useState<Date>(new Date());
  const [manualLocalId, setManualLocalId] = useState<string>('');
  const [manualEntrada, setManualEntrada] = useState('');
  const [manualSaida, setManualSaida] = useState('');
  const [manualPausa, setManualPausa] = useState('');

  // Active location
  const localAtivo = geofenceAtivo ? locais.find(l => l.id === geofenceAtivo) : null;
  const podeRecomecar = localAtivo && !sessaoAtual;

  // ============================================
  // TIMER EFFECT
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
      const diffMs = agora - inicio;
      const diffSec = Math.floor(diffMs / 1000);
      
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

  // Pause timer effect
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
  // TIMER ACTIONS
  // ============================================

  const handlePausar = () => {
    setIsPaused(true);
    setPausaInicioTimestamp(Date.now());
  };

  const handleContinuar = () => {
    if (pausaInicioTimestamp) {
      const pausaDuracao = Math.floor((Date.now() - pausaInicioTimestamp) / 1000);
      setPausaAcumuladaSegundos(prev => prev + pausaDuracao);
    }
    setPausaInicioTimestamp(null);
    setIsPaused(false);
  };

  const handleParar = () => {
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

  const handleRecomecar = async () => {
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
  // CALENDAR DATA
  // ============================================

  const sessoes = viewMode === 'week' ? sessoesSemana : sessoesMes;
  
  const inicioSemana = getInicioSemana(semanaAtual);
  const fimSemana = getFimSemana(semanaAtual);

  // Week calendar days
  const diasCalendarioSemana: DiaCalendario[] = useMemo(() => {
    const dias: DiaCalendario[] = [];
    for (let i = 0; i < 7; i++) {
      const data = new Date(inicioSemana);
      data.setDate(data.getDate() + i);

      const sessoesDodia = sessoesSemana.filter(s => {
        const sessaoDate = new Date(s.entrada);
        return isSameDay(sessaoDate, data);
      });

      const totalMinutos = sessoesDodia
        .filter(s => s.saida)
        .reduce((acc, s) => {
          const pausaMin = s.pausa_minutos || 0;
          return acc + Math.max(0, s.duracao_minutos - pausaMin);
        }, 0);

      dias.push({
        data,
        diaSemana: DIAS_SEMANA[data.getDay()],
        diaNumero: data.getDate(),
        sessoes: sessoesDodia,
        totalMinutos,
      });
    }
    return dias;
  }, [inicioSemana, sessoesSemana]);

  // Month calendar days
  const diasCalendarioMes = useMemo(() => {
    return getMonthCalendarDays(mesAtual);
  }, [mesAtual]);

  // Get sessions for a specific day
  const getSessoesForDay = useCallback((date: Date): SessaoComputada[] => {
    return sessoes.filter(s => {
      const sessaoDate = new Date(s.entrada);
      return isSameDay(sessaoDate, date);
    });
  }, [sessoes]);

  // Get total minutes for a day
  const getTotalMinutosForDay = useCallback((date: Date): number => {
    const sessoesDodia = getSessoesForDay(date);
    return sessoesDodia
      .filter(s => s.saida)
      .reduce((acc, s) => {
        const pausaMin = s.pausa_minutos || 0;
        return acc + Math.max(0, s.duracao_minutos - pausaMin);
      }, 0);
  }, [getSessoesForDay]);

  const totalSemanaMinutos = sessoesSemana
    .filter(s => s.saida)
    .reduce((acc, s) => {
      const pausaMin = s.pausa_minutos || 0;
      return acc + Math.max(0, s.duracao_minutos - pausaMin);
    }, 0);

  const totalMesMinutos = sessoesMes
    .filter(s => s.saida)
    .reduce((acc, s) => {
      const pausaMin = s.pausa_minutos || 0;
      return acc + Math.max(0, s.duracao_minutos - pausaMin);
    }, 0);

  // ============================================
  // NAVIGATION
  // ============================================

  const goToPreviousWeek = () => {
    const newDate = new Date(semanaAtual);
    newDate.setDate(newDate.getDate() - 7);
    setSemanaAtual(newDate);
    setExpandedDay(null);
    cancelSelection();
  };

  const goToNextWeek = () => {
    const newDate = new Date(semanaAtual);
    newDate.setDate(newDate.getDate() + 7);
    setSemanaAtual(newDate);
    setExpandedDay(null);
    cancelSelection();
  };

  const goToCurrentWeek = () => {
    setSemanaAtual(new Date());
    setExpandedDay(null);
    cancelSelection();
  };

  const goToPreviousMonth = () => {
    const newDate = new Date(mesAtual);
    newDate.setMonth(newDate.getMonth() - 1);
    setMesAtual(newDate);
    setExpandedDay(null);
    cancelSelection();
  };

  const goToNextMonth = () => {
    const newDate = new Date(mesAtual);
    newDate.setMonth(newDate.getMonth() + 1);
    setMesAtual(newDate);
    setExpandedDay(null);
    cancelSelection();
  };

  const goToCurrentMonth = () => {
    setMesAtual(new Date());
    setExpandedDay(null);
    cancelSelection();
  };

  // ============================================
  // SELECTION (BY DAY)
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
      setManualPausa('');
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
  // DELETE DAY (all sessions)
  // ============================================

  const handleDeleteDay = (dayKey: string, sessoesDia: SessaoComputada[]) => {
    const sessoesFinalizadas = sessoesDia.filter(s => s.saida);
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
        { text: '💬 Text (WhatsApp)', onPress: () => exportarComoTexto(sessoesFinalizadas) },
        { text: '📄 File', onPress: () => exportarComoArquivo(sessoesFinalizadas) },
      ]
    );
  };

  const exportarComoTexto = async (sessoesToExport: SessaoComputada[]) => {
    const txt = gerarRelatorioCompleto(sessoesToExport, userName || undefined);
    
    try {
      await Share.share({ message: txt, title: 'Time Report' });
      cancelSelection();
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const exportarComoArquivo = async (sessoesToExport: SessaoComputada[]) => {
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
  // RENDER DAY REPORT (expanded)
  // ============================================

  const renderDayReport = (date: Date) => {
    const sessoesDodia = getSessoesForDay(date);
    const sessoesFinalizadas = sessoesDodia.filter(s => s.saida);
    const dayKey = getDayKey(date);
    const totalMinutos = getTotalMinutosForDay(date);

    if (sessoesFinalizadas.length === 0) return null;

    return (
      <View style={styles.dayReportContainer}>
        <View style={styles.reportCard}>
          {/* Header */}
          <View style={styles.reportHeader}>
            <Text style={styles.reportDate}>
              📅 {date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' })}
            </Text>
            <View style={styles.reportActions}>
              <TouchableOpacity 
                style={styles.actionBtnInline} 
                onPress={() => openManualEntry(date)}
              >
                <Text style={styles.actionBtnInlineText}>➕</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.actionBtnInline} 
                onPress={() => handleDeleteDay(dayKey, sessoesDodia)}
              >
                <Text style={styles.actionBtnInlineText}>🗑️</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Sessions */}
          {sessoesFinalizadas.map((sessao, index) => {
            const isManual = sessao.tipo === 'manual';
            const isAjustado = sessao.editado_manualmente === 1 && !isManual;
            const pausaMin = sessao.pausa_minutos || 0;
            const totalLiquido = Math.max(0, sessao.duracao_minutos - pausaMin);
            
            return (
              <View key={sessao.id} style={styles.reportSession}>
                <Text style={styles.reportLocal}>📍 {sessao.local_nome}</Text>
                
                {isManual || isAjustado ? (
                  <Text style={styles.reportTimeEdited}>
                    *Edited 》{formatTimeAMPM(sessao.entrada)} → {formatTimeAMPM(sessao.saida!)}
                  </Text>
                ) : (
                  <Text style={styles.reportTimeGps}>
                    *GPS    》{formatTimeAMPM(sessao.entrada)} → {formatTimeAMPM(sessao.saida!)}
                  </Text>
                )}
                
                {pausaMin > 0 && (
                  <Text style={styles.reportPausa}>Pausa: {pausaMin}min</Text>
                )}
                
                <Text style={styles.reportSessionTotal}>▸ {formatarDuracao(totalLiquido)}</Text>
              </View>
            );
          })}

          {/* Day total (only if multiple sessions) */}
          {sessoesFinalizadas.length > 1 && (
            <View style={styles.reportDayTotal}>
              <Text style={styles.reportDayTotalText}>Day Total: {formatarDuracao(totalMinutos)}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

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
      <Card style={[
        styles.timerCard,
        sessaoAtual && styles.timerCardActive,
        podeRecomecar && styles.timerCardIdle
      ].filter(Boolean) as ViewStyle[]}>
        {sessaoAtual ? (
          <>
            {/* Location badge */}
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>{sessaoAtual.local_nome}</Text>
            </View>
            
            <Text style={[styles.timer, isPaused && styles.timerPaused]}>{cronometro}</Text>

            {/* Pause timer */}
            <View style={styles.pausaContainer}>
              <Text style={styles.pausaLabel}>⏸️ Break:</Text>
              <Text style={[styles.pausaTimer, isPaused && styles.pausaTimerActive]}>
                {pausaCronometro}
              </Text>
            </View>

            <View style={styles.timerActions}>
              {isPaused ? (
                <TouchableOpacity style={[styles.actionBtn, styles.continueBtn]} onPress={handleContinuar}>
                  <Text style={styles.actionBtnText}>▶️ Resume</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.actionBtn, styles.pauseBtn]} onPress={handlePausar}>
                  <Text style={styles.actionBtnText}>⏸️ Pause</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.actionBtn, styles.stopBtn]} onPress={handleParar}>
                <Text style={styles.actionBtnText}>⏹️ Stop</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : podeRecomecar ? (
          <>
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>{localAtivo?.nome}</Text>
            </View>
            <Text style={styles.timer}>00:00:00</Text>
            <TouchableOpacity style={[styles.actionBtn, styles.startBtn]} onPress={handleRecomecar}>
              <Text style={styles.actionBtnText}>▶️ Start</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.timerHint}>
              {isGeofencingAtivo ? 'Waiting for location entry...' : 'Monitoring inactive'}
            </Text>
            <Text style={styles.timer}>--:--:--</Text>
          </>
        )}
      </Card>

      <View style={styles.sectionDivider} />

      {/* CALENDAR HEADER */}
      <Card style={styles.calendarCard}>
        <View style={styles.calendarHeader}>
          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={viewMode === 'week' ? goToPreviousWeek : goToPreviousMonth}
          >
            <Text style={styles.navBtnText}>◀</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={viewMode === 'week' ? goToCurrentWeek : goToCurrentMonth} 
            style={styles.calendarCenter}
          >
            <Text style={styles.calendarTitle}>
              {viewMode === 'week' 
                ? formatDateRange(inicioSemana, fimSemana)
                : formatMonthYear(mesAtual)
              }
            </Text>
            <Text style={styles.calendarTotal}>
              {formatarDuracao(viewMode === 'week' ? totalSemanaMinutos : totalMesMinutos)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={viewMode === 'week' ? goToNextWeek : goToNextMonth}
          >
            <Text style={styles.navBtnText}>▶</Text>
          </TouchableOpacity>
        </View>

        {/* View mode toggle */}
        <View style={styles.viewToggleContainer}>
          <TouchableOpacity 
            style={[styles.viewToggleBtn, viewMode === 'week' && styles.viewToggleBtnActive]}
            onPress={() => setViewMode('week')}
          >
            <Text style={[styles.viewToggleText, viewMode === 'week' && styles.viewToggleTextActive]}>Week</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.viewToggleBtn, viewMode === 'month' && styles.viewToggleBtnActive]}
            onPress={() => setViewMode('month')}
          >
            <Text style={[styles.viewToggleText, viewMode === 'month' && styles.viewToggleTextActive]}>Month</Text>
          </TouchableOpacity>
        </View>
      </Card>

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

      {/* WEEK VIEW */}
      {viewMode === 'week' && (
        <>
          {diasCalendarioSemana.map((dia) => {
            const dayKey = getDayKey(dia.data);
            const isExpanded = expandedDay === dayKey && !selectionMode;
            const hasSessoes = dia.sessoes.length > 0;
            const isDiaHoje = isToday(dia.data);
            const hasAtiva = dia.sessoes.some(s => !s.saida);
            const isSelected = selectedDays.has(dayKey);

            return (
              <View key={dayKey}>
                <TouchableOpacity
                  style={[
                    styles.dayRow,
                    isDiaHoje && styles.dayRowToday,
                    isSelected && styles.dayRowSelected,
                  ]}
                  onPress={() => handleDayPress(dayKey, hasSessoes)}
                  onLongPress={() => handleDayLongPress(dayKey, hasSessoes)}
                  delayLongPress={400}
                  activeOpacity={0.7}
                >
                  {selectionMode && hasSessoes && (
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  )}

                  <View style={styles.dayLeft}>
                    <Text style={[styles.dayName, isDiaHoje && styles.dayNameToday]}>{dia.diaSemana}</Text>
                    <View style={[styles.dayCircle, isDiaHoje && styles.dayCircleToday]}>
                      <Text style={[styles.dayNumber, isDiaHoje && styles.dayNumberToday]}>{dia.diaNumero}</Text>
                    </View>
                  </View>

                  <View style={styles.dayRight}>
                    {!hasSessoes ? (
                      <View style={styles.dayEmpty}>
                        <Text style={styles.dayEmptyText}>No record</Text>
                        {!selectionMode && (
                          <TouchableOpacity style={styles.addBtn} onPress={(e) => { e.stopPropagation(); openManualEntry(dia.data); }}>
                            <Text style={styles.addBtnText}>+</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : (
                      <View style={styles.dayPreview}>
                        <Text style={[styles.dayPreviewDuration, hasAtiva && { color: colors.success }]}>
                          {hasAtiva ? 'In progress' : formatarDuracao(dia.totalMinutos)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {hasSessoes && !selectionMode && (
                    <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
                  )}
                </TouchableOpacity>

                {/* Expanded day report */}
                {isExpanded && renderDayReport(dia.data)}
              </View>
            );
          })}
        </>
      )}

      {/* MONTH VIEW */}
      {viewMode === 'month' && (
        <View style={styles.monthContainer}>
          {/* Weekday headers */}
          <View style={styles.monthWeekHeader}>
            {DIAS_SEMANA_SHORT.map((d, i) => (
              <Text key={i} style={styles.monthWeekHeaderText}>{d}</Text>
            ))}
          </View>

          {/* Days grid */}
          <View style={styles.monthGrid}>
            {diasCalendarioMes.map((date, index) => {
              if (!date) {
                return <View key={`empty-${index}`} style={styles.monthDayEmpty} />;
              }

              const dayKey = getDayKey(date);
              const sessoesDia = getSessoesForDay(date);
              const hasSessoes = sessoesDia.length > 0;
              const isDiaHoje = isToday(date);
              const isSelected = selectedDays.has(dayKey);
              const totalMinutos = getTotalMinutosForDay(date);

              return (
                <TouchableOpacity
                  key={dayKey}
                  style={[
                    styles.monthDay,
                    isDiaHoje && styles.monthDayToday,
                    isSelected && styles.monthDaySelected,
                    hasSessoes && styles.monthDayHasData,
                  ]}
                  onPress={() => handleDayPress(dayKey, hasSessoes)}
                  onLongPress={() => handleDayLongPress(dayKey, hasSessoes)}
                  delayLongPress={400}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.monthDayNumber,
                    isDiaHoje && styles.monthDayNumberToday,
                    isSelected && styles.monthDayNumberSelected,
                  ]}>
                    {date.getDate()}
                  </Text>
                  {hasSessoes && totalMinutos > 0 && (
                    <View style={styles.monthDayIndicator} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Expanded day report for month view */}
          {expandedDay && !selectionMode && (
            <View style={styles.monthExpandedReport}>
              {renderDayReport(new Date(expandedDay.replace(/-/g, '/')))}
            </View>
          )}
        </View>
      )}

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
      <Modal
        visible={showManualModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowManualModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📝 Manual Entry</Text>
            <Text style={styles.modalSubtitle}>
              {manualDate.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'short' })}
            </Text>

            <Text style={styles.inputLabel}>Location:</Text>
            <View style={styles.localPicker}>
              {locais.map((local) => (
                <TouchableOpacity
                  key={local.id}
                  style={[styles.localOption, manualLocalId === local.id && styles.localOptionActive]}
                  onPress={() => setManualLocalId(local.id)}
                >
                  <View style={[styles.localDot, { backgroundColor: local.cor }]} />
                  <Text style={[styles.localOptionText, manualLocalId === local.id && styles.localOptionTextActive]}>
                    {local.nome}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={styles.inputLabel}>Entry:</Text>
                <TextInput
                  style={styles.timeInput}
                  placeholder="08:00"
                  placeholderTextColor={colors.textSecondary}
                  value={manualEntrada}
                  onChangeText={setManualEntrada}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </View>
              <View style={styles.timeField}>
                <Text style={styles.inputLabel}>Exit:</Text>
                <TextInput
                  style={styles.timeInput}
                  placeholder="17:00"
                  placeholderTextColor={colors.textSecondary}
                  value={manualSaida}
                  onChangeText={setManualSaida}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </View>
            </View>

            <View style={styles.pausaRow}>
              <Text style={styles.inputLabel}>Break (min):</Text>
              <TextInput
                style={styles.pausaInput}
                placeholder="60"
                placeholderTextColor={colors.textSecondary}
                value={manualPausa}
                onChangeText={setManualPausa}
                keyboardType="numeric"
                maxLength={3}
              />
              <Text style={styles.pausaHint}>Lunch, breaks, etc.</Text>
            </View>

            <Text style={styles.inputHint}>Time format HH:MM • Break in minutes</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowManualModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveManual}>
                <Text style={styles.saveBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ============================================
// STYLES
// ============================================

const MONTH_DAY_SIZE = (SCREEN_WIDTH - 32 - 12) / 7;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { 
    padding: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 16 : 60,
  },

  // HEADER
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
  greeting: { fontSize: 16, fontWeight: '500', color: colors.textSecondary },

  // TIMER
  timerCard: { padding: 20, marginBottom: 0, alignItems: 'center' },
  timerCardActive: { backgroundColor: withOpacity(colors.success, 0.1), borderWidth: 1, borderColor: colors.success },
  timerCardIdle: { backgroundColor: withOpacity(colors.primary, 0.1) },
  
  locationBadge: {
    backgroundColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 12,
  },
  locationBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.black,
  },
  
  timerHint: { fontSize: 14, color: colors.textSecondary, marginBottom: 8 },
  timer: { fontSize: 48, fontWeight: 'bold', fontVariant: ['tabular-nums'], color: colors.text, marginBottom: 8 },
  timerPaused: { opacity: 0.4 },
  timerActions: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  actionBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, minWidth: 110, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: colors.white },
  pauseBtn: { backgroundColor: colors.warning },
  continueBtn: { backgroundColor: colors.success },
  stopBtn: { backgroundColor: colors.error },
  startBtn: { backgroundColor: colors.primary },

  pausaContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginBottom: 16, gap: 8 },
  pausaLabel: { fontSize: 14, color: colors.textSecondary },
  pausaTimer: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'], color: colors.textSecondary },
  pausaTimerActive: { color: colors.warning },

  sectionDivider: { height: 1, backgroundColor: colors.border, marginVertical: 16, marginHorizontal: 20, opacity: 0.5 },

  // CALENDAR CARD
  calendarCard: { padding: 16, marginBottom: 0 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarCenter: { alignItems: 'center', flex: 1 },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  navBtnText: { color: colors.black, fontSize: 14, fontWeight: 'bold' },
  calendarTitle: { fontSize: 14, fontWeight: '500', color: colors.textSecondary, textAlign: 'center' },
  calendarTotal: { fontSize: 22, fontWeight: 'bold', color: colors.primary, textAlign: 'center' },

  // VIEW TOGGLE
  viewToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
  },
  viewToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: colors.backgroundTertiary,
  },
  viewToggleBtnActive: {
    backgroundColor: colors.primary,
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  viewToggleTextActive: {
    color: colors.black,
  },

  // SELECTION
  selectionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, marginBottom: 12 },
  selectionText: { color: colors.black, fontSize: 14, fontWeight: '500' },
  selectionCancel: { color: colors.black, fontSize: 14, fontWeight: '600' },

  // WEEK VIEW - DAY ROW
  dayRow: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 10, marginBottom: 6, alignItems: 'center' },
  dayRowToday: { borderWidth: 2, borderColor: colors.primary },
  dayRowSelected: { backgroundColor: withOpacity(colors.primary, 0.1), borderWidth: 2, borderColor: colors.primary },
  
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 10, justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.black, fontSize: 14, fontWeight: 'bold' },
  
  dayLeft: { width: 44, alignItems: 'center', marginRight: 10 },
  dayName: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  dayNameToday: { color: colors.primary },
  dayCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  dayCircleToday: { borderColor: colors.primary, backgroundColor: colors.primary },
  dayNumber: { fontSize: 14, fontWeight: 'bold', color: colors.text },
  dayNumberToday: { color: colors.black },
  dayRight: { flex: 1 },
  dayEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayEmptyText: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
  addBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  addBtnText: { color: colors.black, fontSize: 18, fontWeight: 'bold', marginTop: -2 },
  dayPreview: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  dayPreviewDuration: { fontSize: 14, fontWeight: '600', color: colors.primary },
  expandIcon: { fontSize: 10, color: colors.textSecondary, marginLeft: 8 },

  // MONTH VIEW
  monthContainer: {
    marginBottom: 8,
  },
  monthWeekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  monthWeekHeaderText: {
    width: MONTH_DAY_SIZE,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  monthDayEmpty: {
    width: MONTH_DAY_SIZE,
    height: MONTH_DAY_SIZE,
  },
  monthDay: {
    width: MONTH_DAY_SIZE,
    height: MONTH_DAY_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  monthDayToday: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  monthDaySelected: {
    backgroundColor: colors.primary,
  },
  monthDayHasData: {
    backgroundColor: withOpacity(colors.primary, 0.2),
  },
  monthDayNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  monthDayNumberToday: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  monthDayNumberSelected: {
    color: colors.black,
    fontWeight: 'bold',
  },
  monthDayIndicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 2,
  },
  monthExpandedReport: {
    marginTop: 12,
  },

  // DAY REPORT (expanded)
  dayReportContainer: {
    marginBottom: 8,
  },
  reportCard: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: 12,
    padding: 12,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reportDate: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  reportActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtnInline: {
    padding: 4,
  },
  actionBtnInlineText: {
    fontSize: 16,
  },
  reportSession: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: withOpacity(colors.border, 0.5),
  },
  reportLocal: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  reportTimeGps: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  reportTimeEdited: {
    fontSize: 13,
    color: colors.warning,
    marginBottom: 2,
  },
  reportPausa: {
    fontSize: 12,
    color: colors.textTertiary,
    marginBottom: 2,
  },
  reportSessionTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  reportDayTotal: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reportDayTotalText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'right',
  },

  // EXPORT
  exportBtn: { backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  exportBtnText: { color: colors.black, fontSize: 15, fontWeight: '600' },
  exportBtnSecondary: { backgroundColor: colors.backgroundSecondary, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: colors.primary },
  exportBtnSecondaryText: { color: colors.primary, fontSize: 15, fontWeight: '600' },

  // MODAL
  modalOverlay: { flex: 1, backgroundColor: withOpacity(colors.black, 0.7), justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.backgroundSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text, textAlign: 'center' },
  modalSubtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 6 },
  localPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  localOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: colors.backgroundTertiary, borderWidth: 1, borderColor: colors.border },
  localOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  localDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  localOptionText: { fontSize: 13, color: colors.text },
  localOptionTextActive: { color: colors.black, fontWeight: '500' },

  timeRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  timeField: { flex: 1 },
  timeInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 18, textAlign: 'center', fontWeight: '600', backgroundColor: colors.backgroundTertiary, color: colors.text },
  pausaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  pausaInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, textAlign: 'center', fontWeight: '600', width: 70, backgroundColor: colors.backgroundTertiary, color: colors.text },
  pausaHint: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  inputHint: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: colors.backgroundTertiary, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  saveBtnText: { fontSize: 15, color: colors.black, fontWeight: '600' },
});
