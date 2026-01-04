/**
 * Home/Dashboard Screen - OnSite Timekeeper
 * 
 * UI Consolidada:
 * - Cronômetro com stats inline
 * - Calendário semanal integrado
 * - Entrada manual [+]
 * - Exportar relatório
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
  Modal,
  TextInput,
  Platform,
  Share,
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

// ============================================
// HELPERS
// ============================================

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

function formatDateRange(inicio: Date, fim: Date): string {
  const formatDay = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  return `${formatDay(inicio)} - ${formatDay(fim)}`;
}

// Formato AM/PM
function formatTimeAMPM(iso: string): string {
  const date = new Date(iso);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 vira 12
  return `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function formatDateExport(date: Date): string {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

interface DiaCalendario {
  data: Date;
  diaSemana: string;
  diaNumero: number;
  sessoes: SessaoComputada[];
  totalMinutos: number;
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

export default function HomeScreen() {
  const userName = useAuthStore(s => s.getUserName());
  const { locais, geofenceAtivo, isGeofencingAtivo, precisao } = useLocationStore();
  const { 
    sessaoAtual, 
    estatisticasHoje, 
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
  const { isOnline, syncNow } = useSyncStore();

  const [refreshing, setRefreshing] = useState(false);
  const [cronometro, setCronometro] = useState('00:00:00');
  const [isPaused, setIsPaused] = useState(false);

  // Calendário
  const [semanaAtual, setSemanaAtual] = useState(new Date());
  const [sessoesSemana, setSessoesSemana] = useState<SessaoComputada[]>([]);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  
  // Seleção múltipla
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());

  // Modal entrada manual / edição
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [manualDate, setManualDate] = useState<Date>(new Date());
  const [manualLocalId, setManualLocalId] = useState<string>('');
  const [manualEntrada, setManualEntrada] = useState('');
  const [manualSaida, setManualSaida] = useState('');
  const [manualPausa, setManualPausa] = useState(''); // minutos de pausa

  // Local ativo
  const localAtivo = geofenceAtivo ? locais.find(l => l.id === geofenceAtivo) : null;
  const podeRecomecar = localAtivo && !sessaoAtual;

  // ============================================
  // CRONÔMETRO
  // ============================================

  useEffect(() => {
    if (!sessaoAtual || sessaoAtual.status !== 'ativa') {
      setCronometro('00:00:00');
      setIsPaused(false);
      return;
    }

    if (isPaused) return;

    const updateCronometro = () => {
      const inicio = new Date(sessaoAtual.entrada).getTime();
      const agora = Date.now();
      const diff = Math.floor((agora - inicio) / 1000);

      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;

      setCronometro(
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      );
    };

    updateCronometro();
    const interval = setInterval(updateCronometro, 1000);
    return () => clearInterval(interval);
  }, [sessaoAtual, isPaused]);

  // Sessão finalizada alert
  useEffect(() => {
    if (ultimaSessaoFinalizada) {
      Alert.alert(
        '✅ Sessão Finalizada',
        `Local: ${ultimaSessaoFinalizada.local_nome}\nDuração: ${formatarDuracao(ultimaSessaoFinalizada.duracao_minutos)}`,
        [
          { text: 'OK', onPress: limparUltimaSessao },
          { text: '📤 Compartilhar', onPress: () => { compartilharUltimaSessao(); limparUltimaSessao(); } },
        ]
      );
    }
  }, [ultimaSessaoFinalizada]);

  // ============================================
  // CARREGAR SESSÕES DA SEMANA
  // ============================================

  const loadSessoesSemana = useCallback(async () => {
    const inicio = getInicioSemana(semanaAtual);
    const fim = getFimSemana(semanaAtual);
    const result = await getSessoesPeriodo(inicio.toISOString(), fim.toISOString());
    setSessoesSemana(result);
  }, [semanaAtual, getSessoesPeriodo]);

  useEffect(() => {
    loadSessoesSemana();
  }, [semanaAtual, loadSessoesSemana]);

  // Recarrega quando sessão muda
  useEffect(() => {
    loadSessoesSemana();
  }, [sessaoAtual]);

  const onRefresh = async () => {
    setRefreshing(true);
    await recarregarDados();
    await loadSessoesSemana();
    await syncNow();
    setRefreshing(false);
  };

  // ============================================
  // AÇÕES DO CRONÔMETRO
  // ============================================

  const handlePausar = () => setIsPaused(true);
  const handleContinuar = () => setIsPaused(false);

  const handleParar = () => {
    if (!sessaoAtual) return;
    Alert.alert(
      '⏹️ Parar Cronômetro',
      'Deseja encerrar a sessão atual?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Parar',
          style: 'destructive',
          onPress: async () => {
            try {
              await registrarSaida(sessaoAtual.local_id);
              setIsPaused(false);
            } catch (error: any) {
              Alert.alert('Erro', error.message || 'Não foi possível encerrar');
            }
          },
        },
      ]
    );
  };

  const handleRecomecar = async () => {
    if (!localAtivo) return;
    Alert.alert(
      '▶️ Iniciar Nova Sessão',
      `Iniciar cronômetro em "${localAtivo.nome}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Iniciar',
          onPress: async () => {
            try {
              await registrarEntrada(localAtivo.id, localAtivo.nome);
            } catch (error: any) {
              Alert.alert('Erro', error.message || 'Não foi possível iniciar');
            }
          },
        },
      ]
    );
  };

  // ============================================
  // CALENDÁRIO
  // ============================================

  const inicioSemana = getInicioSemana(semanaAtual);
  const fimSemana = getFimSemana(semanaAtual);

  const diasCalendario: DiaCalendario[] = [];
  for (let i = 0; i < 7; i++) {
    const data = new Date(inicioSemana);
    data.setDate(data.getDate() + i);

    const sessoesDodia = sessoesSemana.filter(s => {
      const sessaoDate = new Date(s.entrada);
      return isSameDay(sessaoDate, data);
    });

    const totalMinutos = sessoesDodia
      .filter(s => s.saida)
      .reduce((acc, s) => acc + s.duracao_minutos, 0);

    diasCalendario.push({
      data,
      diaSemana: DIAS_SEMANA[data.getDay()],
      diaNumero: data.getDate(),
      sessoes: sessoesDodia,
      totalMinutos,
    });
  }

  const totalSemanaMinutos = sessoesSemana
    .filter(s => s.saida)
    .reduce((acc, s) => acc + s.duracao_minutos, 0);

  const goToPreviousWeek = () => {
    const newDate = new Date(semanaAtual);
    newDate.setDate(newDate.getDate() - 7);
    setSemanaAtual(newDate);
    setExpandedDay(null);
  };

  const goToNextWeek = () => {
    const newDate = new Date(semanaAtual);
    newDate.setDate(newDate.getDate() + 7);
    setSemanaAtual(newDate);
    setExpandedDay(null);
  };

  const goToCurrentWeek = () => {
    setSemanaAtual(new Date());
    setExpandedDay(null);
    cancelSelection();
  };

  // ============================================
  // SELEÇÃO MÚLTIPLA
  // ============================================

  const handleDayPress = (dayKey: string, hasSessoes: boolean) => {
    if (selectionMode) {
      // Em modo seleção, toggle o dia
      toggleSelectDay(dayKey);
    } else if (hasSessoes) {
      // Expande/colapsa
      setExpandedDay(expandedDay === dayKey ? null : dayKey);
    }
  };

  const handleDayLongPress = (dayKey: string, hasSessoes: boolean) => {
    if (!hasSessoes) return; // Não seleciona dias vazios
    
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
  // ENTRADA MANUAL / EDIÇÃO
  // ============================================

  const openManualEntry = (date: Date) => {
    setEditingSessionId(null);
    setManualDate(date);
    setManualLocalId(locais[0]?.id || '');
    setManualEntrada('');
    setManualSaida('');
    setManualPausa('');
    setShowManualModal(true);
  };

  const openEditSession = (sessao: SessaoComputada) => {
    setEditingSessionId(sessao.id);
    setManualDate(new Date(sessao.entrada));
    setManualLocalId(sessao.local_id);
    // Converter para formato HH:MM
    const entradaDate = new Date(sessao.entrada);
    const saidaDate = sessao.saida ? new Date(sessao.saida) : null;
    setManualEntrada(`${entradaDate.getHours().toString().padStart(2, '0')}:${entradaDate.getMinutes().toString().padStart(2, '0')}`);
    setManualSaida(saidaDate ? `${saidaDate.getHours().toString().padStart(2, '0')}:${saidaDate.getMinutes().toString().padStart(2, '0')}` : '');
    setManualPausa(sessao.pausa_minutos ? sessao.pausa_minutos.toString() : '');
    setShowManualModal(true);
  };

  const handleDeleteSession = (sessao: SessaoComputada) => {
    Alert.alert(
      '🗑️ Deletar Registro',
      `Deseja deletar este registro?\n\n${sessao.local_nome}\n${formatTimeAMPM(sessao.entrada)} → ${sessao.saida ? formatTimeAMPM(sessao.saida) : '---'}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Deletar',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletarRegistro(sessao.id);
              loadSessoesSemana();
              setExpandedDay(null);
              Alert.alert('✅ Deletado', 'Registro removido com sucesso');
            } catch (error: any) {
              Alert.alert('Erro', error.message || 'Não foi possível deletar');
            }
          },
        },
      ]
    );
  };

  const handleSaveManual = async () => {
    if (!manualLocalId) {
      Alert.alert('Erro', 'Selecione um local');
      return;
    }

    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timeRegex.test(manualEntrada) || !timeRegex.test(manualSaida)) {
      Alert.alert('Erro', 'Use o formato HH:MM (ex: 08:30)');
      return;
    }

    // Validar pausa (opcional)
    let pausaMinutos = 0;
    if (manualPausa.trim()) {
      pausaMinutos = parseInt(manualPausa, 10);
      if (isNaN(pausaMinutos) || pausaMinutos < 0) {
        Alert.alert('Erro', 'Pausa inválida. Use número de minutos (ex: 60)');
        return;
      }
    }

    const [entradaH, entradaM] = manualEntrada.split(':').map(Number);
    const [saidaH, saidaM] = manualSaida.split(':').map(Number);

    const entradaDate = new Date(manualDate);
    entradaDate.setHours(entradaH, entradaM, 0, 0);

    const saidaDate = new Date(manualDate);
    saidaDate.setHours(saidaH, saidaM, 0, 0);

    if (saidaDate <= entradaDate) {
      Alert.alert('Erro', 'Saída deve ser após a entrada');
      return;
    }

    try {
      if (editingSessionId) {
        // Editando sessão existente
        await editarRegistro(editingSessionId, {
          entrada: entradaDate.toISOString(),
          saida: saidaDate.toISOString(),
          editado_manualmente: 1,
          motivo_edicao: 'Editado pelo usuário',
          pausa_minutos: pausaMinutos,
        });
        Alert.alert('✅ Sucesso', 'Registro atualizado!');
      } else {
        // Criando novo registro manual
        const local = locais.find(l => l.id === manualLocalId);
        await criarRegistroManual({
          localId: manualLocalId,
          localNome: local?.nome || 'Local',
          entrada: entradaDate.toISOString(),
          saida: saidaDate.toISOString(),
          pausaMinutos: pausaMinutos,
        });
        Alert.alert('✅ Sucesso', 'Registro adicionado!');
      }

      setShowManualModal(false);
      setEditingSessionId(null);
      setManualPausa('');
      loadSessoesSemana();
    } catch (error: any) {
      Alert.alert('Erro', error.message || 'Não foi possível salvar');
    }
  };

  // ============================================
  // EXPORTAR (formato compacto)
  // ============================================

  const handleExport = async () => {
    // Pega sessões dos dias selecionados ou todas da semana
    let sessoesToExport: SessaoComputada[];
    
    if (selectionMode && selectedDays.size > 0) {
      sessoesToExport = sessoesSemana.filter(s => {
        const sessaoDate = new Date(s.entrada);
        return Array.from(selectedDays).some(dayKey => {
          const dayDate = new Date(dayKey);
          return isSameDay(sessaoDate, dayDate);
        });
      });
    } else {
      sessoesToExport = sessoesSemana;
    }

    const sessoesFinalizadas = sessoesToExport.filter(s => s.saida);

    if (sessoesFinalizadas.length === 0) {
      Alert.alert('Aviso', 'Nenhuma sessão finalizada para exportar');
      return;
    }

    // Perguntar formato
    Alert.alert(
      '📤 Exportar Relatório',
      'Como deseja exportar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: '💬 Texto (WhatsApp)', 
          onPress: () => exportarComoTexto(sessoesFinalizadas) 
        },
        { 
          text: '📄 Arquivo', 
          onPress: () => exportarComoArquivo(sessoesFinalizadas) 
        },
      ]
    );
  };

  const gerarRelatorioTexto = (sessoes: SessaoComputada[]): string => {
    let txt = '';
    let totalGeralMinutos = 0;

    // Agrupar por data
    const porData = new Map<string, SessaoComputada[]>();
    sessoes.forEach(s => {
      const dataKey = new Date(s.entrada).toDateString();
      if (!porData.has(dataKey)) {
        porData.set(dataKey, []);
      }
      porData.get(dataKey)!.push(s);
    });

    // Ordenar por data
    const datasOrdenadas = Array.from(porData.keys()).sort((a, b) => 
      new Date(a).getTime() - new Date(b).getTime()
    );

    // Nome só uma vez no início
    txt += `${userName || 'Relatório de Horas'}\n`;
    txt += '────────────────────\n\n';

    let localAnterior = '';

    datasOrdenadas.forEach((dataKey, index) => {
      const sessoesDia = porData.get(dataKey)!;
      const dataObj = new Date(dataKey);
      let totalDiaMinutos = 0;
      
      // Data
      txt += `📅 ${formatDateExport(dataObj)}\n`;
      
      sessoesDia.forEach(sessao => {
        const isAjustado = sessao.editado_manualmente === 1 || sessao.tipo === 'manual';
        
        // Local (só se diferente do anterior)
        if (sessao.local_nome !== localAnterior) {
          txt += `📍 ${sessao.local_nome}\n`;
          localAnterior = sessao.local_nome || '';
        }
        
        // Horário GPS (real)
        txt += `${formatTimeAMPM(sessao.entrada)} → ${formatTimeAMPM(sessao.saida!)}\n`;
        
        // Horário ajustado (se houver)
        if (isAjustado) {
          txt += `*Ajustado: ${formatTimeAMPM(sessao.entrada)} → ${formatTimeAMPM(sessao.saida!)}\n`;
        }
        
        // TODO: Pausa
        // if (sessao.pausa_minutos > 0) {
        //   txt += `Pausa: ${formatarDuracao(sessao.pausa_minutos)}\n`;
        //   totalDiaMinutos -= sessao.pausa_minutos;
        // }
        
        totalDiaMinutos += sessao.duracao_minutos;
      });
      
      // Subtotal do dia
      txt += `▸ ${formatarDuracao(totalDiaMinutos)}\n`;
      totalGeralMinutos += totalDiaMinutos;
      
      // Separador entre dias
      if (index < datasOrdenadas.length - 1) {
        txt += '\n';
      }
    });

    // Total geral
    txt += '\n════════════════════\n';
    txt += `TOTAL: ${formatarDuracao(totalGeralMinutos)}\n`;

    return txt;
  };

  const exportarComoTexto = async (sessoes: SessaoComputada[]) => {
    const txt = gerarRelatorioTexto(sessoes);
    
    try {
      await Share.share({
        message: txt,
        title: 'Relatório de Horas',
      });
      cancelSelection();
    } catch (error) {
      console.error('Erro ao compartilhar:', error);
    }
  };

  const exportarComoArquivo = async (sessoes: SessaoComputada[]) => {
    const txt = gerarRelatorioTexto(sessoes);
    
    try {
      const now = new Date();
      const fileName = `relatorio_${now.toISOString().split('T')[0]}.txt`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(filePath, txt, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'text/plain',
          dialogTitle: 'Salvar Relatório',
        });
      }
      
      cancelSelection();
    } catch (error) {
      console.error('Erro ao exportar arquivo:', error);
      Alert.alert('Erro', 'Não foi possível criar o arquivo');
    }
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
      {/* SAUDAÇÃO */}
      <Text style={styles.greeting}>Olá, {userName || 'Trabalhador'}! 👋</Text>

      {/* ════════════════════════════════════════════
          SEÇÃO 1: CRONÔMETRO
          ════════════════════════════════════════════ */}
      <Card style={[
        styles.timerCard,
        sessaoAtual && styles.timerCardActive,
        podeRecomecar && styles.timerCardIdle
      ]}>
        {sessaoAtual ? (
          <>
            <Text style={styles.timerLocal}>{sessaoAtual.local_nome}</Text>
            <Text style={[styles.timer, isPaused && styles.timerPaused]}>{cronometro}</Text>

            <View style={styles.timerActions}>
              {isPaused ? (
                <TouchableOpacity style={[styles.actionBtn, styles.continueBtn]} onPress={handleContinuar}>
                  <Text style={styles.actionBtnText}>▶️ Continuar</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.actionBtn, styles.pauseBtn]} onPress={handlePausar}>
                  <Text style={styles.actionBtnText}>⏸️ Pausar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.actionBtn, styles.stopBtn]} onPress={handleParar}>
                <Text style={styles.actionBtnText}>⏹️ Parar</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : podeRecomecar ? (
          <>
            <Text style={styles.timerLocal}>{localAtivo?.nome}</Text>
            <Text style={styles.timer}>00:00:00</Text>
            <TouchableOpacity style={[styles.actionBtn, styles.startBtn]} onPress={handleRecomecar}>
              <Text style={styles.actionBtnText}>▶️ Iniciar</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.timerHint}>
              {isGeofencingAtivo ? 'Aguardando entrada em local...' : 'Monitoramento inativo'}
            </Text>
            <Text style={styles.timer}>--:--:--</Text>
          </>
        )}
      </Card>

      {/* Separador sutil */}
      <View style={styles.sectionDivider} />

      {/* ════════════════════════════════════════════
          SEÇÃO 2: NAVEGAÇÃO SEMANAL
          ════════════════════════════════════════════ */}
      <Card style={styles.weekCard}>
        <View style={styles.calendarHeader}>
          <TouchableOpacity style={styles.navBtn} onPress={goToPreviousWeek}>
            <Text style={styles.navBtnText}>◀</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={goToCurrentWeek} style={styles.calendarCenter}>
            <Text style={styles.calendarTitle}>
              {formatDateRange(inicioSemana, fimSemana)}
            </Text>
            <Text style={styles.calendarTotal}>
              {formatarDuracao(totalSemanaMinutos)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navBtn} onPress={goToNextWeek}>
            <Text style={styles.navBtnText}>▶</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {/* Separador sutil */}
      <View style={styles.sectionDivider} />

      {/* ════════════════════════════════════════════
          SEÇÃO 3: RELATÓRIOS DIÁRIOS
          ════════════════════════════════════════════ */}

      {/* Botão cancelar seleção */}
      {selectionMode && (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionText}>{selectedDays.size} dia(s) selecionado(s)</Text>
          <TouchableOpacity onPress={cancelSelection}>
            <Text style={styles.selectionCancel}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* DIAS DA SEMANA */}
      {diasCalendario.map((dia) => {
        const dayKey = dia.data.toISOString();
        const isExpanded = expandedDay === dayKey && !selectionMode;
        const hasSessoes = dia.sessoes.length > 0;
        const isDiaHoje = isToday(dia.data);
        const hasAtiva = dia.sessoes.some(s => !s.saida);
        const isSelected = selectedDays.has(dayKey);
        const sessoesFinalizadas = dia.sessoes.filter(s => s.saida);

        return (
          <TouchableOpacity
            key={dayKey}
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
            {/* CHECKBOX (modo seleção) */}
            {selectionMode && hasSessoes && (
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
            )}

            {/* DATA */}
            <View style={styles.dayLeft}>
              <Text style={[styles.dayName, isDiaHoje && styles.dayNameToday]}>
                {dia.diaSemana}
              </Text>
              <View style={[styles.dayCircle, isDiaHoje && styles.dayCircleToday]}>
                <Text style={[styles.dayNumber, isDiaHoje && styles.dayNumberToday]}>
                  {dia.diaNumero}
                </Text>
              </View>
            </View>

            {/* CONTEÚDO */}
            <View style={styles.dayRight}>
              {!hasSessoes ? (
                <View style={styles.dayEmpty}>
                  <Text style={styles.dayEmptyText}>Sem registro</Text>
                  {!selectionMode && (
                    <TouchableOpacity
                      style={styles.addBtn}
                      onPress={(e) => {
                        e.stopPropagation();
                        openManualEntry(dia.data);
                      }}
                    >
                      <Text style={styles.addBtnText}>+</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <>
                  {/* Preview (colapsado) */}
                  {!isExpanded && (
                    <View style={styles.dayPreview}>
                      <Text style={styles.dayPreviewTime}>
                        {formatTimeAMPM(dia.sessoes[0].entrada)}
                        {dia.sessoes[0].saida ? ` → ${formatTimeAMPM(dia.sessoes[0].saida)}` : ' → ⏱️'}
                      </Text>
                      <Text style={[styles.dayPreviewDuration, hasAtiva && { color: colors.success }]}>
                        {hasAtiva ? 'Em andamento' : formatarDuracao(dia.totalMinutos)}
                      </Text>
                    </View>
                  )}

                  {/* Expandido - Relatório Compacto */}
                  {isExpanded && (
                    <View style={styles.dayExpanded}>
                      {sessoesFinalizadas.map((sessao) => {
                        const isManual = sessao.tipo === 'manual';
                        const isAjustado = sessao.editado_manualmente === 1 && !isManual;
                        const pausaMin = sessao.pausa_minutos || 0;
                        const totalLiquido = sessao.duracao_minutos - pausaMin;
                        
                        return (
                          <View key={sessao.id} style={styles.reportCard}>
                            {/* Header com local + botões */}
                            <View style={styles.reportHeader}>
                              <Text style={styles.reportLocal}>{sessao.local_nome}</Text>
                              <View style={styles.reportActions}>
                                <TouchableOpacity
                                  style={styles.actionBtnInline}
                                  onPress={() => openEditSession(sessao)}
                                >
                                  <Text style={styles.actionBtnInlineText}>✏️</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.actionBtnInline}
                                  onPress={() => handleDeleteSession(sessao)}
                                >
                                  <Text style={styles.actionBtnInlineText}>🗑️</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                            
                            {/* Se é manual: só mostra a hora inserida (com *) */}
                            {isManual ? (
                              <Text style={styles.reportTimeAdjusted}>
                                *{formatTimeAMPM(sessao.entrada)} → {formatTimeAMPM(sessao.saida!)}
                              </Text>
                            ) : (
                              <>
                                {/* Horário GPS (real) */}
                                <Text style={styles.reportTime}>
                                  {formatTimeAMPM(sessao.entrada)} → {formatTimeAMPM(sessao.saida!)}
                                </Text>
                                
                                {/* Se ajustado após GPS: mostra linha ajustada */}
                                {isAjustado && (
                                  <Text style={styles.reportTimeAdjusted}>
                                    *Ajustado
                                  </Text>
                                )}
                              </>
                            )}
                            
                            {/* Pausa (se houver) */}
                            {pausaMin > 0 && (
                              <Text style={styles.reportPausa}>
                                Pausa: {formatarDuracao(pausaMin)}
                              </Text>
                            )}
                            
                            {/* Total */}
                            <Text style={styles.reportTotal}>
                              {formatarDuracao(totalLiquido)}
                            </Text>
                          </View>
                        );
                      })}
                      
                      {/* Total do dia se múltiplas sessões */}
                      {sessoesFinalizadas.length > 1 && (
                        <Text style={styles.dayTotalText}>
                          Total do dia: {formatarDuracao(dia.totalMinutos)}
                        </Text>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>

            {hasSessoes && !selectionMode && (
              <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
            )}
          </TouchableOpacity>
        );
      })}

      {/* BOTÃO EXPORTAR */}
      {selectionMode ? (
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
          <Text style={styles.exportBtnText}>📤 Exportar {selectedDays.size} dia(s)</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.exportBtnSecondary} onPress={handleExport}>
          <Text style={styles.exportBtnSecondaryText}>📤 Exportar Semana</Text>
        </TouchableOpacity>
      )}

      {/* MODAL ENTRADA MANUAL / EDIÇÃO */}
      <Modal
        visible={showManualModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowManualModal(false); setEditingSessionId(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingSessionId ? '✏️ Editar Registro' : '➕ Entrada Manual'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {manualDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>

            {/* Local picker */}
            <Text style={styles.inputLabel}>Local:</Text>
            <View style={styles.localPicker}>
              {locais.map(local => (
                <TouchableOpacity
                  key={local.id}
                  style={[
                    styles.localOption,
                    manualLocalId === local.id && styles.localOptionActive
                  ]}
                  onPress={() => setManualLocalId(local.id)}
                >
                  <View style={[styles.localDot, { backgroundColor: local.cor }]} />
                  <Text style={[
                    styles.localOptionText,
                    manualLocalId === local.id && styles.localOptionTextActive
                  ]}>
                    {local.nome}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Horários */}
            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={styles.inputLabel}>Entrada:</Text>
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
                <Text style={styles.inputLabel}>Saída:</Text>
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

            {/* Pausa */}
            <View style={styles.pausaRow}>
              <Text style={styles.inputLabel}>Pausa (min):</Text>
              <TextInput
                style={styles.pausaInput}
                placeholder="60"
                placeholderTextColor={colors.textSecondary}
                value={manualPausa}
                onChangeText={setManualPausa}
                keyboardType="numeric"
                maxLength={3}
              />
              <Text style={styles.pausaHint}>Almoço, intervalo, etc.</Text>
            </View>

            <Text style={styles.inputHint}>Horário formato HH:MM • Pausa em minutos</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={styles.cancelBtn} 
                onPress={() => { setShowManualModal(false); setEditingSessionId(null); }}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveManual}>
                <Text style={styles.saveBtnText}>{editingSessionId ? 'Salvar' : 'Adicionar'}</Text>
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
// ESTILOS
// ============================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { padding: 16 },

  greeting: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },

  // Timer
  timerCard: {
    padding: 20,
    marginBottom: 0,
    alignItems: 'center',
  },
  timerCardActive: {
    backgroundColor: withOpacity(colors.success, 0.1),
    borderWidth: 1,
    borderColor: colors.success,
  },
  timerCardIdle: {
    backgroundColor: withOpacity(colors.primary, 0.1),
  },
  timerLocal: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  timerHint: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  timer: {
    fontSize: 48,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
    color: colors.text,
    marginBottom: 16,
  },
  timerPaused: { opacity: 0.4 },
  timerActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  actionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    minWidth: 110,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  pauseBtn: { backgroundColor: colors.warning },
  continueBtn: { backgroundColor: colors.success },
  stopBtn: { backgroundColor: colors.error },
  startBtn: { backgroundColor: colors.primary },

  // Separador entre seções
  sectionDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 16,
    marginHorizontal: 20,
    opacity: 0.5,
  },

  // Week Card
  weekCard: {
    padding: 16,
    marginBottom: 0,
  },

  // Calendar Header
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calendarCenter: {
    alignItems: 'center',
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBtnText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  calendarTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  calendarTotal: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'center',
  },

  // Day Row
  dayRow: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    alignItems: 'center',
  },
  dayRowToday: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dayRowSelected: {
    backgroundColor: withOpacity(colors.primary, 0.1),
    borderWidth: 2,
    borderColor: colors.primary,
  },
  
  // Checkbox
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  
  // Selection bar
  selectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  selectionText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
  },
  selectionCancel: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  
  dayLeft: {
    width: 44,
    alignItems: 'center',
    marginRight: 10,
  },
  dayName: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  dayNameToday: {
    color: colors.primary,
  },
  dayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  dayCircleToday: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  dayNumber: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.text,
  },
  dayNumberToday: {
    color: colors.white,
  },
  dayRight: {
    flex: 1,
  },
  dayEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayEmptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: -2,
  },
  dayPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayPreviewTime: {
    fontSize: 14,
    color: colors.text,
  },
  dayPreviewDuration: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  expandIcon: {
    fontSize: 10,
    color: colors.textSecondary,
    marginLeft: 8,
  },

  // Expanded
  dayExpanded: {
    marginTop: 8,
  },
  
  // Report Card (formato compacto)
  reportCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  reportLocal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
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
  reportTime: {
    fontSize: 15,
    color: colors.text,
    marginBottom: 2,
  },
  reportTimeAdjusted: {
    fontSize: 14,
    color: colors.error,
    marginBottom: 2,
  },
  reportPausa: {
    fontSize: 13,
    color: colors.warning,
    marginBottom: 2,
  },
  reportTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primary,
    marginTop: 4,
  },
  
  dayTotalText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'right',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  // Export
  exportBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  exportBtnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  exportBtnSecondary: {
    backgroundColor: colors.white,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  exportBtnSecondaryText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: withOpacity(colors.black, 0.5),
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 6,
  },
  localPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  localOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  localOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  localDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  localOptionText: {
    fontSize: 13,
    color: colors.text,
  },
  localOptionTextActive: {
    color: colors.white,
    fontWeight: '500',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  timeField: {
    flex: 1,
  },
  timeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    textAlign: 'center',
    fontWeight: '600',
    backgroundColor: colors.white,
  },
  pausaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  pausaInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
    width: 70,
    backgroundColor: colors.white,
  },
  pausaHint: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  inputHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 15,
    color: colors.white,
    fontWeight: '600',
  },
});
