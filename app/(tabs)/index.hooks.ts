/**
 * Home Screen Hook - OnSite Timekeeper
 * 
 * Custom hook que encapsula toda a lógica da HomeScreen:
 * - States
 * - Effects
 * - Handlers
 * - Computed values
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Alert, Share } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { useAuthStore } from '../../src/stores/authStore';
import { useLocationStore } from '../../src/stores/locationStore';
import { useRegistroStore } from '../../src/stores/registroStore';
import { useSyncStore } from '../../src/stores/syncStore';
import { formatarDuracao } from '../../src/lib/database';
import type { SessaoComputada } from '../../src/lib/database';
import { gerarRelatorioCompleto } from '../../src/lib/reports';

import {
  DIAS_SEMANA,
  getInicioSemana,
  getFimSemana,
  getInicioMes,
  getFimMes,
  getMonthCalendarDays,
  formatDateRange,
  formatMonthYear,
  formatTimeAMPM,
  isSameDay,
  isToday,
  getDayKey,
  type DiaCalendario,
} from './index.helpers';

// ============================================
// HOOK
// ============================================

export function useHomeScreen() {
  // ============================================
  // STORES
  // ============================================
  
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
  // Campos separados HH:MM para melhor UX
  const [manualEntradaH, setManualEntradaH] = useState('');
  const [manualEntradaM, setManualEntradaM] = useState('');
  const [manualSaidaH, setManualSaidaH] = useState('');
  const [manualSaidaM, setManualSaidaM] = useState('');
  const [manualPausa, setManualPausa] = useState('');

  // Session finished modal
  const [showSessionFinishedModal, setShowSessionFinishedModal] = useState(false);

  // ============================================
  // DERIVED STATE
  // ============================================

  const localAtivo = geofenceAtivo ? locais.find(l => l.id === geofenceAtivo) : null;
  const podeRecomecar = localAtivo && !sessaoAtual;
  const sessoes = viewMode === 'week' ? sessoesSemana : sessoesMes;
  const inicioSemana = getInicioSemana(semanaAtual);
  const fimSemana = getFimSemana(semanaAtual);

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

  // Session finished modal effect
  useEffect(() => {
    if (ultimaSessaoFinalizada) {
      setShowSessionFinishedModal(true);
    } else {
      setShowSessionFinishedModal(false);
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

  // ============================================
  // SESSION MODAL HANDLERS
  // ============================================

  const handleDismissSessionModal = () => {
    setShowSessionFinishedModal(false);
    limparUltimaSessao();
  };

  const handleShareSession = async () => {
    await compartilharUltimaSessao();
    handleDismissSessionModal();
  };

  // ============================================
  // REFRESH
  // ============================================

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

  const diasCalendarioMes = useMemo(() => {
    return getMonthCalendarDays(mesAtual);
  }, [mesAtual]);

  const getSessoesForDay = useCallback((date: Date): SessaoComputada[] => {
    return sessoes.filter(s => {
      const sessaoDate = new Date(s.entrada);
      return isSameDay(sessaoDate, date);
    });
  }, [sessoes]);

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

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedDays(new Set());
  };

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

  // ============================================
  // MANUAL ENTRY
  // ============================================

  const openManualEntry = (date: Date) => {
    setManualDate(date);
    setManualLocalId(locais[0]?.id || '');
    // Valores default: 08:00 e 17:00
    setManualEntradaH('08');
    setManualEntradaM('00');
    setManualSaidaH('17');
    setManualSaidaM('00');
    setManualPausa('');
    setShowManualModal(true);
  };

  const handleSaveManual = async () => {
    if (!manualLocalId) {
      Alert.alert('Error', 'Select a location');
      return;
    }
    if (!manualEntradaH || !manualEntradaM || !manualSaidaH || !manualSaidaM) {
      Alert.alert('Error', 'Fill in entry and exit times');
      return;
    }

    const entradaH = parseInt(manualEntradaH, 10);
    const entradaM = parseInt(manualEntradaM, 10);
    const saidaH = parseInt(manualSaidaH, 10);
    const saidaM = parseInt(manualSaidaM, 10);

    if (isNaN(entradaH) || isNaN(entradaM) || isNaN(saidaH) || isNaN(saidaM)) {
      Alert.alert('Error', 'Invalid time format');
      return;
    }
    
    // Validação de range
    if (entradaH < 0 || entradaH > 23 || entradaM < 0 || entradaM > 59 ||
        saidaH < 0 || saidaH > 23 || saidaM < 0 || saidaM > 59) {
      Alert.alert('Error', 'Invalid time values');
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
  // DELETE DAY
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

  // ============================================
  // RETURN
  // ============================================

  return {
    // Data
    userName,
    locais,
    sessaoAtual,
    ultimaSessaoFinalizada,
    localAtivo,
    podeRecomecar,
    isGeofencingAtivo,
    
    // Timer
    cronometro,
    isPaused,
    pausaCronometro,
    
    // Calendar
    viewMode,
    setViewMode,
    mesAtual,
    inicioSemana,
    fimSemana,
    sessoes,
    diasCalendarioSemana,
    diasCalendarioMes,
    totalSemanaMinutos,
    totalMesMinutos,
    expandedDay,
    
    // Selection
    selectionMode,
    selectedDays,
    cancelSelection,
    
    // Modals
    showManualModal,
    setShowManualModal,
    showSessionFinishedModal,
    manualDate,
    manualLocalId,
    setManualLocalId,
    // Campos separados HH:MM
    manualEntradaH,
    setManualEntradaH,
    manualEntradaM,
    setManualEntradaM,
    manualSaidaH,
    setManualSaidaH,
    manualSaidaM,
    setManualSaidaM,
    manualPausa,
    setManualPausa,
    
    // Refresh
    refreshing,
    onRefresh,
    
    // Timer handlers
    handlePausar,
    handleContinuar,
    handleParar,
    handleRecomecar,
    
    // Navigation handlers
    goToPreviousWeek,
    goToNextWeek,
    goToCurrentWeek,
    goToPreviousMonth,
    goToNextMonth,
    goToCurrentMonth,
    
    // Day handlers
    handleDayPress,
    handleDayLongPress,
    getSessoesForDay,
    getTotalMinutosForDay,
    
    // Modal handlers
    openManualEntry,
    handleSaveManual,
    handleDismissSessionModal,
    handleShareSession,
    handleDeleteDay,
    handleExport,
    
    // Helpers (re-export for JSX)
    formatDateRange,
    formatMonthYear,
    formatTimeAMPM,
    formatarDuracao,
    isToday,
    getDayKey,
    isSameDay,
  };
}

// Export type for use in component
export type UseHomeScreenReturn = ReturnType<typeof useHomeScreen>;
