/**
 * Home Screen Hook - OnSite Timekeeper
 * 
 * Custom hook that encapsulates all HomeScreen logic:
 * - States
 * - Effects
 * - Handlers
 * - Computed values
 * 
 * REFACTORED: All PT names removed, updated to use EN stores/methods
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Alert, Share } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { useAuthStore } from '../../stores/authStore';
import { 
  useLocationStore, 
  selectLocations, 
  selectActiveGeofence, 
  selectIsGeofencingActive 
} from '../../stores/locationStore';
import { useRecordStore } from '../../stores/recordStore';
import { useSyncStore } from '../../stores/syncStore';
import { formatDuration } from '../../lib/database';
import type { ComputedSession } from '../../lib/database';
import { generateCompleteReport } from '../../lib/reports';

import {
  WEEKDAYS,
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  getMonthEnd,
  getMonthCalendarDays,
  formatDateRange,
  formatMonthYear,
  formatTimeAMPM,
  isSameDay,
  isToday,
  getDayKey,
  type CalendarDay,
} from './helpers';

// ============================================
// HOOK
// ============================================

export function useHomeScreen() {
  // ============================================
  // STORES
  // ============================================
  
  const userName = useAuthStore(s => s.getUserName());
  
  // Using selectors for locationStore (proper Zustand pattern)
  const locations = useLocationStore(selectLocations);
  const activeGeofence = useLocationStore(selectActiveGeofence);
  const isGeofencingActive = useLocationStore(selectIsGeofencingActive);
  
  const { 
    currentSession, 
    reloadData, 
    registerExit, 
    registerEntry,
    shareLastSession, 
    lastFinishedSession, 
    clearLastSession,
    getSessionsByPeriod,
    createManualRecord,
    editRecord,
    deleteRecord,
  } = useRecordStore();
  const { syncNow } = useSyncStore();

  // ============================================
  // STATES
  // ============================================
  
  const [refreshing, setRefreshing] = useState(false);
  const [timer, setTimer] = useState('00:00:00');
  const [isPaused, setIsPaused] = useState(false);

  // Pause timer
  const [accumulatedPauseSeconds, setAccumulatedPauseSeconds] = useState(0);
  const [pauseTimer, setPauseTimer] = useState('00:00:00');
  const [pauseStartTimestamp, setPauseStartTimestamp] = useState<number | null>(null);
  const [frozenTime, setFrozenTime] = useState<string | null>(null);

  // Calendar view mode
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  
  // Week view
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [weekSessions, setWeekSessions] = useState<ComputedSession[]>([]);
  
  // Month view
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [monthSessions, setMonthSessions] = useState<ComputedSession[]>([]);
  
  // Expanded day (shows report)
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  
  // Multi-select (by day)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());

  // Manual entry modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualDate, setManualDate] = useState<Date>(new Date());
  const [manualLocationId, setManualLocationId] = useState<string>('');
  // Separate fields HH:MM for better UX
  const [manualEntryH, setManualEntryH] = useState('');
  const [manualEntryM, setManualEntryM] = useState('');
  const [manualExitH, setManualExitH] = useState('');
  const [manualExitM, setManualExitM] = useState('');
  const [manualPause, setManualPause] = useState('');

  // Session finished modal
  const [showSessionFinishedModal, setShowSessionFinishedModal] = useState(false);

  // ============================================
  // DERIVED STATE
  // ============================================

  const activeLocation = activeGeofence ? locations.find(l => l.id === activeGeofence) : null;
  const canRestart = activeLocation && !currentSession;
  const sessions = viewMode === 'week' ? weekSessions : monthSessions;
  const weekStart = getWeekStart(currentWeek);
  const weekEnd = getWeekEnd(currentWeek);

  // ============================================
  // TIMER EFFECT - Main for when paused
  // ============================================

  useEffect(() => {
    if (!currentSession || currentSession.status !== 'active') {
      setTimer('00:00:00');
      setIsPaused(false);
      setAccumulatedPauseSeconds(0);
      setPauseTimer('00:00:00');
      setPauseStartTimestamp(null);
      setFrozenTime(null);
      return;
    }

    // If paused, show frozen time and don't update
    if (isPaused) {
      if (frozenTime) {
        setTimer(frozenTime);
      }
      return;
    }

    const updateTimer = () => {
      const start = new Date(currentSession.entry_at).getTime();
      const now = Date.now();
      // Subtract total pause time from calculation
      const diffMs = now - start - (accumulatedPauseSeconds * 1000);
      const diffSec = Math.max(0, Math.floor(diffMs / 1000));
      
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;
      
      const newTime = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      setTimer(newTime);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [currentSession, isPaused, frozenTime, accumulatedPauseSeconds]);

  // Pause timer effect
  useEffect(() => {
    if (!currentSession || currentSession.status !== 'active') return;

    const updatePauseTimer = () => {
      let totalPauseSeconds = accumulatedPauseSeconds;
      
      if (isPaused && pauseStartTimestamp) {
        totalPauseSeconds += Math.floor((Date.now() - pauseStartTimestamp) / 1000);
      }
      
      const hours = Math.floor(totalPauseSeconds / 3600);
      const mins = Math.floor((totalPauseSeconds % 3600) / 60);
      const secs = totalPauseSeconds % 60;
      
      setPauseTimer(
        `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      );
    };

    updatePauseTimer();
    const interval = setInterval(updatePauseTimer, 1000);
    return () => clearInterval(interval);
  }, [isPaused, pauseStartTimestamp, accumulatedPauseSeconds, currentSession]);

  // Session finished modal effect
  useEffect(() => {
    if (lastFinishedSession) {
      setShowSessionFinishedModal(true);
    } else {
      setShowSessionFinishedModal(false);
    }
  }, [lastFinishedSession]);

  // ============================================
  // LOAD DATA
  // ============================================

  const loadWeekSessions = useCallback(async () => {
    const start = getWeekStart(currentWeek);
    const end = getWeekEnd(currentWeek);
    const result = await getSessionsByPeriod(start.toISOString(), end.toISOString());
    setWeekSessions(result);
  }, [currentWeek, getSessionsByPeriod]);

  const loadMonthSessions = useCallback(async () => {
    const start = getMonthStart(currentMonth);
    const end = getMonthEnd(currentMonth);
    const result = await getSessionsByPeriod(start.toISOString(), end.toISOString());
    setMonthSessions(result);
  }, [currentMonth, getSessionsByPeriod]);

  useEffect(() => {
    if (viewMode === 'week') {
      loadWeekSessions();
    } else {
      loadMonthSessions();
    }
  }, [viewMode, currentWeek, currentMonth, loadWeekSessions, loadMonthSessions]);

  useEffect(() => {
    if (viewMode === 'week') {
      loadWeekSessions();
    } else {
      loadMonthSessions();
    }
  }, [currentSession]);

  // ============================================
  // SESSION MODAL HANDLERS
  // ============================================

  const handleDismissSessionModal = () => {
    setShowSessionFinishedModal(false);
    clearLastSession();
  };

  const handleShareSession = async () => {
    await shareLastSession();
    handleDismissSessionModal();
  };

  // ============================================
  // REFRESH
  // ============================================

  const onRefresh = async () => {
    setRefreshing(true);
    await reloadData();
    if (viewMode === 'week') {
      await loadWeekSessions();
    } else {
      await loadMonthSessions();
    }
    await syncNow();
    setRefreshing(false);
  };

  // ============================================
  // TIMER ACTIONS
  // ============================================

  const handlePause = () => {
    // Freeze current time before pausing
    setFrozenTime(timer);
    setIsPaused(true);
    setPauseStartTimestamp(Date.now());
  };

  const handleResume = () => {
    if (pauseStartTimestamp) {
      const pauseDuration = Math.floor((Date.now() - pauseStartTimestamp) / 1000);
      setAccumulatedPauseSeconds(prev => prev + pauseDuration);
    }
    setPauseStartTimestamp(null);
    setFrozenTime(null); // Release to resume counting
    setIsPaused(false);
  };

  const handleStop = () => {
    if (!currentSession) return;
    
    let totalPauseSeconds = accumulatedPauseSeconds;
    if (isPaused && pauseStartTimestamp) {
      totalPauseSeconds += Math.floor((Date.now() - pauseStartTimestamp) / 1000);
    }
    const totalPauseMinutes = Math.floor(totalPauseSeconds / 60);

    Alert.alert(
      '⏹️ Stop Timer',
      `End current session?${totalPauseMinutes > 0 ? `\n\nTotal break: ${totalPauseMinutes} minutes` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            try {
              await registerExit(currentSession.location_id);
              
              if (totalPauseMinutes > 0) {
                await editRecord(currentSession.id, {
                  pause_minutes: totalPauseMinutes,
                  manually_edited: 1,
                  edit_reason: 'Break recorded automatically',
                });
              }
              
              setIsPaused(false);
              setAccumulatedPauseSeconds(0);
              setPauseStartTimestamp(null);
              setPauseTimer('00:00:00');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Could not stop session');
            }
          },
        },
      ]
    );
  };

  const handleRestart = async () => {
    if (!activeLocation) return;
    Alert.alert(
      '▶️ Start New Session',
      `Start timer at "${activeLocation.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            try {
              await registerEntry(activeLocation.id, activeLocation.name);
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

  const weekCalendarDays: CalendarDay[] = useMemo(() => {
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);

      const daySessions = weekSessions.filter(s => {
        const sessionDate = new Date(s.entry_at);
        return isSameDay(sessionDate, date);
      });

      const totalMinutes = daySessions
        .filter(s => s.exit_at)
        .reduce((acc, s) => {
          const pauseMin = s.pause_minutes || 0;
          return acc + Math.max(0, s.duration_minutes - pauseMin);
        }, 0);

      days.push({
        date,
        weekday: WEEKDAYS[date.getDay()],
        dayNumber: date.getDate(),
        sessions: daySessions,
        totalMinutes,
      });
    }
    return days;
  }, [weekStart, weekSessions]);

  const monthCalendarDays = useMemo(() => {
    return getMonthCalendarDays(currentMonth);
  }, [currentMonth]);

  const getSessionsForDay = useCallback((date: Date): ComputedSession[] => {
    return sessions.filter(s => {
      const sessionDate = new Date(s.entry_at);
      return isSameDay(sessionDate, date);
    });
  }, [sessions]);

  const getTotalMinutesForDay = useCallback((date: Date): number => {
    const daySessions = getSessionsForDay(date);
    return daySessions
      .filter(s => s.exit_at)
      .reduce((acc, s) => {
        const pauseMin = s.pause_minutes || 0;
        return acc + Math.max(0, s.duration_minutes - pauseMin);
      }, 0);
  }, [getSessionsForDay]);

  const weekTotalMinutes = weekSessions
    .filter(s => s.exit_at)
    .reduce((acc, s) => {
      const pauseMin = s.pause_minutes || 0;
      return acc + Math.max(0, s.duration_minutes - pauseMin);
    }, 0);

  const monthTotalMinutes = monthSessions
    .filter(s => s.exit_at)
    .reduce((acc, s) => {
      const pauseMin = s.pause_minutes || 0;
      return acc + Math.max(0, s.duration_minutes - pauseMin);
    }, 0);

  // ============================================
  // NAVIGATION
  // ============================================

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedDays(new Set());
  };

  const goToPreviousWeek = () => {
    const newDate = new Date(currentWeek);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentWeek(newDate);
    setExpandedDay(null);
    cancelSelection();
  };

  const goToNextWeek = () => {
    const newDate = new Date(currentWeek);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentWeek(newDate);
    setExpandedDay(null);
    cancelSelection();
  };

  const goToCurrentWeek = () => {
    setCurrentWeek(new Date());
    setExpandedDay(null);
    cancelSelection();
  };

  const goToPreviousMonth = () => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() - 1);
    setCurrentMonth(newDate);
    setExpandedDay(null);
    cancelSelection();
  };

  const goToNextMonth = () => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() + 1);
    setCurrentMonth(newDate);
    setExpandedDay(null);
    cancelSelection();
  };

  const goToCurrentMonth = () => {
    setCurrentMonth(new Date());
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

  const handleDayPress = (dayKey: string, hasSessions: boolean) => {
    if (selectionMode) {
      if (hasSessions) {
        toggleSelectDay(dayKey);
      }
    } else if (hasSessions) {
      setExpandedDay(expandedDay === dayKey ? null : dayKey);
    }
  };

  const handleDayLongPress = (dayKey: string, hasSessions: boolean) => {
    if (!hasSessions) return;
    
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
    setManualLocationId(locations[0]?.id || '');
    // Default values: 08:00 and 17:00
    setManualEntryH('08');
    setManualEntryM('00');
    setManualExitH('17');
    setManualExitM('00');
    setManualPause('');
    setShowManualModal(true);
  };

  const handleSaveManual = async () => {
    if (!manualLocationId) {
      Alert.alert('Error', 'Select a location');
      return;
    }
    if (!manualEntryH || !manualEntryM || !manualExitH || !manualExitM) {
      Alert.alert('Error', 'Fill in entry and exit times');
      return;
    }

    const entryH = parseInt(manualEntryH, 10);
    const entryM = parseInt(manualEntryM, 10);
    const exitH = parseInt(manualExitH, 10);
    const exitM = parseInt(manualExitM, 10);

    if (isNaN(entryH) || isNaN(entryM) || isNaN(exitH) || isNaN(exitM)) {
      Alert.alert('Error', 'Invalid time format');
      return;
    }
    
    // Range validation
    if (entryH < 0 || entryH > 23 || entryM < 0 || entryM > 59 ||
        exitH < 0 || exitH > 23 || exitM < 0 || exitM > 59) {
      Alert.alert('Error', 'Invalid time values');
      return;
    }

    const entryDate = new Date(manualDate);
    entryDate.setHours(entryH, entryM, 0, 0);

    const exitDate = new Date(manualDate);
    exitDate.setHours(exitH, exitM, 0, 0);

    if (exitDate <= entryDate) {
      Alert.alert('Error', 'Exit must be after entry');
      return;
    }

    const pauseMinutes = manualPause ? parseInt(manualPause, 10) : 0;

    try {
      const location = locations.find(l => l.id === manualLocationId);
      await createManualRecord({
        locationId: manualLocationId,
        locationName: location?.name || 'Location',
        entry: entryDate.toISOString(),
        exit: exitDate.toISOString(),
        pauseMinutes: pauseMinutes,
      });
      Alert.alert('✅ Success', 'Record added!');

      setShowManualModal(false);
      setManualPause('');
      if (viewMode === 'week') {
        loadWeekSessions();
      } else {
        loadMonthSessions();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not save');
    }
  };

  // ============================================
  // DELETE DAY
  // ============================================

  const handleDeleteDay = (_dayKey: string, daySessions: ComputedSession[]) => {
    const finishedSessions = daySessions.filter(s => s.exit_at);
    if (finishedSessions.length === 0) return;

    Alert.alert(
      '🗑️ Delete Day',
      `Delete all ${finishedSessions.length} record(s) from this day?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              for (const session of finishedSessions) {
                await deleteRecord(session.id);
              }
              setExpandedDay(null);
              if (viewMode === 'week') {
                loadWeekSessions();
              } else {
                loadMonthSessions();
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

  const exportAsText = async (sessionsToExport: ComputedSession[]) => {
    const txt = generateCompleteReport(sessionsToExport, userName || undefined);
    
    try {
      await Share.share({ message: txt, title: 'Time Report' });
      cancelSelection();
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const exportAsFile = async (sessionsToExport: ComputedSession[]) => {
    const txt = generateCompleteReport(sessionsToExport, userName || undefined);
    
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
    let sessionsToExport: ComputedSession[];
    
    if (selectionMode && selectedDays.size > 0) {
      sessionsToExport = sessions.filter(s => {
        const sessionDate = new Date(s.entry_at);
        const dayKey = getDayKey(sessionDate);
        return selectedDays.has(dayKey);
      });
    } else {
      sessionsToExport = sessions;
    }

    const finishedSessions = sessionsToExport.filter(s => s.exit_at);

    if (finishedSessions.length === 0) {
      Alert.alert('Warning', 'No completed sessions to export');
      return;
    }

    Alert.alert(
      '📤 Export Report',
      'How would you like to export?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '💬 Text (WhatsApp)', onPress: () => exportAsText(finishedSessions) },
        { text: '📄 File', onPress: () => exportAsFile(finishedSessions) },
      ]
    );
  };

  // ============================================
  // RETURN
  // ============================================

  return {
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
    sessions,
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
    
    // Helpers (re-export for JSX)
    formatDateRange,
    formatMonthYear,
    formatTimeAMPM,
    formatDuration,
    isToday,
    getDayKey,
    isSameDay,
  };
}

// Export type for use in component
export type UseHomeScreenReturn = ReturnType<typeof useHomeScreen>;
