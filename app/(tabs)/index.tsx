/**
 * Home Screen - OnSite Timekeeper
 * 
 * Main screen with timer and session calendar.
 * 
 * Refactored structure:
 * - index.tsx         → JSX (this file)
 * - hooks.ts          → Logic (states, effects, handlers)
 * - helpers.ts        → Utility functions
 * - styles.ts         → StyleSheet
 * 
 * REFACTORED: All PT names removed, using EN stores/hooks
 */

import React, { useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  ViewStyle,
} from 'react-native';

import { Card } from '../../src/components/ui/Button';
import { colors } from '../../src/constants/colors';
import type { ComputedSession } from '../../src/lib/database';
import type { WorkLocation } from '../../src/stores/locationStore';

import { useHomeScreen } from '../../src/screens/home/hooks';
import { styles } from '../../src/screens/home/styles';
import { WEEKDAYS_SHORT, type CalendarDay } from '../../src/screens/home/helpers';

// ============================================
// COMPONENT
// ============================================

export default function HomeScreen() {
  // Refs for auto-jump between time fields
  const entryMRef = useRef<TextInput>(null);
  const exitHRef = useRef<TextInput>(null);
  const exitMRef = useRef<TextInput>(null);
  const pauseRef = useRef<TextInput>(null);

  const {
    // Data
    userName,
    locations,
    currentSession,
    lastFinishedSession,
    activeLocation,
    canRestart,
    isGeofencingActive,
    
    // Timer
    timer,
    isPaused,
    pauseTimer,
    
    // Calendar
    viewMode,
    setViewMode,
    currentMonth,
    weekStart,
    weekEnd,
    weekCalendarDays,
    monthCalendarDays,
    weekTotalMinutes,
    monthTotalMinutes,
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
    manualLocationId,
    setManualLocationId,
    // Separate HH:MM fields
    manualEntryH,
    setManualEntryH,
    manualEntryM,
    setManualEntryM,
    manualExitH,
    setManualExitH,
    manualExitM,
    setManualExitM,
    manualPause,
    setManualPause,
    
    // Refresh
    refreshing,
    onRefresh,
    
    // Timer handlers
    handlePause,
    handleResume,
    handleStop,
    handleRestart,
    
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
    getSessionsForDay,
    getTotalMinutesForDay,
    
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
    formatDuration,
    isToday,
    getDayKey,
  } = useHomeScreen();

  // ============================================
  // RENDER DAY REPORT (expanded)
  // ============================================

  const renderDayReport = (date: Date) => {
    const daySessions = getSessionsForDay(date);
    const finishedSessions = daySessions.filter((s: ComputedSession) => s.exit_at);
    const dayKey = getDayKey(date);
    const totalMinutes = getTotalMinutesForDay(date);

    if (finishedSessions.length === 0) return null;

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
                onPress={() => handleDeleteDay(dayKey, daySessions)}
              >
                <Text style={styles.actionBtnInlineText}>🗑️</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Sessions */}
          {finishedSessions.map((session: ComputedSession) => {
            const isManual = session.type === 'manual';
            const isEdited = session.manually_edited === 1 && !isManual;
            const pauseMin = session.pause_minutes || 0;
            const netTotal = Math.max(0, session.duration_minutes - pauseMin);
            
            return (
              <View key={session.id} style={styles.reportSession}>
                <Text style={styles.reportLocal}>📍 {session.location_name}</Text>
                
                {isManual || isEdited ? (
                  <Text style={styles.reportTimeEdited}>
                    *Edited 》{formatTimeAMPM(session.entry_at)} → {formatTimeAMPM(session.exit_at!)}
                  </Text>
                ) : (
                  <Text style={styles.reportTimeGps}>
                    *GPS    》{formatTimeAMPM(session.entry_at)} → {formatTimeAMPM(session.exit_at!)}
                  </Text>
                )}
                
                {pauseMin > 0 && (
                  <Text style={styles.reportPausa}>Break: {pauseMin}min</Text>
                )}
                
                <Text style={styles.reportSessionTotal}>▸ {formatDuration(netTotal)}</Text>
              </View>
            );
          })}

          {/* Day total (only if multiple sessions) */}
          {finishedSessions.length > 1 && (
            <View style={styles.reportDayTotal}>
              <Text style={styles.reportDayTotalText}>Day Total: {formatDuration(totalMinutes)}</Text>
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
        <View style={styles.headerLogoContainer}>
          <Text style={styles.headerLogoEmoji}>📍</Text>
          <Text style={styles.headerLogoText}>OnSite</Text>
        </View>
        <Text style={styles.greeting}>Hello, {userName || 'Worker'}</Text>
      </View>

      {/* TIMER */}
      <Card style={[
        styles.timerCard,
        currentSession && styles.timerCardActive,
        canRestart && styles.timerCardIdle
      ].filter(Boolean) as ViewStyle[]}>
        {currentSession ? (
          <>
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>{currentSession.location_name}</Text>
            </View>
            
            <Text style={[styles.timer, isPaused && styles.timerPaused]}>{timer}</Text>

            <View style={styles.pausaContainer}>
              <Text style={styles.pausaLabel}>⏸️ Break:</Text>
              <Text style={[styles.pausaTimer, isPaused && styles.pausaTimerActive]}>
                {pauseTimer}
              </Text>
            </View>

            <View style={styles.timerActions}>
              {isPaused ? (
                <TouchableOpacity style={[styles.actionBtn, styles.continueBtn]} onPress={handleResume}>
                  <Text style={[styles.actionBtnText, styles.continueBtnText]}>▶ Resume</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.actionBtn, styles.pauseBtn]} onPress={handlePause}>
                  <Text style={[styles.actionBtnText, styles.pauseBtnText]}>⏸ Pause</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.actionBtn, styles.stopBtn]} onPress={handleStop}>
                <Text style={[styles.actionBtnText, styles.stopBtnText]}>⏹ End</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : canRestart ? (
          <>
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>{activeLocation?.name}</Text>
            </View>
            <Text style={styles.timer}>00:00:00</Text>
            <TouchableOpacity style={[styles.actionBtn, styles.startBtn]} onPress={handleRestart}>
              <Text style={[styles.actionBtnText, styles.startBtnText]}>▶ Start</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.timerHint}>
              {isGeofencingActive ? 'Waiting for location entry...' : 'Monitoring inactive'}
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
                ? formatDateRange(weekStart, weekEnd)
                : formatMonthYear(currentMonth)
              }
            </Text>
            <Text style={styles.calendarTotal}>
              {formatDuration(viewMode === 'week' ? weekTotalMinutes : monthTotalMinutes)}
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
          {weekCalendarDays.map((day: CalendarDay) => {
            const dayKey = getDayKey(day.date);
            const isExpanded = expandedDay === dayKey && !selectionMode;
            const hasSessions = day.sessions.length > 0;
            const isTodayDate = isToday(day.date);
            const hasActive = day.sessions.some((s: ComputedSession) => !s.exit_at);
            const isSelected = selectedDays.has(dayKey);

            return (
              <View key={dayKey}>
                <TouchableOpacity
                  style={[
                    styles.dayRow,
                    isTodayDate && styles.dayRowToday,
                    isSelected && styles.dayRowSelected,
                  ]}
                  onPress={() => handleDayPress(dayKey, hasSessions)}
                  onLongPress={() => handleDayLongPress(dayKey, hasSessions)}
                  delayLongPress={400}
                  activeOpacity={0.7}
                >
                  {selectionMode && hasSessions && (
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  )}

                  <View style={styles.dayLeft}>
                    <Text style={[styles.dayName, isTodayDate && styles.dayNameToday]}>{day.weekday}</Text>
                    <View style={[styles.dayCircle, isTodayDate && styles.dayCircleToday]}>
                      <Text style={[styles.dayNumber, isTodayDate && styles.dayNumberToday]}>{day.dayNumber}</Text>
                    </View>
                  </View>

                  <View style={styles.dayRight}>
                    {!hasSessions ? (
                      <View style={styles.dayEmpty}>
                        <Text style={styles.dayEmptyText}>No record</Text>
                        {!selectionMode && (
                          <TouchableOpacity style={styles.addBtn} onPress={() => openManualEntry(day.date)}>
                            <Text style={styles.addBtnText}>+</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : (
                      <View style={styles.dayPreview}>
                        <Text style={[styles.dayPreviewDuration, hasActive && { color: colors.success }]}>
                          {hasActive ? 'In progress' : formatDuration(day.totalMinutes)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {hasSessions && !selectionMode && (
                    <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
                  )}
                </TouchableOpacity>

                {/* Expanded day report */}
                {isExpanded && renderDayReport(day.date)}
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
            {WEEKDAYS_SHORT.map((d: string, i: number) => (
              <Text key={i} style={styles.monthWeekHeaderText}>{d}</Text>
            ))}
          </View>

          {/* Days grid */}
          <View style={styles.monthGrid}>
            {monthCalendarDays.map((date: Date | null, index: number) => {
              if (!date) {
                return <View key={`empty-${index}`} style={styles.monthDayEmpty} />;
              }

              const dayKey = getDayKey(date);
              const daySessions = getSessionsForDay(date);
              const hasSessions = daySessions.length > 0;
              const isTodayDate = isToday(date);
              const isSelected = selectedDays.has(dayKey);
              const totalMinutes = getTotalMinutesForDay(date);

              return (
                <TouchableOpacity
                  key={dayKey}
                  style={[
                    styles.monthDay,
                    isTodayDate && styles.monthDayToday,
                    isSelected && styles.monthDaySelected,
                    hasSessions && styles.monthDayHasData,
                  ]}
                  onPress={() => handleDayPress(dayKey, hasSessions)}
                  onLongPress={() => handleDayLongPress(dayKey, hasSessions)}
                  delayLongPress={400}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.monthDayNumber,
                    isTodayDate && styles.monthDayNumberToday,
                    isSelected && styles.monthDayNumberSelected,
                  ]}>
                    {date.getDate()}
                  </Text>
                  {hasSessions && totalMinutes > 0 && (
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
              {locations.map((location: WorkLocation) => (
                <TouchableOpacity
                  key={location.id}
                  style={[styles.localOption, manualLocationId === location.id && styles.localOptionActive]}
                  onPress={() => setManualLocationId(location.id)}
                >
                  <View style={[styles.localDot, { backgroundColor: location.color }]} />
                  <Text style={[styles.localOptionText, manualLocationId === location.id && styles.localOptionTextActive]}>
                    {location.name}
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
                    value={manualEntryH}
                    onChangeText={(t) => {
                      const clean = t.replace(/[^0-9]/g, '').slice(0, 2);
                      setManualEntryH(clean);
                      if (clean.length === 2) entryMRef.current?.focus();
                    }}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                  />
                  <Text style={styles.timeSeparator}>:</Text>
                  <TextInput
                    ref={entryMRef}
                    style={styles.timeInputSmall}
                    placeholder="00"
                    placeholderTextColor={colors.textSecondary}
                    value={manualEntryM}
                    onChangeText={(t) => {
                      const clean = t.replace(/[^0-9]/g, '').slice(0, 2);
                      setManualEntryM(clean);
                      if (clean.length === 2) exitHRef.current?.focus();
                    }}
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
                    ref={exitHRef}
                    style={styles.timeInputSmall}
                    placeholder="17"
                    placeholderTextColor={colors.textSecondary}
                    value={manualExitH}
                    onChangeText={(t) => {
                      const clean = t.replace(/[^0-9]/g, '').slice(0, 2);
                      setManualExitH(clean);
                      if (clean.length === 2) exitMRef.current?.focus();
                    }}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectTextOnFocus
                  />
                  <Text style={styles.timeSeparator}>:</Text>
                  <TextInput
                    ref={exitMRef}
                    style={styles.timeInputSmall}
                    placeholder="00"
                    placeholderTextColor={colors.textSecondary}
                    value={manualExitM}
                    onChangeText={(t) => {
                      const clean = t.replace(/[^0-9]/g, '').slice(0, 2);
                      setManualExitM(clean);
                      if (clean.length === 2) pauseRef.current?.focus();
                    }}
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
                ref={pauseRef}
                style={styles.pausaInput}
                placeholder="60"
                placeholderTextColor={colors.textSecondary}
                value={manualPause}
                onChangeText={(t) => setManualPause(t.replace(/[^0-9]/g, '').slice(0, 3))}
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
        visible={showSessionFinishedModal && !!lastFinishedSession}
        transparent
        animationType="fade"
        onRequestClose={handleDismissSessionModal}
      >
        <View style={styles.sessionModalOverlay}>
          <View style={styles.sessionModalContent}>
            <Text style={styles.sessionModalEmoji}>✅</Text>
            <Text style={styles.sessionModalTitle}>Session Finished</Text>
            
            {lastFinishedSession && (
              <>
                <Text style={styles.sessionModalLocation}>
                  📍 {lastFinishedSession.location_name}
                </Text>
                <Text style={styles.sessionModalDuration}>
                  {formatDuration(lastFinishedSession.duration_minutes)}
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
