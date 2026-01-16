/**
 * Home Screen - OnSite Timekeeper
 *
 * v2.0: Enhanced manual entry UX
 * - Date picker with visual indicator
 * - Time picker modals (tap-to-select)
 * - Real-time total hours calculation
 * - Improved visual hierarchy
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ViewStyle,
  Image,
  Linking,
  ScrollView,
  Platform,
  Animated,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

import { Card } from '../../src/components/ui/Button';
import { colors } from '../../src/constants/colors';
import type { WorkLocation } from '../../src/stores/locationStore';

import { useHomeScreen } from '../../src/screens/home/hooks';
import { styles, fixedStyles } from '../../src/screens/home/styles';
import { HomePermissionBanner } from '../../src/components/PermissionBanner';

// Helper to format date
function formatDate(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
}

// Helper to format date with day
function formatDateWithDay(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

// Calculate total hours
function calculateTotalHours(entryH: string, entryM: string, exitH: string, exitM: string, pauseMin: string): string {
  const entryHour = parseInt(entryH) || 0;
  const entryMinute = parseInt(entryM) || 0;
  const exitHour = parseInt(exitH) || 0;
  const exitMinute = parseInt(exitM) || 0;
  const pause = parseInt(pauseMin) || 0;

  if (!entryH || !exitH) return '--';

  const entryTotal = entryHour * 60 + entryMinute;
  const exitTotal = exitHour * 60 + exitMinute;
  let worked = exitTotal - entryTotal;

  if (worked < 0) worked += 24 * 60; // Handle overnight shifts
  worked -= pause;

  if (worked < 0) return '--';

  const hours = Math.floor(worked / 60);
  const minutes = worked % 60;

  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

export default function HomeScreen() {
  const router = useRouter();
  const [showLogoTooltip, setShowLogoTooltip] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);

  // Date picker state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  // Time picker modals (using native pickers)
  const [showEntryPicker, setShowEntryPicker] = useState(false);
  const [showExitPicker, setShowExitPicker] = useState(false);
  const [tempEntryTime, setTempEntryTime] = useState(new Date());
  const [tempExitTime, setTempExitTime] = useState(new Date());

  // Break dropdown state
  const [showBreakDropdown, setShowBreakDropdown] = useState(false);
  const [showBreakCustomInput, setShowBreakCustomInput] = useState(false);

  // Toast notification for future dates
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const {
    userName,
    locations,
    currentSession,
    activeLocation,
    canRestart,
    isGeofencingActive,
    timer,
    isPaused,
    pauseTimer,
    activeLocations,
    locationCardsData,
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
    handlePause,
    handleResume,
    handleStop,
    handleRestart,
    handleSaveManual,
    getSuggestedTimes,
  } = useHomeScreen();

  useEffect(() => {
    if (locations.length > 0 && !manualLocationId) {
      const firstLocationId = locations[0].id;
      setManualLocationId(firstLocationId);
      const suggested = getSuggestedTimes?.(firstLocationId);
      if (suggested) {
        setManualEntryH(suggested.entryH);
        setManualEntryM(suggested.entryM);
        setManualExitH(suggested.exitH);
        setManualExitM(suggested.exitM);
      } else {
        setManualEntryH('09');
        setManualEntryM('00');
        setManualExitH('17');
        setManualExitM('00');
      }
    }
  }, [locations]);

  const handleLocationChange = (locationId: string) => {
    setManualLocationId(locationId);
    setShowLocationDropdown(false);
    const suggested = getSuggestedTimes?.(locationId);
    if (suggested) {
      setManualEntryH(suggested.entryH);
      setManualEntryM(suggested.entryM);
      setManualExitH(suggested.exitH);
      setManualExitM(suggested.exitM);
    }
  };

  const handleBreakSelect = (minutes: string) => {
    if (minutes === 'custom') {
      setShowBreakCustomInput(true);
      setShowBreakDropdown(false);
    } else {
      setManualPause(minutes);
      setShowBreakDropdown(false);
      setShowBreakCustomInput(false);
    }
  };

  const selectedLocation = locations.find((l: WorkLocation) => l.id === manualLocationId);

  // Show toast notification
  const showToast = (message: string) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(2500),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setToastMessage(''));
  };

  // Date selection handlers
  const handleDateSelect = (option: 'today' | 'yesterday' | 'custom') => {
    const newDate = new Date();
    if (option === 'yesterday') {
      newDate.setDate(newDate.getDate() - 1);
    } else if (option === 'custom') {
      setShowDatePicker(true);
      setShowDateDropdown(false);
      return;
    }
    setSelectedDate(newDate);
    setShowDateDropdown(false);
  };

  const onDateChange = (event: any, date?: Date) => {
    setShowDatePicker(false);
    if (date && event.type === 'set') {
      // Check if date is in the future
      const today = new Date();
      today.setHours(23, 59, 59, 999); // End of today

      if (date > today) {
        showToast('⚠️ Cannot log hours for future dates');
        return;
      }

      setSelectedDate(date);
    }
  };

  // Time picker handlers
  const handleOpenEntryPicker = () => {
    const hour = parseInt(manualEntryH) || 9;
    const minute = parseInt(manualEntryM) || 0;
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    setTempEntryTime(date);
    setShowEntryPicker(true);
  };

  const handleOpenExitPicker = () => {
    const hour = parseInt(manualExitH) || 17;
    const minute = parseInt(manualExitM) || 0;
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    setTempExitTime(date);
    setShowExitPicker(true);
  };

  const onEntryTimeChange = (event: any, time?: Date) => {
    if (Platform.OS === 'android') {
      setShowEntryPicker(false);
    }
    if (time && event.type === 'set') {
      const h = time.getHours().toString().padStart(2, '0');
      const m = time.getMinutes().toString().padStart(2, '0');
      setManualEntryH(h);
      setManualEntryM(m);
      if (Platform.OS === 'ios') {
        setTempEntryTime(time);
      }
    }
  };

  const onExitTimeChange = (event: any, time?: Date) => {
    if (Platform.OS === 'android') {
      setShowExitPicker(false);
    }
    if (time && event.type === 'set') {
      const h = time.getHours().toString().padStart(2, '0');
      const m = time.getMinutes().toString().padStart(2, '0');
      setManualExitH(h);
      setManualExitM(m);
      if (Platform.OS === 'ios') {
        setTempExitTime(time);
      }
    }
  };

  const confirmEntryTime = () => {
    const h = tempEntryTime.getHours().toString().padStart(2, '0');
    const m = tempEntryTime.getMinutes().toString().padStart(2, '0');
    setManualEntryH(h);
    setManualEntryM(m);
    setShowEntryPicker(false);
  };

  const confirmExitTime = () => {
    const h = tempExitTime.getHours().toString().padStart(2, '0');
    const m = tempExitTime.getMinutes().toString().padStart(2, '0');
    setManualExitH(h);
    setManualExitM(m);
    setShowExitPicker(false);
  };

  // Calculate total hours in real-time
  const totalHours = calculateTotalHours(manualEntryH, manualEntryM, manualExitH, manualExitM, manualPause);

  return (
    <View style={fixedStyles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
      {/* HEADER */}
      <View style={fixedStyles.header}>
        <TouchableOpacity
          style={styles.headerLogoContainer}
          onPress={() => setShowLogoTooltip(true)}
          activeOpacity={0.7}
        >
          <Image
            source={require('../../assets/logo_onsite.png')}
            style={fixedStyles.headerLogo}
            resizeMode="contain"
          />
        </TouchableOpacity>

        <View style={styles.headerUserContainer}>
          <Text style={styles.headerUserName} numberOfLines={1}>
            {userName || 'User'}
          </Text>
          <View style={styles.headerUserAvatar}>
            <Ionicons name="person" size={14} color={colors.textSecondary} />
          </View>
        </View>
      </View>

      {/* PERMISSION BANNER */}
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

      {/* ============================================ */}
      {/* LOCATION CARDS - Moved above form */}
      {/* ============================================ */}
      <View style={fixedStyles.locationsSection}>
        {activeLocations.length === 0 ? (
          <TouchableOpacity
            style={fixedStyles.emptyLocations}
            onPress={() => router.push('/(tabs)/map')}
          >
            <Ionicons name="location-outline" size={18} color={colors.textMuted} />
            <Text style={fixedStyles.emptyLocationsText}>Add location</Text>
          </TouchableOpacity>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={fixedStyles.locationCardsRow}
          >
            {locationCardsData.slice(0, 5).map(loc => (
              <TouchableOpacity
                key={loc.id}
                style={[
                  fixedStyles.locationCard,
                  manualLocationId === loc.id && fixedStyles.locationCardSelected
                ]}
                onPress={() => handleLocationChange(loc.id)}
                onLongPress={() => router.push(`/(tabs)/map?locationId=${loc.id}`)}
                activeOpacity={0.7}
              >
                <View style={fixedStyles.locationCardHeader}>
                  <Ionicons name="location" size={14} color={loc.color || colors.primary} />
                  <Text style={fixedStyles.locationCardName} numberOfLines={1}>{loc.name}</Text>
                </View>
                {loc.hasActiveSession ? (
                  <Text style={fixedStyles.locationCardActive}>● Active</Text>
                ) : (
                  <Text style={fixedStyles.locationCardTotal}>{loc.totalFormatted}</Text>
                )}
              </TouchableOpacity>
            ))}

            {/* Add location card */}
            <TouchableOpacity
              style={fixedStyles.addLocationCardInline}
              onPress={() => router.push('/(tabs)/map')}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={20} color={colors.primary} />
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {/* ============================================ */}
      {/* LOG HOURS FORM - Enhanced */}
      {/* ============================================ */}
      <Card style={fixedStyles.formSection}>
        {/* Date Selector */}
        <TouchableOpacity
          style={fixedStyles.dateSelector}
          onPress={() => setShowDateDropdown(!showDateDropdown)}
        >
          <View style={fixedStyles.dateSelectorContent}>
            <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            <Text style={fixedStyles.dateSelectorText}>{formatDateWithDay(selectedDate)}</Text>
          </View>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Date Dropdown */}
        {showDateDropdown && (
          <View style={fixedStyles.dateDropdown}>
            <TouchableOpacity
              style={fixedStyles.dateOption}
              onPress={() => handleDateSelect('today')}
            >
              <Ionicons name="today-outline" size={16} color={colors.text} />
              <Text style={fixedStyles.dateOptionText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={fixedStyles.dateOption}
              onPress={() => handleDateSelect('yesterday')}
            >
              <Ionicons name="arrow-back-outline" size={16} color={colors.text} />
              <Text style={fixedStyles.dateOptionText}>Yesterday</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={fixedStyles.dateOption}
              onPress={() => handleDateSelect('custom')}
            >
              <Ionicons name="calendar" size={16} color={colors.text} />
              <Text style={fixedStyles.dateOptionText}>Choose date...</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ENTRY TIME - Tap to select */}
        <View style={fixedStyles.timeRow}>
          <Text style={fixedStyles.timeLabel}>Entry</Text>
          <TouchableOpacity
            style={fixedStyles.timePickerButton}
            onPress={handleOpenEntryPicker}
          >
            <Text style={fixedStyles.timePickerText}>
              {manualEntryH.padStart(2, '0')}:{manualEntryM.padStart(2, '0')}
            </Text>
            <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* EXIT TIME - Tap to select */}
        <View style={fixedStyles.timeRow}>
          <Text style={fixedStyles.timeLabelLg}>Exit</Text>
          <TouchableOpacity
            style={fixedStyles.timePickerButtonLg}
            onPress={handleOpenExitPicker}
          >
            <Text style={fixedStyles.timePickerTextLg}>
              {manualExitH.padStart(2, '0')}:{manualExitM.padStart(2, '0')}
            </Text>
            <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* BREAK - Dropdown with presets */}
        <View style={fixedStyles.timeRow}>
          <Text style={fixedStyles.timeLabel}>Break</Text>
          {showBreakCustomInput ? (
            <View style={fixedStyles.timeInputGroup}>
              <TextInput
                style={fixedStyles.breakInput}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                value={manualPause}
                onChangeText={(t) => setManualPause(t.replace(/[^0-9]/g, '').slice(0, 3))}
                keyboardType="number-pad"
                maxLength={3}
                selectTextOnFocus
                autoFocus
                onBlur={() => setShowBreakCustomInput(false)}
              />
              <Text style={fixedStyles.breakUnit}>min</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={fixedStyles.breakDropdownButton}
              onPress={() => setShowBreakDropdown(!showBreakDropdown)}
            >
              <Text style={fixedStyles.breakDropdownText}>
                {manualPause ? `${manualPause} min` : 'None'}
              </Text>
              <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Break Dropdown Menu */}
        {showBreakDropdown && (
          <View style={fixedStyles.breakDropdownMenu}>
            <TouchableOpacity
              style={fixedStyles.breakOption}
              onPress={() => handleBreakSelect('0')}
            >
              <Text style={fixedStyles.breakOptionText}>None</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={fixedStyles.breakOption}
              onPress={() => handleBreakSelect('15')}
            >
              <Text style={fixedStyles.breakOptionText}>15 min</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={fixedStyles.breakOption}
              onPress={() => handleBreakSelect('30')}
            >
              <Text style={fixedStyles.breakOptionText}>30 min</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={fixedStyles.breakOption}
              onPress={() => handleBreakSelect('45')}
            >
              <Text style={fixedStyles.breakOptionText}>45 min</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={fixedStyles.breakOption}
              onPress={() => handleBreakSelect('60')}
            >
              <Text style={fixedStyles.breakOptionText}>60 min</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[fixedStyles.breakOption, fixedStyles.breakOptionLast]}
              onPress={() => handleBreakSelect('custom')}
            >
              <Ionicons name="create-outline" size={16} color={colors.primary} />
              <Text style={[fixedStyles.breakOptionText, { color: colors.primary }]}>Custom...</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* TOTAL HOURS - Simplified text */}
        <View style={fixedStyles.totalRowSimple}>
          <Text style={fixedStyles.totalSimple}>
            Total: <Text style={fixedStyles.totalSimpleValue}>{totalHours}</Text>
          </Text>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={fixedStyles.saveButton}
          onPress={handleSaveManual}
        >
          <Ionicons name="checkmark-circle" size={20} color={colors.buttonPrimaryText} />
          <Text style={fixedStyles.saveButtonText}>Save Hours</Text>
        </TouchableOpacity>
      </Card>

      {/* ============================================ */}
      {/* TIMER - 25% (VERTICAL LAYOUT - buttons below) */}
      {/* ============================================ */}
      <Card style={[
        fixedStyles.timerSection,
        currentSession && fixedStyles.timerSectionActive,
      ].filter(Boolean) as ViewStyle[]}>
        {currentSession ? (
          <View style={fixedStyles.timerVertical}>
            {/* Badge + Timer */}
            <View style={fixedStyles.timerTopRow}>
              <View style={fixedStyles.activeBadge}>
                <View style={fixedStyles.activeBadgeDot} />
                <Text style={fixedStyles.activeBadgeText}>{currentSession.location_name}</Text>
              </View>
              <Text style={[fixedStyles.timerDisplay, isPaused && fixedStyles.timerPaused]}>{timer}</Text>
              <View style={fixedStyles.pausaInfo}>
                <Ionicons name="cafe-outline" size={14} color={colors.textSecondary} />
                <Text style={[fixedStyles.pausaTimer, isPaused && fixedStyles.pausaTimerActive]}>
                  {pauseTimer}
                </Text>
              </View>
            </View>

            {/* Buttons BELOW - centered */}
            <View style={fixedStyles.timerActionsRow}>
              {isPaused ? (
                <TouchableOpacity style={fixedStyles.resumeBtn} onPress={handleResume}>
                  <Ionicons name="play" size={18} color={colors.buttonPrimaryText} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={fixedStyles.pauseBtn} onPress={handlePause}>
                  <Ionicons name="pause" size={18} color={colors.text} />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={fixedStyles.stopBtn} onPress={handleStop}>
                <Ionicons name="stop" size={18} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        ) : canRestart ? (
          <View style={fixedStyles.timerVertical}>
            <View style={fixedStyles.timerTopRow}>
              <View style={fixedStyles.idleBadge}>
                <View style={fixedStyles.idleBadgeDot} />
                <Text style={fixedStyles.idleBadgeText}>{activeLocation?.name}</Text>
              </View>
              <Text style={fixedStyles.timerIdle}>00:00:00</Text>
            </View>
            <View style={fixedStyles.timerActionsRow}>
              <TouchableOpacity style={fixedStyles.startBtn} onPress={handleRestart}>
                <Ionicons name="play" size={18} color={colors.buttonPrimaryText} />
                <Text style={fixedStyles.startBtnText}>Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={fixedStyles.timerWaiting}>
            <Ionicons name="location-outline" size={20} color={colors.textMuted} />
            <Text style={fixedStyles.timerWaitingText}>
              {isGeofencingActive ? 'Waiting for location...' : 'Monitoring inactive'}
            </Text>
          </View>
        )}
      </Card>

      {/* ============================================ */}
      {/* TIME PICKERS - Native Modals */}
      {/* ============================================ */}

      {/* Entry Time Picker */}
      {Platform.OS === 'ios' ? (
        <Modal
          visible={showEntryPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowEntryPicker(false)}
        >
          <TouchableOpacity
            style={fixedStyles.pickerOverlay}
            activeOpacity={1}
            onPress={() => setShowEntryPicker(false)}
          >
            <View style={fixedStyles.pickerContainer}>
              <View style={fixedStyles.pickerHeader}>
                <TouchableOpacity onPress={() => setShowEntryPicker(false)}>
                  <Text style={fixedStyles.pickerCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={fixedStyles.pickerTitle}>Entry Time</Text>
                <TouchableOpacity onPress={confirmEntryTime}>
                  <Text style={fixedStyles.pickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempEntryTime}
                mode="time"
                display="spinner"
                onChange={(e, time) => time && setTempEntryTime(time)}
                style={fixedStyles.iosTimePicker}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      ) : (
        showEntryPicker && (
          <DateTimePicker
            value={tempEntryTime}
            mode="time"
            display="default"
            onChange={onEntryTimeChange}
          />
        )
      )}

      {/* Exit Time Picker */}
      {Platform.OS === 'ios' ? (
        <Modal
          visible={showExitPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowExitPicker(false)}
        >
          <TouchableOpacity
            style={fixedStyles.pickerOverlay}
            activeOpacity={1}
            onPress={() => setShowExitPicker(false)}
          >
            <View style={fixedStyles.pickerContainer}>
              <View style={fixedStyles.pickerHeader}>
                <TouchableOpacity onPress={() => setShowExitPicker(false)}>
                  <Text style={fixedStyles.pickerCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={fixedStyles.pickerTitle}>Exit Time</Text>
                <TouchableOpacity onPress={confirmExitTime}>
                  <Text style={fixedStyles.pickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempExitTime}
                mode="time"
                display="spinner"
                onChange={(e, time) => time && setTempExitTime(time)}
                style={fixedStyles.iosTimePicker}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      ) : (
        showExitPicker && (
          <DateTimePicker
            value={tempExitTime}
            mode="time"
            display="default"
            onChange={onExitTimeChange}
          />
        )
      )}

      {/* Date Picker */}
      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={onDateChange}
          maximumDate={new Date()}
        />
      )}
      </ScrollView>

      {/* Toast Notification */}
      {toastMessage !== '' && (
        <Animated.View
          style={[
            toastStyles.toast,
            { opacity: toastOpacity }
          ]}
        >
          <Text style={toastStyles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </View>
  );
}

// Toast notification styles
const toastStyles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: colors.error,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
  },
  toastText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
