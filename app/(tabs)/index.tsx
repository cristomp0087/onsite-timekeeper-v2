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
 * UPDATED: 
 * - Removed Session Finished Modal (was causing confusion)
 * - Added Day Detail Modal with session selection
 * - Consistent behavior between week/month views
 * - Added Permission Banner for foreground service warnings
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  ViewStyle,
  Image,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Card } from '../../src/components/ui/Button';
import { colors } from '../../src/constants/colors';
import type { ComputedSession } from '../../src/lib/database';
import type { WorkLocation } from '../../src/stores/locationStore';

import { useHomeScreen } from '../../src/screens/home/hooks';
import { styles } from '../../src/screens/home/styles';
import { WEEKDAYS_SHORT, type CalendarDay } from '../../src/screens/home/helpers';
import { HomePermissionBanner } from '../../src/components/PermissionBanner';

// ============================================
// COMPONENT
// ============================================

export default function HomeScreen() {
  // Refs for auto-jump between time fields
  const entryMRef = useRef<TextInput>(null);
  const exitHRef = useRef<TextInput>(null);
  const exitMRef = useRef<TextInput>(null);
  const pauseRef = useRef<TextInput>(null);
  
  // Navigation
  const router = useRouter();
  
  // Logo tooltip state
  const [showLogoTooltip, setShowLogoTooltip] = useState(false);

  const {
    // Data
    userName,
    locations,
    currentSession,
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
    
    // Day selection (batch)
    selectionMode,
    selectedDays,
    cancelSelection,
    
    // Day Modal (NEW)
    showDayModal,
    selectedDayForModal,
    dayModalSessions,
    closeDayModal,
    
    // Location Cards (NEW)
    activeLocations,
    locationCardsData,
    
    // Session selection (NEW)
    selectedSessions,
    toggleSelectSession,
    selectAllSessions,
    deselectAllSessions,
    
    // Manual entry modal
    showManualModal,
    setShowManualModal,
    manualDate,
    manualLocationId,
    setManualLocationId,
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
    manualEntryMode,
    setManualEntryMode,
    manualAbsenceType,
    setManualAbsenceType,
    
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
    handleDeleteSession,
    handleDeleteSelectedSessions,
    handleDeleteFromModal,
    handleExport,
    handleDeleteSelectedDays,
    handleExportFromModal,
    
    // Helpers
    formatDateRange,
    formatMonthYear,
    formatTimeAMPM,
    formatDuration,
    isToday,
    getDayKey,
  } = useHomeScreen();

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
        <TouchableOpacity 
          style={styles.headerLogoContainer}
          onPress={() => setShowLogoTooltip(true)}
          activeOpacity={0.7}
        >
          <Image 
            source={require('../../assets/logo-onsite.png')} 
            style={styles.headerLogo}
            resizeMode="contain"
          />
        </TouchableOpacity>
        
        <View style={styles.headerUserContainer}>
          <Text style={styles.headerUserName} numberOfLines={1}>
            {userName || 'User'}
          </Text>
          <View style={styles.headerUserAvatar}>
            <Ionicons name="person" size={16} color={colors.textSecondary} />
          </View>
        </View>
      </View>

      {/* PERMISSION BANNER - Shows when foreground service killed or permissions missing */}
      <HomePermissionBanner />

      {/* LOGO TOOLTIP MODAL */}
      <Modal
        visible={showLogoTooltip}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoTooltip(false)}
      >
        <TouchableOpacity
          style={styles.tooltipOverlay}
          activeOpacity={1}
          onPress={() => setShowLogoTooltip(false)}
        >
          <View style={styles.tooltipContainer}>
            <View style={styles.tooltipArrow} />
            <View style={styles.tooltipContent}>
              <Ionicons name="globe-outline" size={20} color={colors.primary} />
              <Text style={styles.tooltipText}>Visit our website</Text>
              <TouchableOpacity
                style={styles.tooltipButton}
                onPress={() => {
                  setShowLogoTooltip(false);
                  Linking.openURL('https://onsiteclub.com');
                }}
              >
                <Text style={styles.tooltipButtonText}>Open</Text>
                <Ionicons name="open-outline" size={14} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* TIMER */}
      <Card style={[
        styles.timerCard,
        currentSession && styles.timerCardActive,
        canRestart && styles.timerCardIdle
      ].filter(Boolean) as ViewStyle[]}>
        {currentSession ? (
          <>
            {/* Location Badge (green when active) */}
            <View style={styles.activeBadge}>
              <View style={styles.activeBadgeDot} />
              <Text style={styles.activeBadgeText}>{currentSession.location_name}</Text>
            </View>
            
            <Text style={styles.timerLabel}>Current Session</Text>
            <Text style={[styles.timer, isPaused && styles.timerPaused]}>{timer}</Text>

            <View style={styles.pausaContainer}>
              <Ionicons name="cafe-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.pausaLabel}>Break:</Text>
              <Text style={[styles.pausaTimer, isPaused && styles.pausaTimerActive]}>
                {pauseTimer}
              </Text>
            </View>

            <View style={styles.timerActions}>
              {isPaused ? (
                <TouchableOpacity style={[styles.actionBtn, styles.continueBtn]} onPress={handleResume}>
                  <Ionicons name="play" size={16} color={colors.buttonPrimaryText} />
                  <Text style={[styles.actionBtnText, styles.continueBtnText]}>Resume</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.actionBtn, styles.pauseBtn]} onPress={handlePause}>
                  <Ionicons name="pause" size={16} color={colors.text} />
                  <Text style={[styles.actionBtnText, styles.pauseBtnText]}>Pause</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.actionBtn, styles.stopBtn]} onPress={handleStop}>
                <Ionicons name="stop" size={16} color={colors.white} />
                <Text style={[styles.actionBtnText, styles.stopBtnText]}>End</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : canRestart ? (
          <>
            {/* Location Badge (gray when idle) */}
            <View style={styles.idleBadge}>
              <View style={styles.idleBadgeDot} />
              <Text style={styles.idleBadgeText}>{activeLocation?.name}</Text>
            </View>
            
            <Text style={styles.timer}>00:00:00</Text>
            <TouchableOpacity style={[styles.actionBtn, styles.startBtn]} onPress={handleRestart}>
              <Ionicons name="play" size={16} color={colors.buttonPrimaryText} />
              <Text style={[styles.actionBtnText, styles.startBtnText]}>Start</Text>
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

      {/* ============================================ */}
      {/* LOCATION CARDS */}
      {/* ============================================ */}
      {activeLocations.length > 0 && (
        <View style={styles.locationCardsSection}>
          {activeLocations.length === 1 ? (
            // Single location - full width
            <TouchableOpacity 
              style={styles.locationCardFull}
              onPress={() => router.push('/(tabs)/map')}
              activeOpacity={0.7}
            >
              {locationCardsData.map(loc => (
                <View key={loc.id}>
                  <View style={styles.locationCardHeader}>
                    <View style={styles.locationCardIconContainer}>
                      <View style={styles.locationCardIconGlow} />
                      <Ionicons name="location" size={24} color={loc.color || colors.primary} />
                    </View>
                    <View style={styles.locationCardHeaderInfo}>
                      <Text style={styles.locationCardName}>{loc.name}</Text>
                      <Text style={styles.locationCardCoords}>{loc.coords}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                  </View>
                  
                  {loc.hasActiveSession ? (
                    <View style={styles.locationCardTimeRow}>
                      <Ionicons name="time-outline" size={14} color={colors.success} />
                      <Text style={styles.locationCardTimeLabel}>In:</Text>
                      <Text style={[styles.locationCardTimeValue, styles.locationCardTimeActive]}>
                        {loc.activeSessionEntry}
                      </Text>
                      <Ionicons name="arrow-forward" size={14} color={colors.success} />
                    </View>
                  ) : (
                    <View style={styles.locationCardStatsRow}>
                      <Text style={styles.locationCardTotal}>{loc.totalFormatted}</Text>
                      <Text style={styles.locationCardSubtext}>
                        {selectedDays.size > 0 
                          ? `${loc.sessionsCount} session(s)`
                          : `Last: ${loc.lastCheckIn}`
                        }
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </TouchableOpacity>
          ) : activeLocations.length === 2 ? (
            // Two locations - side by side
            <View style={styles.locationCardsRow}>
              {locationCardsData.map(loc => (
                <TouchableOpacity 
                  key={loc.id} 
                  style={styles.locationCardHalf}
                  onPress={() => router.push('/(tabs)/map')}
                  activeOpacity={0.7}
                >
                  <View style={styles.locationCardHeaderCompact}>
                    <View style={styles.locationCardIconContainer}>
                      <View style={styles.locationCardIconGlow} />
                      <Ionicons name="location" size={22} color={loc.color || colors.primary} />
                    </View>
                    <Text style={styles.locationCardNameCompact} numberOfLines={1}>{loc.name}</Text>
                  </View>
                  
                  {loc.hasActiveSession ? (
                    <View style={styles.locationCardTimeRow}>
                      <Text style={[styles.locationCardTimeValue, styles.locationCardTimeActive]}>
                        {loc.activeSessionEntry}
                      </Text>
                      <Ionicons name="arrow-forward" size={12} color={colors.success} />
                    </View>
                  ) : (
                    <>
                      <Text style={styles.locationCardTotalCompact}>{loc.totalFormatted}</Text>
                      <Text style={styles.locationCardSubtext} numberOfLines={1}>
                        {selectedDays.size > 0 ? `${loc.sessionsCount} sessions` : loc.lastCheckIn}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            // 3+ locations - horizontal scroll
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.locationCardsScroll}
              contentContainerStyle={{ gap: 12 }}
            >
              {locationCardsData.map(loc => (
                <TouchableOpacity 
                  key={loc.id} 
                  style={styles.locationCardScrollable}
                  onPress={() => router.push('/(tabs)/map')}
                  activeOpacity={0.7}
                >
                  <View style={styles.locationCardHeaderCompact}>
                    <View style={styles.locationCardIconContainer}>
                      <View style={styles.locationCardIconGlow} />
                      <Ionicons name="location" size={22} color={loc.color || colors.primary} />
                    </View>
                    <Text style={styles.locationCardNameCompact} numberOfLines={1}>{loc.name}</Text>
                  </View>
                  
                  {loc.hasActiveSession ? (
                    <View style={styles.locationCardTimeRow}>
                      <Text style={[styles.locationCardTimeValue, styles.locationCardTimeActive]}>
                        {loc.activeSessionEntry}
                      </Text>
                      <Ionicons name="arrow-forward" size={12} color={colors.success} />
                    </View>
                  ) : (
                    <>
                      <Text style={styles.locationCardTotalCompact}>{loc.totalFormatted}</Text>
                      <Text style={styles.locationCardSubtext} numberOfLines={1}>
                        {selectedDays.size > 0 ? `${loc.sessionsCount} sessions` : loc.lastCheckIn}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      <View style={styles.sectionDivider} />

      {/* CALENDAR HEADER */}
      <Card style={styles.calendarCard}>
        <View style={styles.calendarHeader}>
          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={viewMode === 'week' ? goToPreviousWeek : goToPreviousMonth}
          >
            <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
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
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
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

      {/* WEEK VIEW */}
      {viewMode === 'week' && (
        <>
          {weekCalendarDays.map((day: CalendarDay) => {
            const dayKey = getDayKey(day.date);
            const hasSessions = day.sessions.length > 0;
            const isTodayDate = isToday(day.date);
            const hasActive = day.sessions.some((s: ComputedSession) => !s.exit_at);
            const isSelected = selectedDays.has(dayKey);

            return (
              <TouchableOpacity
                key={dayKey}
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
                    {isSelected && <Ionicons name="checkmark" size={16} color={colors.white} />}
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
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                )}
              </TouchableOpacity>
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
        </View>
      )}

      {/* BATCH ACTION BAR (when in selection mode) */}
      {selectionMode && (
        <View style={styles.batchActionBar}>
          <Text style={styles.batchActionText}>{selectedDays.size} day(s)</Text>
          <View style={styles.batchActionButtons}>
            <TouchableOpacity 
              style={styles.batchActionBtn}
              onPress={handleDeleteSelectedDays}
            >
              <Ionicons name="trash-outline" size={20} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.batchActionBtn}
              onPress={handleExport}
            >
              <Ionicons name="share-outline" size={20} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.batchActionBtnCancel}
              onPress={cancelSelection}
            >
              <Ionicons name="close" size={20} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ============================================ */}
      {/* DAY DETAIL MODAL (FULLSCREEN WITH MARGIN) */}
      {/* ============================================ */}
      <Modal
        visible={showDayModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeDayModal}
      >
        <View style={styles.dayModalOverlay}>
          <View style={styles.dayModalContainer}>
            {/* Header with Actions */}
            <View style={styles.dayModalHeader}>
              <Text style={styles.dayModalTitle}>
                {selectedDayForModal?.toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  day: '2-digit', 
                  month: 'short',
                  year: 'numeric'
                })}
              </Text>
              <View style={styles.dayModalHeaderActions}>
                {/* Delete Button */}
                <TouchableOpacity 
                  style={styles.dayModalHeaderBtn} 
                  onPress={handleDeleteFromModal}
                  disabled={dayModalSessions.filter(s => s.exit_at).length === 0}
                >
                  <Ionicons 
                    name="trash-outline" 
                    size={20} 
                    color={dayModalSessions.filter(s => s.exit_at).length === 0 ? colors.textMuted : colors.textSecondary} 
                  />
                </TouchableOpacity>
                {/* Export Button */}
                <TouchableOpacity 
                  style={styles.dayModalHeaderBtn} 
                  onPress={handleExportFromModal}
                  disabled={dayModalSessions.filter(s => s.exit_at).length === 0}
                >
                  <Ionicons 
                    name="share-outline" 
                    size={20} 
                    color={dayModalSessions.filter(s => s.exit_at).length === 0 ? colors.textMuted : colors.textSecondary} 
                  />
                </TouchableOpacity>
                {/* Add Button */}
                <TouchableOpacity 
                  style={styles.dayModalHeaderBtn} 
                  onPress={() => selectedDayForModal && openManualEntry(selectedDayForModal)}
                >
                  <Ionicons name="add" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
                {/* Close Button */}
                <TouchableOpacity 
                  style={[styles.dayModalHeaderBtn, styles.dayModalCloseHeaderBtn]} 
                  onPress={closeDayModal}
                >
                  <Ionicons name="close" size={22} color={colors.white} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Selection controls */}
            {dayModalSessions.filter(s => s.exit_at).length >= 1 && (
              <View style={styles.dayModalSelectionBar}>
                <Text style={styles.dayModalSelectionText}>
                  {selectedSessions.size > 0 
                    ? `${selectedSessions.size} selected` 
                    : 'Tap to select sessions'}
                </Text>
                <View style={styles.dayModalSelectionActions}>
                  {selectedSessions.size > 0 ? (
                    <TouchableOpacity onPress={deselectAllSessions}>
                      <Text style={styles.dayModalSelectionBtn}>Clear</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={selectAllSessions}>
                      <Text style={styles.dayModalSelectionBtn}>Select All</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* Sessions List - scrollable area */}
            <ScrollView 
              style={styles.dayModalSessionsList}
              contentContainerStyle={styles.dayModalSessionsContent}
              showsVerticalScrollIndicator={true}
            >
              {dayModalSessions.filter(s => s.exit_at).length === 0 ? (
                <View style={styles.dayModalEmpty}>
                  <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.dayModalEmptyText}>No completed sessions</Text>
                  <TouchableOpacity 
                    style={styles.dayModalAddBtn}
                    onPress={() => selectedDayForModal && openManualEntry(selectedDayForModal)}
                  >
                    <Text style={styles.dayModalAddBtnText}>Add Manual Entry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                dayModalSessions
                  .filter(s => s.exit_at)
                  .map((session: ComputedSession) => {
                    const isSessionSelected = selectedSessions.has(session.id);
                    const isManual = session.type === 'manual';
                    const isEdited = session.manually_edited === 1 && !isManual;
                    const pauseMin = session.pause_minutes || 0;
                    const netTotal = Math.max(0, session.duration_minutes - pauseMin);

                    return (
                      <TouchableOpacity
                        key={session.id}
                        style={[
                          styles.dayModalSession,
                          isSessionSelected && styles.dayModalSessionSelected
                        ]}
                        onPress={() => toggleSelectSession(session.id)}
                        onLongPress={() => handleDeleteSession(session)}
                        delayLongPress={600}
                      >
                        <View style={[
                          styles.dayModalCheckbox,
                          isSessionSelected && styles.dayModalCheckboxSelected
                        ]}>
                          {isSessionSelected && <Ionicons name="checkmark" size={16} color={colors.white} />}
                        </View>
                        
                        <View style={styles.dayModalSessionInfo}>
                          <View style={styles.dayModalSessionHeader}>
                            <Text style={styles.dayModalSessionLocation}>{session.location_name}</Text>
                            <View style={[styles.dayModalSessionDot, { backgroundColor: session.color || colors.primary }]} />
                          </View>
                          
                          <Text style={[
                            styles.dayModalSessionTime,
                            (isManual || isEdited) && styles.dayModalSessionTimeEdited
                          ]}>
                            {isManual || isEdited ? 'Edited · ' : 'GPS · '}
                            {formatTimeAMPM(session.entry_at)} → {formatTimeAMPM(session.exit_at!)}
                          </Text>
                          
                          {pauseMin > 0 && (
                            <Text style={styles.dayModalSessionPause}>Break: {pauseMin}min</Text>
                          )}
                          
                          <Text style={styles.dayModalSessionTotal}>{formatDuration(netTotal)}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
              )}
            </ScrollView>

            {/* Day Total - fixed at bottom */}
            {dayModalSessions.filter(s => s.exit_at).length > 0 && (
              <View style={styles.dayModalTotalBar}>
                <Text style={styles.dayModalTotalLabel}>Day Total</Text>
                <Text style={styles.dayModalTotalValue}>
                  {formatDuration(
                    dayModalSessions
                      .filter(s => s.exit_at)
                      .reduce((acc, s) => {
                        const pauseMin = s.pause_minutes || 0;
                        return acc + Math.max(0, s.duration_minutes - pauseMin);
                      }, 0)
                  )}
                </Text>
              </View>
            )}

            {/* Footer - Close button */}
            <TouchableOpacity style={styles.dayModalCloseBtn} onPress={closeDayModal}>
              <Text style={styles.dayModalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ============================================ */}
      {/* MANUAL ENTRY MODAL */}
      {/* ============================================ */}
      <Modal
        visible={showManualModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowManualModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              <Ionicons name="create-outline" size={20} color={colors.text} /> Manual Entry
            </Text>
            <Text style={styles.modalSubtitle}>
              {manualDate.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'short' })}
            </Text>

            {/* Mode Toggle */}
            <View style={styles.entryModeToggle}>
              <TouchableOpacity
                style={[styles.entryModeBtn, manualEntryMode === 'hours' && styles.entryModeBtnActive]}
                onPress={() => setManualEntryMode('hours')}
              >
                <Ionicons name="time-outline" size={18} color={manualEntryMode === 'hours' ? colors.buttonPrimaryText : colors.textSecondary} />
                <Text style={[styles.entryModeBtnText, manualEntryMode === 'hours' && styles.entryModeBtnTextActive]}>Work Hours</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.entryModeBtn, manualEntryMode === 'absence' && styles.entryModeBtnActive]}
                onPress={() => setManualEntryMode('absence')}
              >
                <Ionicons name="calendar-outline" size={18} color={manualEntryMode === 'absence' ? colors.buttonPrimaryText : colors.textSecondary} />
                <Text style={[styles.entryModeBtnText, manualEntryMode === 'absence' && styles.entryModeBtnTextActive]}>Absence</Text>
              </TouchableOpacity>
            </View>

            {manualEntryMode === 'hours' ? (
              <>
                {/* HOURS MODE - Original form */}
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
              </>
            ) : (
              <>
                {/* ABSENCE MODE - Reason selection */}
                <Text style={styles.inputLabel}>Reason:</Text>
                <View style={styles.absenceOptions}>
                  {[
                    { type: 'rain', label: 'Rain Day', icon: 'rainy', color: '#3B82F6' },
                    { type: 'snow', label: 'Snow Day', icon: 'snow', color: '#60A5FA' },
                    { type: 'sick', label: 'Sick Day', icon: 'medkit', color: '#EF4444' },
                    { type: 'day_off', label: 'Day Off', icon: 'sunny', color: '#F59E0B' },
                    { type: 'holiday', label: 'Holiday', icon: 'star', color: '#8B5CF6' },
                  ].map(option => (
                    <TouchableOpacity
                      key={option.type}
                      style={[
                        styles.absenceOption,
                        manualAbsenceType === option.type && styles.absenceOptionActive
                      ]}
                      onPress={() => setManualAbsenceType(option.type)}
                    >
                      <View style={[styles.absenceOptionIcon, { backgroundColor: option.color }]}>
                        <Ionicons name={option.icon as any} size={18} color={colors.white} />
                      </View>
                      <Text style={[
                        styles.absenceOptionText,
                        manualAbsenceType === option.type && styles.absenceOptionTextActive
                      ]}>
                        {option.label}
                      </Text>
                      {manualAbsenceType === option.type && (
                        <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputHint}>Common in construction when work is not possible</Text>
              </>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowManualModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveManual}>
                <Text style={styles.saveBtnText}>
                  {manualEntryMode === 'hours' ? 'Add' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* REMOVED: Session Finished Modal - was causing confusion about where reports are */}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
