/**
 * History Screen - OnSite Timekeeper
 * 
 * Calendário semanal de registros
 * - Navegação por semanas
 * - Clique = expande detalhes
 * - Long press = modo seleção
 * - Exportar CSV como arquivo
 * - Editar (cor vermelha)
 * - Deletar
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
  Share,
  Platform,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { colors, withOpacity } from '../../src/constants/colors';
import { Button, Input } from '../../src/components/ui/Button';
import { useRegistroStore } from '../../src/stores/registroStore';
import { formatarDuracao, type SessaoComputada } from '../../src/lib/database';
import { useAuthStore } from '../../src/stores/authStore';
import { useFocusEffect } from 'expo-router';

// ============================================
// TIPOS
// ============================================

interface DiaCalendario {
  data: Date;
  diaSemana: string;
  diaNumero: number;
  sessoes: SessaoComputada[];
  totalMinutos: number;
}

// ============================================
// HELPERS
// ============================================

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DIAS_SEMANA_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatFullDate(date: Date): string {
  return date.toLocaleDateString('pt-BR', { 
    weekday: 'long', 
    day: '2-digit', 
    month: 'long', 
    year: 'numeric' 
  });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

export default function HistoryScreen() {
  const { recarregarDados, getSessoesPeriodo, deletarRegistro, editarRegistro, sessaoAtual } = useRegistroStore();
  const userName = useAuthStore(s => s.getUserName());

  // Semana atual
  const [semanaAtual, setSemanaAtual] = useState(new Date());
  const [sessoes, setSessoes] = useState<SessaoComputada[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  
  // UI States
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Modal de edição
  const [editingSessao, setEditingSessao] = useState<SessaoComputada | null>(null);
  const [editEntrada, setEditEntrada] = useState('');
  const [editSaida, setEditSaida] = useState('');

  // ============================================
  // DATA LOADING
  // ============================================

  const loadSessoes = useCallback(async () => {
    const inicio = getInicioSemana(semanaAtual);
    const fim = getFimSemana(semanaAtual);
    
    const result = await getSessoesPeriodo(inicio.toISOString(), fim.toISOString());
    setSessoes(result);
  }, [semanaAtual, getSessoesPeriodo]);

  useFocusEffect(
    useCallback(() => {
      loadSessoes();
    }, [loadSessoes])
  );

  useEffect(() => {
    loadSessoes();
  }, [semanaAtual, loadSessoes]);

  useEffect(() => {
    loadSessoes();
  }, [sessaoAtual, loadSessoes]);

  const onRefresh = async () => {
    setRefreshing(true);
    await recarregarDados();
    await loadSessoes();
    setRefreshing(false);
  };

  // ============================================
  // NAVEGAÇÃO DE SEMANAS
  // ============================================

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
    
    const sessoesDodia = sessoes.filter(s => {
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

  // Totais da semana
  const sessoesFinalizadas = sessoes.filter(s => s.saida);
  const totalSemanaMinutos = sessoesFinalizadas.reduce((acc, s) => acc + s.duracao_minutos, 0);
  const totalSessoes = sessoesFinalizadas.length;

  // ============================================
  // SELEÇÃO MÚLTIPLA
  // ============================================

  const handleDayPress = (dayKey: string) => {
    if (selectionMode) return; // Não expande/colapsa quando em modo seleção
    setExpandedDay(expandedDay === dayKey ? null : dayKey);
  };

  const handleSessaoPress = (sessao: SessaoComputada) => {
    // Se está em modo seleção, toggle a seleção
    if (selectionMode) {
      toggleSelectSessao(sessao.id);
      return;
    }
    // Se não está em modo seleção, não faz nada (deixa o dia expandir/colapsar)
  };

  const handleLongPress = (sessao: SessaoComputada) => {
    // Não permite selecionar sessões ativas
    if (!sessao.saida) return;
    
    if (!selectionMode) {
      // Ativa modo seleção com este item
      setSelectionMode(true);
      setSelectedIds(new Set([sessao.id]));
    } else {
      // Já está em modo seleção, adiciona este
      toggleSelectSessao(sessao.id);
    }
  };

  const toggleSelectSessao = (sessaoId: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(sessaoId)) {
      newSet.delete(sessaoId);
      // Se não tem mais nenhum selecionado, sai do modo seleção
      if (newSet.size === 0) {
        setSelectionMode(false);
      }
    } else {
      newSet.add(sessaoId);
    }
    setSelectedIds(newSet);
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const selectAll = () => {
    const allIds = sessoesFinalizadas.map(s => s.id);
    if (allIds.length > 0) {
      setSelectionMode(true);
      setSelectedIds(new Set(allIds));
    }
  };

  // ============================================
  // AÇÕES
  // ============================================

  const handleDelete = () => {
    if (selectedIds.size === 0) return;
    
    Alert.alert(
      '🗑️ Deletar Registros',
      `Deseja deletar ${selectedIds.size} registro(s)? Esta ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Deletar',
          style: 'destructive',
          onPress: async () => {
            try {
              for (const id of selectedIds) {
                await deletarRegistro(id);
              }
              cancelSelection();
              loadSessoes();
              Alert.alert('✅ Sucesso', 'Registros deletados!');
            } catch (error: any) {
              Alert.alert('Erro', error.message || 'Não foi possível deletar');
            }
          },
        },
      ]
    );
  };

  const handleEdit = () => {
    if (selectedIds.size !== 1) {
      Alert.alert('Editar', 'Selecione apenas 1 registro para editar');
      return;
    }
    
    const sessaoId = Array.from(selectedIds)[0];
    const sessao = sessoes.find(s => s.id === sessaoId);
    
    if (!sessao) return;
    if (!sessao.saida) {
      Alert.alert('Erro', 'Não é possível editar uma sessão em andamento');
      return;
    }
    
    setEditingSessao(sessao);
    setEditEntrada(formatTime(sessao.entrada));
    setEditSaida(formatTime(sessao.saida));
  };

  const handleSaveEdit = async () => {
    if (!editingSessao) return;
    
    // Validar formato HH:MM
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timeRegex.test(editEntrada) || !timeRegex.test(editSaida)) {
      Alert.alert('Erro', 'Use o formato HH:MM (ex: 08:30)');
      return;
    }
    
    try {
      // Construir novas datas
      const entradaDate = new Date(editingSessao.entrada);
      const [entradaH, entradaM] = editEntrada.split(':').map(Number);
      entradaDate.setHours(entradaH, entradaM, 0, 0);
      
      const saidaDate = new Date(editingSessao.saida!);
      const [saidaH, saidaM] = editSaida.split(':').map(Number);
      saidaDate.setHours(saidaH, saidaM, 0, 0);
      
      if (saidaDate <= entradaDate) {
        Alert.alert('Erro', 'Saída deve ser após a entrada');
        return;
      }
      
      await editarRegistro(editingSessao.id, {
        entrada: entradaDate.toISOString(),
        saida: saidaDate.toISOString(),
        editado_manualmente: 1,
        motivo_edicao: 'Editado pelo usuário',
      });
      
      setEditingSessao(null);
      cancelSelection();
      loadSessoes();
      Alert.alert('✅ Sucesso', 'Registro atualizado!');
    } catch (error: any) {
      Alert.alert('Erro', error.message || 'Não foi possível editar');
    }
  };

  // ============================================
  // EXPORTAR TXT (abre em Notes/qualquer app)
  // ============================================

  const handleExport = async () => {
    const toExport = selectedIds.size > 0
      ? sessoesFinalizadas.filter(s => selectedIds.has(s.id))
      : sessoesFinalizadas;
    
    if (toExport.length === 0) {
      Alert.alert('Aviso', 'Nenhuma sessão finalizada para exportar');
      return;
    }
    
    // Agrupar por local
    const grupos = new Map<string, { localNome: string; sessoes: SessaoComputada[]; subtotal: number }>();
    
    toExport.forEach(s => {
      const key = s.local_id;
      if (!grupos.has(key)) {
        grupos.set(key, { localNome: s.local_nome || 'Local desconhecido', sessoes: [], subtotal: 0 });
      }
      const grupo = grupos.get(key)!;
      grupo.sessoes.push(s);
      grupo.subtotal += s.duracao_minutos;
    });
    
    // Gerar TXT formatado (legível em Notes)
    const now = new Date();
    const periodo = formatDateRange(inicioSemana, fimSemana);
    
    let txt = '════════════════════════════════════\n';
    txt += '       RELATÓRIO DE HORAS\n';
    txt += '════════════════════════════════════\n\n';
    txt += `👤 ${userName || 'Usuário'}\n`;
    txt += `📅 Período: ${periodo}\n`;
    txt += `🕐 Gerado: ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}\n\n`;
    
    let totalGeral = 0;
    
    grupos.forEach((grupo) => {
      txt += '────────────────────────────────────\n';
      txt += `📍 ${grupo.localNome}\n`;
      txt += '────────────────────────────────────\n\n';
      
      grupo.sessoes
        .sort((a, b) => new Date(a.entrada).getTime() - new Date(b.entrada).getTime())
        .forEach(s => {
          const data = new Date(s.entrada).toLocaleDateString('pt-BR');
          const entrada = formatTime(s.entrada);
          const saida = s.saida ? formatTime(s.saida) : '---';
          const duracao = formatarDuracao(s.duracao_minutos);
          txt += `  ${data}  |  ${entrada} → ${saida}  |  ${duracao}\n`;
        });
      
      txt += `\n  ► Subtotal: ${formatarDuracao(grupo.subtotal)}\n\n`;
      totalGeral += grupo.subtotal;
    });
    
    txt += '════════════════════════════════════\n';
    txt += `       TOTAL GERAL: ${formatarDuracao(totalGeral)}\n`;
    txt += '════════════════════════════════════\n';
    txt += '\nOnSite Timekeeper\n';
    
    // Salvar e compartilhar como TXT
    try {
      const fileName = `relatorio_horas_${now.toISOString().split('T')[0]}.txt`;
      const filePath = `${FileSystem.documentDirectory}${fileName}`;
      
      await FileSystem.writeAsStringAsync(filePath, txt, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'text/plain',
          dialogTitle: 'Exportar Relatório',
          UTI: 'public.plain-text',
        });
      } else {
        // Fallback para Share nativo
        await Share.share({
          message: txt,
          title: 'Relatório de Horas',
        });
      }
      
      cancelSelection();
    } catch (error) {
      console.error('Erro ao exportar:', error);
      Alert.alert('Erro', 'Não foi possível exportar o relatório');
    }
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <View style={styles.container}>
      {/* HEADER - Navegação de semanas */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.navButton} onPress={goToPreviousWeek}>
          <Text style={styles.navButtonText}>◀</Text>
        </TouchableOpacity>
        
        <TouchableOpacity onPress={goToCurrentWeek}>
          <Text style={styles.headerTitle}>
            📅 {formatDateRange(inicioSemana, fimSemana)}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navButton} onPress={goToNextWeek}>
          <Text style={styles.navButtonText}>▶</Text>
        </TouchableOpacity>
      </View>

      {/* RESUMO DA SEMANA */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{formatarDuracao(totalSemanaMinutos)}</Text>
          <Text style={styles.summaryLabel}>Total da Semana</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalSessoes}</Text>
          <Text style={styles.summaryLabel}>Sessões</Text>
        </View>
      </View>

      {/* CALENDÁRIO */}
      <ScrollView
        style={styles.calendar}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {diasCalendario.map((dia) => {
          const dayKey = dia.data.toISOString();
          const isExpanded = expandedDay === dayKey;
          const hasSessoes = dia.sessoes.length > 0;
          const hasAtiva = dia.sessoes.some(s => !s.saida);
          const isDiaHoje = isToday(dia.data);

          return (
            <TouchableOpacity
              key={dayKey}
              style={[
                styles.dayCard,
                hasSessoes && styles.dayCardWithSessoes,
                isDiaHoje && styles.dayCardToday,
              ]}
              onPress={() => handleDayPress(dayKey)}
              activeOpacity={0.7}
            >
              {/* DIA - Lado esquerdo */}
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

              {/* CONTEÚDO - Lado direito */}
              <View style={styles.dayRight}>
                {!hasSessoes ? (
                  <Text style={styles.noShift}>- Sem registro -</Text>
                ) : (
                  <>
                    {/* Preview (quando não expandido) */}
                    {!isExpanded && (
                      <View style={styles.dayPreview}>
                        <Text style={styles.dayPreviewTime}>
                          {formatTime(dia.sessoes[0].entrada)}
                          {dia.sessoes[0].saida ? ` - ${formatTime(dia.sessoes[0].saida)}` : ' - Em andamento'}
                        </Text>
                        <Text style={[styles.dayPreviewDuration, hasAtiva && { color: colors.success }]}>
                          {hasAtiva ? '⏱️' : formatarDuracao(dia.totalMinutos)}
                        </Text>
                      </View>
                    )}

                    {/* Preview - Local */}
                    {!isExpanded && (
                      <View style={styles.dayPreviewLocal}>
                        <View style={[styles.localDot, { backgroundColor: dia.sessoes[0].cor || colors.primary }]} />
                        <Text style={styles.dayPreviewLocalText} numberOfLines={1}>
                          {dia.sessoes[0].local_nome}
                        </Text>
                        {dia.sessoes.length > 1 && (
                          <Text style={styles.moreText}>+{dia.sessoes.length - 1}</Text>
                        )}
                      </View>
                    )}

                    {/* Detalhes expandidos */}
                    {isExpanded && (
                      <View style={styles.expandedContent}>
                        {dia.sessoes.map((sessao) => {
                          const isSelected = selectedIds.has(sessao.id);
                          const isAtiva = !sessao.saida;
                          
                          return (
                            <TouchableOpacity
                              key={sessao.id}
                              style={[
                                styles.sessaoItem,
                                isSelected && styles.sessaoItemSelected,
                                isAtiva && styles.sessaoItemAtiva,
                              ]}
                              onPress={() => handleSessaoPress(sessao)}
                              onLongPress={() => handleLongPress(sessao)}
                              delayLongPress={400}
                            >
                              {selectionMode && (
                                <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                                </View>
                              )}
                              
                              <View style={[styles.localDot, { backgroundColor: sessao.cor || colors.primary }]} />
                              
                              <View style={styles.sessaoInfo}>
                                <Text style={styles.sessaoLocal}>{sessao.local_nome}</Text>
                                <Text style={styles.sessaoTime}>
                                  {formatTime(sessao.entrada)} → {sessao.saida ? formatTime(sessao.saida) : 'Em andamento'}
                                </Text>
                                {sessao.editado_manualmente === 1 && (
                                  <Text style={styles.editedBadge}>✏️ Editado</Text>
                                )}
                              </View>
                              
                              <Text style={[styles.sessaoDuration, isAtiva && { color: colors.success }]}>
                                {isAtiva ? '⏱️' : formatarDuracao(sessao.duracao_minutos)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                        
                        {/* Total do dia */}
                        {dia.sessoes.filter(s => s.saida).length > 1 && (
                          <View style={styles.dayTotal}>
                            <Text style={styles.dayTotalText}>
                              Total do dia: {formatarDuracao(dia.totalMinutos)}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                )}
              </View>

              {/* Indicador de expansão */}
              {hasSessoes && (
                <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
              )}
            </TouchableOpacity>
          );
        })}
        
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* BARRA DE AÇÕES (modo seleção) */}
      {selectionMode && (
        <View style={styles.actionBar}>
          <View style={styles.actionBarTop}>
            <Text style={styles.actionBarTitle}>
              {selectedIds.size} selecionado(s)
            </Text>
            <View style={styles.actionBarButtons}>
              <TouchableOpacity onPress={selectAll}>
                <Text style={styles.actionBarLink}>Selecionar todos</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={cancelSelection}>
                <Text style={styles.actionBarCancel}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={styles.actionBarActions}>
            <TouchableOpacity style={styles.actionButton} onPress={handleDelete}>
              <Text style={styles.actionButtonIcon}>🗑️</Text>
              <Text style={styles.actionButtonText}>Deletar</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.actionButton} onPress={handleExport}>
              <Text style={styles.actionButtonIcon}>📤</Text>
              <Text style={styles.actionButtonText}>Exportar</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.actionButton, styles.actionButtonEdit]} 
              onPress={handleEdit}
              disabled={selectedIds.size !== 1}
            >
              <Text style={styles.actionButtonIcon}>✏️</Text>
              <Text style={[styles.actionButtonText, styles.actionButtonTextEdit]}>Editar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* BOTÃO EXPORTAR (quando não em modo seleção) */}
      {!selectionMode && sessoesFinalizadas.length > 0 && (
        <TouchableOpacity style={styles.exportFab} onPress={handleExport}>
          <Text style={styles.exportFabText}>📤 Exportar Semana</Text>
        </TouchableOpacity>
      )}

      {/* MODAL DE EDIÇÃO */}
      <Modal
        visible={!!editingSessao}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingSessao(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>✏️ Editar Registro</Text>
            
            {editingSessao && (
              <>
                <Text style={styles.modalSubtitle}>
                  {editingSessao.local_nome} • {new Date(editingSessao.entrada).toLocaleDateString('pt-BR')}
                </Text>
                
                <View style={styles.editRow}>
                  <Text style={styles.editLabel}>Entrada:</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editEntrada}
                    onChangeText={setEditEntrada}
                    placeholder="08:00"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
                
                <View style={styles.editRow}>
                  <Text style={styles.editLabel}>Saída:</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editSaida}
                    onChangeText={setEditSaida}
                    placeholder="17:00"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
                
                <Text style={styles.editHint}>Use formato HH:MM (ex: 08:30)</Text>
                
                <View style={styles.modalActions}>
                  <Button title="Cancelar" variant="ghost" onPress={() => setEditingSessao(null)} />
                  <Button title="Salvar" onPress={handleSaveEdit} />
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ============================================
// ESTILOS
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: withOpacity(colors.white, 0.2),
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },

  // Summary
  summary: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },

  // Calendar
  calendar: {
    flex: 1,
    paddingHorizontal: 16,
  },

  // Day Card
  dayCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 12,
    marginBottom: 8,
    padding: 12,
    minHeight: 70,
  },
  dayCardWithSessoes: {
    // Destaque para dias com trabalho
  },
  dayCardToday: {
    borderWidth: 2,
    borderColor: colors.primary,
  },

  // Day Left (data)
  dayLeft: {
    width: 50,
    alignItems: 'center',
    marginRight: 12,
  },
  dayName: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
    marginBottom: 4,
  },
  dayNameToday: {
    color: colors.primary,
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCircleToday: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  dayNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
  },
  dayNumberToday: {
    color: colors.white,
  },

  // Day Right (conteúdo)
  dayRight: {
    flex: 1,
    justifyContent: 'center',
  },
  noShift: {
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },

  // Preview
  dayPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayPreviewTime: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  dayPreviewDuration: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  dayPreviewLocal: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  localDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  dayPreviewLocalText: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },
  moreText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },

  // Expand icon
  expandIcon: {
    fontSize: 10,
    color: colors.textSecondary,
    marginLeft: 8,
    alignSelf: 'center',
  },

  // Expanded content
  expandedContent: {
    marginTop: 8,
  },
  sessaoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  sessaoItemSelected: {
    backgroundColor: withOpacity(colors.primary, 0.15),
    borderWidth: 1,
    borderColor: colors.primary,
  },
  sessaoItemAtiva: {
    backgroundColor: withOpacity(colors.success, 0.1),
    borderWidth: 1,
    borderColor: colors.success,
  },
  sessaoInfo: {
    flex: 1,
    marginLeft: 4,
  },
  sessaoLocal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  sessaoTime: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sessaoDuration: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  editedBadge: {
    fontSize: 10,
    color: colors.warning,
    marginTop: 2,
  },

  // Checkbox
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
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

  // Day total
  dayTotal: {
    alignItems: 'flex-end',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 4,
  },
  dayTotalText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },

  // Action Bar
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
  },
  actionBarTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionBarTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  actionBarButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  actionBarLink: {
    fontSize: 14,
    color: colors.primary,
  },
  actionBarCancel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  actionBarActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  actionButton: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  actionButtonIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  actionButtonText: {
    fontSize: 12,
    color: colors.text,
  },
  actionButtonEdit: {
    // Cor vermelha para editar
  },
  actionButtonTextEdit: {
    color: colors.error,
    fontWeight: '600',
  },

  // Export FAB
  exportFab: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  exportFabText: {
    color: colors.white,
    fontSize: 14,
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  editLabel: {
    width: 70,
    fontSize: 14,
    color: colors.textSecondary,
  },
  editInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    textAlign: 'center',
  },
  editHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
});
