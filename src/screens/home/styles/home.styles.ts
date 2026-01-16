/**
 * Home Styles - OnSite Timekeeper
 * 
 * v1.5 - Layout 50/25/25 com Timer Vertical
 * 
 * - Form Section (50%) - Log Hours inline
 * - Locations Section (25%) - Location cards compactos
 * - Timer Section (25%) - Timer vertical com botões embaixo
 */

import { StyleSheet, Platform, StatusBar } from 'react-native';
import { colors, withOpacity, shadows } from '../../../constants/colors';

export const homeStyles = StyleSheet.create({
  // Container
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 50,
    paddingBottom: 8,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLogo: {
    width: 90,
    height: 28,
  },

  // ============================================
  // LOG HOURS FORM - Subtly highlighted as primary action
  // ============================================
  formSection: {
    padding: 14,
    backgroundColor: colors.surface,  // One shade lighter/darker than cards
    borderRadius: 14,
    borderWidth: 2,  // Thicker border (was 1)
    borderColor: withOpacity(colors.border, 1.2),  // Slightly stronger border
    marginBottom: 8,
    ...shadows.md,  // More pronounced shadow (was shadows.sm)
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  formTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  reportsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: withOpacity(colors.primary, 0.1),
    borderRadius: 8,
  },
  reportsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Dropdown
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  dropdownSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  dropdownDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dropdownText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  dropdownPlaceholder: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  dropdownMenu: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    marginTop: -6,
    overflow: 'hidden',
    ...shadows.md,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownOptionActive: {
    backgroundColor: withOpacity(colors.primary, 0.08),
  },
  dropdownOptionText: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  dropdownOptionTextActive: {
    fontWeight: '600',
    color: colors.primary,
  },

  // ============================================
  // TIME INPUTS - Centered rows
  // ============================================
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  
  // Entry - normal size
  timeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 60,
  },
  timeInputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeInput: {
    width: 48,
    paddingVertical: 10,
    paddingHorizontal: 0,
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  timeSeparator: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
    marginHorizontal: 6,
  },

  // Exit & Break - LARGER
  timeLabelLg: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 60,
  },
  timeInputLg: {
    width: 50,
    paddingVertical: 10,
    paddingHorizontal: 0,
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  timeSeparatorLg: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginHorizontal: 6,
  },
  breakInputLg: {
    width: 56,
    paddingVertical: 10,
    paddingHorizontal: 0,
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  breakUnitLg: {
    fontSize: 15,
    color: colors.textSecondary,
    marginLeft: 8,
  },

  // Save button
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.buttonPrimaryText,
  },

  // ============================================
  // LOCATIONS - Auto height
  // ============================================
  locationsSection: {
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  addButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyLocations: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    minHeight: 80,
    paddingVertical: 20,
  },
  emptyLocationsText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  locationCardsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  locationCard: {
    width: 120,
    height: 80,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    justifyContent: 'center',
  },
  locationCardSelected: {
    backgroundColor: withOpacity(colors.warning, 0.15),
    borderColor: colors.warning,
    borderWidth: 2,
  },
  locationCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  locationCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  locationCardTotal: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  locationCardActive: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  addLocationCardInline: {
    width: 80,
    height: 80,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ============================================
  // TIMER - Flexible height to fill available space
  // ============================================
  timerSection: {
    flex: 1,
    minHeight: 180,
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    marginBottom: 8,
    ...shadows.sm,
  },
  timerSectionActive: {
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },

  // VERTICAL layout
  timerVertical: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerTopRow: {
    alignItems: 'center',
    marginBottom: 8,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successSoft,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginBottom: 4,
  },
  activeBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  timerDisplay: {
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: colors.text,
    marginBottom: 4,
  },
  timerPaused: {
    opacity: 0.4,
  },
  pausaInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  pausaTimer: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.textSecondary,
  },
  pausaTimerActive: {
    color: colors.accent,
  },

  // Buttons row - CENTERED BELOW timer
  timerActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  pauseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resumeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Idle state
  idleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginBottom: 4,
  },
  idleBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textSecondary,
  },
  idleBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  timerIdle: {
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: colors.textMuted,
    marginBottom: 4,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  startBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.buttonPrimaryText,
  },

  // Waiting state
  timerWaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  timerWaitingText: {
    fontSize: 13,
    color: colors.textMuted,
  },

  // ============================================
  // NEW: DATE PICKER STYLES
  // ============================================
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: withOpacity(colors.primary, 0.05),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.2),
    marginBottom: 10,
  },
  dateSelectorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateSelectorText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  dateDropdown: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    marginTop: -6,
    overflow: 'hidden',
    ...shadows.md,
  },
  dateOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dateOptionText: {
    fontSize: 14,
    color: colors.text,
  },

  // ============================================
  // NEW: TIME PICKER BUTTONS (replacing inputs)
  // ============================================
  timePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: withOpacity(colors.primary, 0.15),
    ...shadows.sm,
  },
  timePickerText: {
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.text,
    minWidth: 70,
  },
  timePickerButtonLg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: withOpacity(colors.primary, 0.15),
    ...shadows.sm,
  },
  timePickerTextLg: {
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.text,
    minWidth: 70,
  },

  // ============================================
  // NEW: TOTAL HOURS DISPLAY
  // ============================================
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: withOpacity(colors.success, 0.08),
    borderRadius: 10,
    borderWidth: 1,
    borderColor: withOpacity(colors.success, 0.2),
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  totalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.white,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    ...shadows.sm,
  },
  totalText: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: colors.primary,
  },

  // ============================================
  // NEW: TIME PICKER MODALS (iOS)
  // ============================================
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerContainer: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  pickerCancel: {
    fontSize: 17,
    color: colors.textSecondary,
  },
  pickerDone: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.primary,
  },
  iosTimePicker: {
    height: 200,
  },

  // ============================================
  // NEW: LOCATION CAROUSEL
  // ============================================
  locationCarousel: {
    marginBottom: 10,
  },
  locationCarouselScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  locationCarouselCard: {
    width: 100,
    height: 60,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    justifyContent: 'space-between',
    ...shadows.sm,
  },
  locationCarouselCardSelected: {
    backgroundColor: withOpacity(colors.warning, 0.15),
    borderColor: colors.warning,
    borderWidth: 2,
  },
  locationCarouselCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  locationCarouselCardHours: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  addLocationCard: {
    width: 80,
    height: 60,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ============================================
  // NEW: BREAK DROPDOWN
  // ============================================
  breakDropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 100,
    justifyContent: 'space-between',
  },
  breakDropdownText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  breakDropdownMenu: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    marginTop: -6,
    overflow: 'hidden',
    ...shadows.md,
  },
  breakOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  breakOptionLast: {
    borderBottomWidth: 0,
  },
  breakOptionText: {
    fontSize: 14,
    color: colors.text,
  },
  breakInput: {
    width: 56,
    paddingVertical: 10,
    paddingHorizontal: 0,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  breakUnit: {
    fontSize: 15,
    color: colors.textSecondary,
    marginLeft: 8,
  },

  // ============================================
  // NEW: SIMPLIFIED TOTAL
  // ============================================
  totalRowSimple: {
    alignItems: 'center',
    marginVertical: 8,
  },
  totalSimple: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  totalSimpleValue: {
    fontWeight: '600',
    color: colors.text,
    fontSize: 15,
  },
});

// Alias para compatibilidade
export const fixedStyles = homeStyles;
