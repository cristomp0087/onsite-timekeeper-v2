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
 * UPDATED: Removed session finished modal, added day detail modal with session selection
 * UPDATED: Added pending export handling for notification flow
 * FIX: Now uses currentFenceId instead of lastGeofenceEvent for START button (fixes button not appearing)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Alert, Share, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { useAuthStore } from '../../stores/authStore';
import { 
  useLocationStore, 
  selectLocations, 
  selectActiveGeofence, 
  selectIsGeofencingActive,
  selectCurrentFenceId // NEW: Import new selector
} from '../../stores/locationStore';
import { useRecordStore } from '../../stores/recordStore';
import { useSyncStore } from '../../stores/syncStore';
import { useSettingsStore } from '../../stores/settingsStore';
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
  isFutureDay,
  isWeekend,
  getDayKey,
  DAY_TAGS,
  type CalendarDay,
  type DayTagType,
} from './helpers';




// ============================================
// HOOK
// ============================================

export function useHomeScreen() {
  // ============================================
  // STORES
  // ============================================
  
  const userName = useAuthStore(s => s.getUserName());
  const userId = useAuthStore(s => s.getUserId());
  
  // Using selectors for locationStore (proper Zustand pattern)
  const locations = useLocationStore(selectLocations);
  const activeGeofence = useLocationStore(selectActiveGeofence);
  const isGeofencingActive = useLocationStore(selectIsGeofencingActive);
  // NEW: Use currentFenceId instead of lastGeofenceEvent
  const currentFenceId = useLocationStore(selectCurrentFenceId);



  
  const { 
    currentSession, 
    reloadData, 
    registerExit, 
    registerEntry,
    getSessionsByPeriod,
    createManualRecord,
    editRecord,
    deleteRecord,
  } = useRecordStore();


   


  const { syncNow } = useSyncStore();

  // Pending export from notification
  const pendingReportExport = useSettingsStore(s => s.pendingReportExport);
  const clearPendingReportExport = useSettingsStore(s => s.clearPendingReportExport);

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
  
  // Expanded day (for week view inline - DEPRECATED, keeping for compatibility)
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  
  // Multi-select DAYS (for batch export)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());

  // NEW: Day Detail Modal
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDayForModal, setSelectedDayForModal] = useState<Date | null>(null);
  
  // NEW: Session selection (inside day modal)
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());

  // NEW: Export modal (for notification-triggered export)
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportModalSessions, setExportModalSessions] = useState<ComputedSession[]>([]);
  const [exportModalPeriod, setExportModalPeriod] = useState<string>('');

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
  
  // Manual entry mode: 'hours' or 'absence'
  const [manualEntryMode, setManualEntryMode] = useState<'hours' | 'absence'>('hours');
  const [manualAbsenceType, setManualAbsenceType] = useState<string | null>(null);

  // Day Tags (Rain, Snow, Day Off, etc.)
  const [dayTags, setDayTags] = useState<Record<string, DayTagType>>({});
  const [showTagModal, setShowTagModal] = useState(false);
  const [tagModalDate, setTagModalDate] = useState<Date | null>(null);

  // REMOVED: showSessionFinishedModal - was causing confusion

  // ============================================
  // DERIVED STATE
  // ============================================

  // FIX: Simplified logic using currentFenceId from store
  // currentFenceId already tracks which fence user is physically inside,
  // independent of whether there's an active session
  const activeLocation = currentFenceId ? locations.find(l => l.id === currentFenceId) : null;
  const canRestart = activeLocation && !currentSession;
  
  const sessions = viewMode === 'week' ? weekSessions : monthSessions;
  const weekStart = getWeekStart(currentWeek);
  const weekEnd = getWeekEnd(currentWeek);

  // Sessions for day modal
  const dayModalSessions = useMemo(() => {
    if (!selectedDayForModal) return [];
    return sessions.filter(s => {
      const sessionDate = new Date(s.entry_at);
      return isSameDay(sessionDate, selectedDayForModal);
    });
  }, [selectedDayForModal, sessions]);

  // ============================================
  // LOCATION CARDS DATA
  // ============================================
  
  // Active locations only (not deleted)
  const activeLocations = useMemo(() => {
    return locations.filter(l => l.status === 'active' && !l.deleted_at);
  }, [locations]);

  // Compute data for each location card
  const locationCardsData = useMemo(() => {
    // Determine the period to calculate hours
    let periodSessions: ComputedSession[];
    
    if (selectedDays.size > 0) {
      // Filter sessions from selected days
      periodSessions = sessions.filter(s => {
        if (!s.exit_at) return false; // Only completed sessions
        const sessionDate = new Date(s.entry_at);
        const dayKey = getDayKey(sessionDate);
        return selectedDays.has(dayKey);
      });
    } else {
      // Default: use current week sessions
      periodSessions = weekSessions.filter(s => s.exit_at);
    }

    return activeLocations.map(location => {
      // Check if this location has active session
      const hasActiveSession = currentSession?.location_id === location.id;
      const activeSessionEntry = hasActiveSession ? currentSession?.entry_at : null;
      
      // Calculate total hours for this location in the period
      const locationSessions = periodSessions.filter(s => s.location_id === location.id);
      const totalMinutes = locationSessions.reduce((acc, s) => {
        const pauseMin = s.pause_minutes || 0;
        return acc + Math.max(0, s.duration_minutes - pauseMin);
      }, 0);

      // Format coordinates as short string
      const coordsText = `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;

      // Last check-in (most recent session for this location)
      const lastSession = [...sessions]
        .filter(s => s.location_id === location.id && s.exit_at)
        .sort((a, b) => new Date(b.entry_at).getTime() - new Date(a.entry_at).getTime())[0];
      
      let lastCheckIn = 'Never';
      if (lastSession) {
        const lastDate = new Date(lastSession.entry_at);
        if (isToday(lastDate)) {
          lastCheckIn = `Today, ${formatTimeAMPM(lastSession.entry_at)}`;
        } else {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          if (isSameDay(lastDate, yesterday)) {
            lastCheckIn = `Yesterday, ${formatTimeAMPM(lastSession.entry_at)}`;
          } else {
            lastCheckIn = lastDate.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric' 
            }) + `, ${formatTimeAMPM(lastSession.entry_at)}`;
          }
        }
      }

      return {
        id: location.id,
        name: location.name,
        color: location.color,
        coords: coordsText,
        hasActiveSession,
        activeSessionEntry: activeSessionEntry ? formatTimeAMPM(activeSessionEntry) : null,
        totalMinutes,
        totalFormatted: formatDuration(totalMinutes),
        lastCheckIn,
        sessionsCount: locationSessions.length,
      };
    });
  }, [activeLocations, sessions, weekSessions, selectedDays, currentSession]);

  // ============================================
  // PENDING EXPORT EFFECT (from notification)
  // ============================================

  useEffect(() => {
    if (pendingReportExport) {
      handlePendingExport();
    }
  }, [pendingReportExport]);

  const handlePendingExport = async () => {
    if (!pendingReportExport) return;

    // Determine period
    let periodStart: Date;
    let periodEnd: Date;

    if (pendingReportExport.periodStart && pendingReportExport.periodEnd) {
      periodStart = new Date(pendingReportExport.periodStart);
      periodEnd = new Date(pendingReportExport.periodEnd);
    } else {
      // Default to current week
      periodStart = getWeekStart(new Date());
      periodEnd = getWeekEnd(new Date());
    }

    // Fetch sessions for the period
    const sessionsForPeriod = await getSessionsByPeriod(
      periodStart.toISOString(),
      periodEnd.toISOString()
    );

    const finishedSessions = sessionsForPeriod.filter(s => s.exit_at);

    if (finishedSessions.length === 0) {
      Alert.alert('No Sessions', 'No completed sessions found for this period.');
      clearPendingReportExport();
      return;
    }

    // Calculate total hours
    const totalMinutes = finishedSessions.reduce((acc, s) => {
      const pauseMin = s.pause_minutes || 0;
      return acc + Math.max(0, s.duration_minutes - pauseMin);
    }, 0);

    // Set export modal data
    setExportModalSessions(finishedSessions);
    setExportModalPeriod(formatDateRange(periodStart, periodEnd));

    // Clear the pending flag
    clearPendingReportExport();

    // Show export options
    const { favoriteContact } = useSettingsStore.getState();
    
    const options: any[] = [
      { text: 'Cancel', style: 'cancel' },
    ];

    // Add favorite option if configured (put it first for quick access)
    if (favoriteContact) {
      const icon = favoriteContact.type === 'whatsapp' ? '📱' : '📧';
      const label = favoriteContact.name || favoriteContact.value;
      options.push({
        text: `${icon} Send to ${label}`,
        onPress: () => sendToFavorite(finishedSessions),
      });
    }

    // Standard options
    options.push(
      { text: '💬 Share', onPress: () => exportAsText(finishedSessions) },
      { text: '📄 Save File', onPress: () => exportAsFile(finishedSessions) },
    );

    Alert.alert(
      '📊 Weekly Report',
      `${formatDuration(totalMinutes)} worked\n${formatDateRange(periodStart, periodEnd)}\n\n${finishedSessions.length} session(s)`,
      options
    );
  };

  // ============================================
  // TIMER EFFECT
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

  // REMOVED: Session finished modal effect - was causing confusion

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

  // Note: Removed useEffect[currentSession] - was causing memory issues
  // The effect above already handles all necessary reloads

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
              
              // Reload data to show the finished session
              if (viewMode === 'week') {
                loadWeekSessions();
              } else {
                loadMonthSessions();
              }
              
              // REMOVED: No longer showing session finished modal
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
  // DAY SELECTION (for batch export)
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

  // ============================================
  // DAY PRESS HANDLERS (UPDATED!)
  // ============================================

const handleDayPress = (dayKey: string, hasSessions: boolean) => {
  // Parse date safely (YYYY-MM-DD)
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  
  // Block future days
  if (isFutureDay(date)) {
    return; // Do nothing for future days
  }
  
  if (selectionMode) {
    // In selection mode, allow selecting ANY past/present day (including empty)
    toggleSelectDay(dayKey);
  } else {
    // Normal mode: open day modal
    openDayModal(date);
  }
};

  const handleDayLongPress = (dayKey: string, hasSessions: boolean) => {
    // Parse date
    const [year, month, day] = dayKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    
    // Block future days
    if (isFutureDay(date)) {
      return;
    }
    
    if (!selectionMode) {
      // Enter selection mode - allow even empty days
      setSelectionMode(true);
      setSelectedDays(new Set([dayKey]));
      setExpandedDay(null);
      setShowDayModal(false);
    } else {
      toggleSelectDay(dayKey);
    }
  };

  // ============================================
  // DAY MODAL (NEW!)
  // ============================================

  const openDayModal = (date: Date) => {
    setSelectedDayForModal(date);
    setSelectedSessions(new Set());
    setShowDayModal(true);
  };

  const closeDayModal = () => {
    setShowDayModal(false);
    setSelectedDayForModal(null);
    setSelectedSessions(new Set());
  };

  // ============================================
  // SESSION SELECTION (NEW!)
  // ============================================

  const toggleSelectSession = (sessionId: string) => {
    const newSet = new Set(selectedSessions);
    if (newSet.has(sessionId)) {
      newSet.delete(sessionId);
    } else {
      newSet.add(sessionId);
    }
    setSelectedSessions(newSet);
  };

  const selectAllSessions = () => {
    const finishedSessions = dayModalSessions.filter(s => s.exit_at);
    setSelectedSessions(new Set(finishedSessions.map(s => s.id)));
  };

  const deselectAllSessions = () => {
    setSelectedSessions(new Set());
  };

  // ============================================
  // DAY TAGS (Rain, Snow, Day Off, etc.)
  // ============================================

  const openTagModal = (date: Date) => {
    // Block future days
    if (isFutureDay(date)) return;
    
    setTagModalDate(date);
    setShowTagModal(true);
  };

  const closeTagModal = () => {
    setShowTagModal(false);
    setTagModalDate(null);
  };

  const setDayTag = (date: Date, tagType: DayTagType | null) => {
    const dayKey = getDayKey(date);
    setDayTags(prev => {
      const newTags = { ...prev };
      if (tagType === null) {
        delete newTags[dayKey];
      } else {
        newTags[dayKey] = tagType;
      }
      return newTags;
    });
    closeTagModal();
  };

  const getDayTag = (date: Date): DayTagType | null => {
    const dayKey = getDayKey(date);
    return dayTags[dayKey] || null;
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
    // Reset entry mode
    setManualEntryMode('hours');
    setManualAbsenceType(null);
    setShowManualModal(true);
    // Close day modal if open
    setShowDayModal(false);
  };

  const handleSaveManual = async () => {
    // Handle absence mode
    if (manualEntryMode === 'absence') {
      if (!manualAbsenceType) {
        Alert.alert('Error', 'Select an absence reason');
        return;
      }
      
      // For absence, we don't need location but use first one as placeholder
      const location = locations[0];
      if (!location) {
        Alert.alert('Error', 'No location configured');
        return;
      }
      
      // Create a record with entry = exit (0 duration)
      const absenceDate = new Date(manualDate);
      absenceDate.setHours(0, 0, 0, 0);
      const isoDate = absenceDate.toISOString();
      
      try {
        await createManualRecord({
          locationId: location.id,
          locationName: location.name,
          entry: isoDate,
          exit: isoDate,
          pauseMinutes: 0,
          absenceType: manualAbsenceType,
        });
        
        const absenceLabels: Record<string, string> = {
          rain: 'Rain Day',
          snow: 'Snow Day',
          sick: 'Sick Day',
          day_off: 'Day Off',
          holiday: 'Holiday',
        };
        Alert.alert('✅ Success', `${absenceLabels[manualAbsenceType]} recorded!`);
        
        setShowManualModal(false);
        setManualAbsenceType(null);
        setManualEntryMode('hours');
        
        // Reload week/month sessions to show the new record
        if (viewMode === 'week') {
          await loadWeekSessions();
        } else {
          await loadMonthSessions();
        }
      } catch (error: any) {
        Alert.alert('Error', error.message || 'Could not save');
      }
      return;
    }
    
    // Handle hours mode (original logic)
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
      
      // Reload week/month sessions to show the new record
      if (viewMode === 'week') {
        await loadWeekSessions();
      } else {
        await loadMonthSessions();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not save');
    }
  };

  // ============================================
  // DELETE - UNIFIED ARCHITECTURE
  // ============================================

  /**
   * Core delete function - single source of truth
   * All delete operations go through here
   */
  const deleteSessionsByIds = async (
    sessionIds: string[], 
    options: { 
      closeModal?: boolean; 
      closeBatch?: boolean;
      silent?: boolean;
    } = {}
  ) => {
    const { closeModal = false, closeBatch = false, silent = false } = options;
    
    if (sessionIds.length === 0) {
      if (!silent) {
        Alert.alert('Nothing to delete', 'No sessions found.');
      }
      if (closeBatch) {
        cancelSelection();
      }
      return;
    }

    const confirmDelete = async () => {
      let deleted = 0;
      for (const id of sessionIds) {
        try {
          await deleteRecord(id);
          deleted++;
        } catch (e: any) {
          // Ignore "not found" - already deleted
          if (!e?.message?.includes('not found')) {
            console.warn('Delete error:', e);
          }
        }
      }
      
      // Always reload fresh data
      await reloadData();
      if (viewMode === 'week') {
        loadWeekSessions();
      } else {
        loadMonthSessions();
      }
      
      // Clear states
      setSelectedSessions(new Set());
      
      if (closeModal) {
        closeDayModal();
      }
      if (closeBatch) {
        cancelSelection();
      }
      
      if (deleted > 0 && !silent) {
        Alert.alert('✅ Deleted', `${deleted} session(s) deleted.`);
      }
    };

    Alert.alert(
      '🗑️ Delete Sessions',
      `Delete ${sessionIds.length} session(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDelete },
      ]
    );
  };

  /**
   * Delete from Day Modal - uses selected or all sessions
   */
  const handleDeleteFromModal = () => {
    const finishedSessions = dayModalSessions.filter(s => s.exit_at);
    
    let idsToDelete: string[];
    if (selectedSessions.size > 0) {
      // Delete only selected
      idsToDelete = Array.from(selectedSessions);
    } else {
      // Delete all from day
      idsToDelete = finishedSessions.map(s => s.id);
    }
    
    deleteSessionsByIds(idsToDelete, { closeModal: true });
  };

  /**
   * Delete single session (long press on session item)
   */
  const handleDeleteSession = (session: ComputedSession) => {
    deleteSessionsByIds([session.id], { closeModal: false });
  };

  /**
   * Delete selected sessions inside modal
   */
  const handleDeleteSelectedSessions = () => {
    if (selectedSessions.size === 0) return;
    const ids = Array.from(selectedSessions);
    deleteSessionsByIds(ids, { closeModal: false });
  };

  /**
   * Delete from batch selection (long press days)
   */
  const handleDeleteSelectedDays = () => {
    if (!selectionMode || selectedDays.size === 0) {
      Alert.alert('Nothing selected', 'Long press a day to select.');
      return;
    }

    // Get fresh sessions using getSessionsForDay
    const allIds: string[] = [];
    for (const dayKey of selectedDays) {
      const [year, month, day] = dayKey.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const daySessions = getSessionsForDay(date).filter(s => s.exit_at);
      allIds.push(...daySessions.map(s => s.id));
    }

    deleteSessionsByIds(allIds, { closeBatch: true });
  };

  // Keep for backward compatibility
  const handleDeleteDay = (_dayKey: string, daySessions: ComputedSession[]) => {
    const ids = daySessions.filter(s => s.exit_at).map(s => s.id);
    deleteSessionsByIds(ids, { closeModal: true });
  };

  // ============================================
  // EXPORT
  // ============================================

  const exportAsText = async (sessionsToExport: ComputedSession[]) => {
    const txt = generateCompleteReport(sessionsToExport, userName || undefined, userId || undefined);
    
    try {
      await Share.share({ message: txt, title: 'Time Report' });
      cancelSelection();
      closeDayModal();
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const exportAsFile = async (sessionsToExport: ComputedSession[]) => {
    const txt = generateCompleteReport(sessionsToExport, userName || undefined, userId || undefined);
    
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
      closeDayModal();
    } catch (error) {
      console.error('Error exporting file:', error);
      Alert.alert('Error', 'Could not create file');
    }
  };

  // Export from main calendar (days selection or full period)
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

    const { favoriteContact } = useSettingsStore.getState();

    // Build options dynamically
    const options: any[] = [
      { text: 'Cancel', style: 'cancel' },
    ];

    // Add favorite option if configured
    if (favoriteContact) {
      const icon = favoriteContact.type === 'whatsapp' ? '📱' : '📧';
      const label = favoriteContact.name || favoriteContact.value;
      options.push({
        text: `${icon} ${label}`,
        onPress: () => sendToFavorite(finishedSessions),
      });
    }

    // Standard options
    options.push(
      { text: '💬 Share', onPress: () => exportAsText(finishedSessions) },
      { text: '📄 File', onPress: () => exportAsFile(finishedSessions) },
    );

    Alert.alert(
      '📤 Export Report',
      'How would you like to export?',
      options
    );
  };


  // NEW: Send to favorite contact
  const sendToFavorite = async (sessionsToExport: ComputedSession[]) => {
    const { favoriteContact } = useSettingsStore.getState();
    if (!favoriteContact) {
      Alert.alert('No Favorite', 'Please set a favorite contact in Settings > Auto-Report');
      return;
    }

    const report = generateCompleteReport(sessionsToExport, userName || undefined, userId || undefined);

    try {
      if (favoriteContact.type === 'whatsapp') {
        // Open WhatsApp with pre-filled message
        const phone = favoriteContact.value.replace(/\D/g, '');
        const url = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(report)}`;
        
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          closeDayModal();
          cancelSelection();
        } else {
          Alert.alert('Error', 'WhatsApp is not installed');
        }
      } else {
        // Open email composer
        const subject = encodeURIComponent('Time Report - OnSite Timekeeper');
        const body = encodeURIComponent(report);
        const url = `mailto:${favoriteContact.value}?subject=${subject}&body=${body}`;
        await Linking.openURL(url);
        closeDayModal();
        cancelSelection();
      }
    } catch (error) {
      console.error('Error sending to favorite:', error);
      Alert.alert('Error', 'Could not open app');
    }
  };

  // NEW: Export from day modal (specific sessions)
  const handleExportFromModal = async () => {
    if (!selectedDayForModal) return;

    const finishedSessions = dayModalSessions.filter(s => s.exit_at);
    
    let sessionsToExport: ComputedSession[];
    
    if (selectedSessions.size > 0) {
      // Export only selected sessions
      sessionsToExport = finishedSessions.filter(s => selectedSessions.has(s.id));
    } else {
      // Export all sessions from the day
      sessionsToExport = finishedSessions;
    }

    if (sessionsToExport.length === 0) {
      Alert.alert('Warning', 'No sessions to export');
      return;
    }

    const { favoriteContact } = useSettingsStore.getState();
    console.log('🔍 DEBUG favoriteContact:', JSON.stringify(favoriteContact));
    const exportLabel = selectedSessions.size > 0 
      ? `Export ${selectedSessions.size} session(s)?`
      : `Export all ${sessionsToExport.length} session(s) from this day?`;

    // Build options dynamically
    const options: any[] = [
      { text: 'Cancel', style: 'cancel' },
    ];

    // Add favorite option if configured
    if (favoriteContact) {
      const icon = favoriteContact.type === 'whatsapp' ? '📱' : '📧';
      const label = favoriteContact.name || favoriteContact.value;
      options.push({
        text: `${icon} ${label}`,
        onPress: () => sendToFavorite(sessionsToExport),
      });
    }

    // Standard options
    options.push(
      { text: '💬 Share', onPress: () => exportAsText(sessionsToExport) },
      { text: '📄 File', onPress: () => exportAsFile(sessionsToExport) },
    );

    Alert.alert('📤 Export', exportLabel, options);
  };

  // ============================================
  // RETURN
  // ============================================

  return {
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
    sessions,
    weekCalendarDays,
    monthCalendarDays,
    weekTotalMinutes,
    monthTotalMinutes,
    expandedDay, // Keep for backward compat, but not used in new UI
    
    // Day selection (batch)
    selectionMode,
    selectedDays,
    cancelSelection,
    
    // NEW: Day Modal
    showDayModal,
    selectedDayForModal,
    dayModalSessions,
    openDayModal,
    closeDayModal,
    
    // NEW: Location Cards
    activeLocations,
    locationCardsData,
    
    // NEW: Session selection
    selectedSessions,
    toggleSelectSession,
    selectAllSessions,
    deselectAllSessions,
    
    // NEW: Export modal (notification triggered)
    showExportModal,
    exportModalSessions,
    exportModalPeriod,
    
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
    handleDeleteDay,
    handleDeleteSession,
    handleDeleteSelectedSessions,
    handleDeleteFromModal,
    handleExport,
    handleDeleteSelectedDays,
    handleExportFromModal,
    sendToFavorite,
    
    // Day Tags
    dayTags,
    showTagModal,
    tagModalDate,
    openTagModal,
    closeTagModal,
    setDayTag,
    getDayTag,
    
    // Helpers (re-export for JSX)
    formatDateRange,
    formatMonthYear,
    formatTimeAMPM,
    formatDuration,
    isToday,
    isFutureDay,
    isWeekend,
    getDayKey,
    isSameDay,
    DAY_TAGS,
  };
}

// Export type for use in component
export type UseHomeScreenReturn = ReturnType<typeof useHomeScreen>;
