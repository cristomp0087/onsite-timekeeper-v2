/**
 * Home Screen - OnSite Timekeeper
 * 
 * Tela principal com timer e calendário de sessões.
 * 
 * Estrutura refatorada:
 * - index.tsx        → JSX (este arquivo)
 * - index.hooks.ts   → Lógica (states, effects, handlers)
 * - index.helpers.ts → Funções utilitárias
 * - index.styles.ts  → StyleSheet
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Image,
  ViewStyle,
} from 'react-native';

import { Card } from '../../src/components/ui/Button';
import { colors } from '../../src/constants/colors';

import { useHomeScreen } from './index.hooks';
import { styles, MONTH_DAY_SIZE } from './index.styles';
import { DIAS_SEMANA_SHORT } from './index.helpers';

// ============================================
// COMPONENT
// ============================================

export default function HomeScreen() {
  const {
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
    
    // Helpers
    formatDateRange,
    formatMonthYear,
    formatTimeAMPM,
    formatarDuracao,
    isToday,
    getDayKey,
  } = useHomeScreen();

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
          {sessoesFinalizadas.map((sessao) => {
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
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>{sessaoAtual.local_nome}</Text>
            </View>
            
            <Text style={[styles.timer, isPaused && styles.timerPaused]}>{cronometro}</Text>

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
                          <TouchableOpacity style={styles.addBtn} onPress={() => openManualEntry(dia.data)}>
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
                <View style={styles.timeInputRow}>
                  <TextInput
                    style={styles.timeInputSmall}
                    placeholder="08"
                    placeholderTextColor={colors.textSecondary}
                    value={manualEntradaH}
                    onChangeText={(t) => setManualEntradaH(t.replace(/[^0-9]/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                  />
                  <Text style={styles.timeSeparator}>:</Text>
                  <TextInput
                    style={styles.timeInputSmall}
                    placeholder="00"
                    placeholderTextColor={colors.textSecondary}
                    value={manualEntradaM}
                    onChangeText={(t) => setManualEntradaM(t.replace(/[^0-9]/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                  />
                </View>
              </View>
              <View style={styles.timeField}>
                <Text style={styles.inputLabel}>Exit:</Text>
                <View style={styles.timeInputRow}>
                  <TextInput
                    style={styles.timeInputSmall}
                    placeholder="17"
                    placeholderTextColor={colors.textSecondary}
                    value={manualSaidaH}
                    onChangeText={(t) => setManualSaidaH(t.replace(/[^0-9]/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                  />
                  <Text style={styles.timeSeparator}>:</Text>
                  <TextInput
                    style={styles.timeInputSmall}
                    placeholder="00"
                    placeholderTextColor={colors.textSecondary}
                    value={manualSaidaM}
                    onChangeText={(t) => setManualSaidaM(t.replace(/[^0-9]/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                  />
                </View>
              </View>
            </View>

            <View style={styles.pausaRow}>
              <Text style={styles.inputLabel}>Break:</Text>
              <TextInput
                style={styles.pausaInput}
                placeholder="60"
                placeholderTextColor={colors.textSecondary}
                value={manualPausa}
                onChangeText={(t) => setManualPausa(t.replace(/[^0-9]/g, '').slice(0, 3))}
                keyboardType="number-pad"
                maxLength={3}
                selectTextOnFocus
              />
              <Text style={styles.pausaHint}>min</Text>
            </View>

            <Text style={styles.inputHint}>24h format • Break in minutes</Text>

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

      {/* SESSION FINISHED MODAL */}
      <Modal
        visible={showSessionFinishedModal && !!ultimaSessaoFinalizada}
        transparent
        animationType="fade"
        onRequestClose={handleDismissSessionModal}
      >
        <View style={styles.sessionModalOverlay}>
          <View style={styles.sessionModalContent}>
            <Text style={styles.sessionModalEmoji}>✅</Text>
            <Text style={styles.sessionModalTitle}>Session Finished</Text>
            
            {ultimaSessaoFinalizada && (
              <>
                <Text style={styles.sessionModalLocation}>
                  📍 {ultimaSessaoFinalizada.local_nome}
                </Text>
                <Text style={styles.sessionModalDuration}>
                  {formatarDuracao(ultimaSessaoFinalizada.duracao_minutos)}
                </Text>
              </>
            )}

            <View style={styles.sessionModalActions}>
              <TouchableOpacity 
                style={styles.sessionModalBtnSecondary} 
                onPress={handleDismissSessionModal}
              >
                <Text style={styles.sessionModalBtnSecondaryText}>OK</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.sessionModalBtnPrimary} 
                onPress={handleShareSession}
              >
                <Text style={styles.sessionModalBtnPrimaryText}>📤 Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
