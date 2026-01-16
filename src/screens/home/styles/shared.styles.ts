/**
 * Shared Styles - OnSite Timekeeper
 * 
 * Estilos compartilhados entre Home e Reports
 * - Container, Header, Tooltip
 * - Timer Card (versão original)
 * - Location Cards (versão original)
 * - Modals genéricos
 * - Tag Modal
 */

import { StyleSheet, Dimensions, Platform, StatusBar } from 'react-native';
import { colors, withOpacity, shadows } from '../../../constants/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const MONTH_DAY_SIZE = (SCREEN_WIDTH - 32 - 12) / 7;

export const sharedStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { 
    padding: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 16 : 60,
  },

  // ============================================
  // HEADER
  // ============================================
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 20,
  },
  headerLogoContainer: {
    padding: 4,
  },
  headerLogo: { 
    width: 110, 
    height: 36,
  },
  headerUserContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerUserName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    maxWidth: 120,
  },
  headerUserAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  
  // Logo Tooltip
  tooltipOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: Platform.OS === 'ios' ? 100 : 80,
    paddingHorizontal: 20,
  },
  tooltipContainer: {
    alignSelf: 'flex-start',
  },
  tooltipArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.card,
    marginLeft: 20,
    ...shadows.md,
  },
  tooltipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    ...shadows.md,
  },
  tooltipText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
  tooltipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  tooltipButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.buttonPrimaryText,
  },

  greeting: { 
    fontSize: 14, 
    fontWeight: '500', 
    color: colors.textSecondary,
  },

  // ============================================
  // TIMER CARD (Active Session)
  // ============================================
  timerCard: { 
    padding: 24, 
    marginBottom: 16, 
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    ...shadows.md,
  },
  timerCardActive: { 
    backgroundColor: colors.card, 
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.cardAccent,
  },
  timerCardIdle: { 
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  
  // Active badge (green)
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.successSoft,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginBottom: 16,
  },
  activeBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.success,
    letterSpacing: 0.4,
  },
  
  // Idle badge (gray)
  idleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginBottom: 16,
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
    letterSpacing: 0.4,
  },
  
  // Location badge
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 8,
  },
  locationBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  
  // Timer display
  timerLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  timer: { 
    fontSize: 40, 
    fontWeight: '700', 
    fontVariant: ['tabular-nums'], 
    color: colors.text, 
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  timerPaused: { opacity: 0.4 },
  timerHint: { 
    fontSize: 14, 
    color: colors.textSecondary, 
    marginBottom: 8,
  },
  
  // Geofence status
  geofenceStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  geofenceStatusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.success,
  },
  
  // Timer actions
  timerActions: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    gap: 12,
    marginTop: 8,
  },
  actionBtn: { 
    paddingVertical: 12, 
    paddingHorizontal: 24, 
    borderRadius: 12, 
    minWidth: 110, 
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  
  pauseBtn: { 
    backgroundColor: colors.surfaceMuted, 
    borderWidth: 1, 
    borderColor: colors.border,
  },
  pauseBtnText: { color: colors.text },
  continueBtn: { backgroundColor: colors.primary },
  continueBtnText: { color: colors.buttonPrimaryText },
  stopBtn: { backgroundColor: colors.textSecondary },
  stopBtnText: { color: colors.white },
  startBtn: { backgroundColor: colors.primary },
  startBtnText: { color: colors.buttonPrimaryText },

  // Break/Pause display
  pausaContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: colors.surfaceMuted, 
    paddingVertical: 8, 
    paddingHorizontal: 16, 
    borderRadius: 20, 
    marginBottom: 16, 
    gap: 8,
  },
  pausaLabel: { fontSize: 13, color: colors.textSecondary },
  pausaTimer: { 
    fontSize: 16, 
    fontWeight: '600', 
    fontVariant: ['tabular-nums'], 
    color: colors.textSecondary,
  },
  pausaTimerActive: { color: colors.accent },

  // ============================================
  // SECTION DIVIDER
  // ============================================
  sectionDivider: { 
    height: 1, 
    backgroundColor: colors.border, 
    marginVertical: 16, 
    marginHorizontal: 0,
  },

  // ============================================
  // LOCATION CARDS
  // ============================================
  locationCardsSection: {
    marginBottom: 16,
  },
  locationCardsScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  locationCardsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  
  locationCardFull: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    ...shadows.sm,
  },
  locationCardHalf: {
    flex: 1,
    minWidth: 150,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    ...shadows.sm,
  },
  locationCardScrollable: {
    width: 160,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    ...shadows.sm,
  },
  
  locationCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  locationCardHeaderInfo: {
    flex: 1,
  },
  locationCardHeaderCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  locationCardIconContainer: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  locationCardIconGlow: {
    position: 'absolute',
    bottom: 0,
    width: 20,
    height: 6,
    borderRadius: 10,
    backgroundColor: colors.primary,
    opacity: 0.35,
  },
  locationCardName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  locationCardNameCompact: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  locationCardCoords: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 1,
  },
  locationCardTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  locationCardTimeLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  locationCardTimeValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  locationCardTimeActive: {
    color: colors.success,
  },
  locationCardStatsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  locationCardTotal: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  locationCardTotalCompact: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  locationCardSubtext: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
  },

  // ============================================
  // MODAL (Manual Entry)
  // ============================================
  modalOverlay: { 
    flex: 1, 
    backgroundColor: colors.overlay, 
    justifyContent: 'flex-end',
  },
  modalContent: { 
    backgroundColor: colors.backgroundSecondary, 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
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
    backgroundColor: colors.surfaceMuted, 
    borderWidth: 1, 
    borderColor: colors.border,
  },
  localOptionActive: { 
    backgroundColor: colors.primary, 
    borderColor: colors.primary,
  },
  localDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  localOptionText: { fontSize: 13, color: colors.text },
  localOptionTextActive: { color: colors.buttonPrimaryText, fontWeight: '500' },

  timeRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  timeField: { flex: 1 },
  timeInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  timeInputSmall: { 
    borderWidth: 1, 
    borderColor: colors.border, 
    borderRadius: 10, 
    paddingHorizontal: 12, 
    paddingVertical: 12, 
    fontSize: 24, 
    textAlign: 'center', 
    fontWeight: '600', 
    backgroundColor: colors.surfaceMuted, 
    color: colors.text,
    width: 56,
  },
  timeSeparator: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginHorizontal: 4,
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
    backgroundColor: colors.surfaceMuted, 
    color: colors.text,
  },
  pausaRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8, 
    marginBottom: 8,
  },
  pausaInput: { 
    borderWidth: 1, 
    borderColor: colors.border, 
    borderRadius: 10, 
    paddingHorizontal: 12, 
    paddingVertical: 10, 
    fontSize: 20, 
    textAlign: 'center', 
    fontWeight: '600', 
    width: 70, 
    backgroundColor: colors.surfaceMuted, 
    color: colors.text,
  },
  pausaHint: { fontSize: 16, color: colors.textSecondary },
  inputHint: { 
    fontSize: 12, 
    color: colors.textSecondary, 
    textAlign: 'center', 
    marginBottom: 16,
  },
  
  // Entry mode toggle
  entryModeToggle: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  entryModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  entryModeBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  entryModeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  entryModeBtnTextActive: {
    color: colors.buttonPrimaryText,
  },
  
  // Absence options
  absenceOptions: {
    gap: 8,
    marginBottom: 16,
  },
  absenceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    gap: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  absenceOptionActive: {
    backgroundColor: withOpacity(colors.primary, 0.1),
    borderColor: colors.primary,
  },
  absenceOptionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  absenceOptionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  absenceOptionTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
  
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { 
    flex: 1, 
    paddingVertical: 14, 
    borderRadius: 12, 
    backgroundColor: colors.surfaceMuted, 
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { 
    flex: 1, 
    paddingVertical: 14, 
    borderRadius: 12, 
    backgroundColor: colors.primary, 
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, color: colors.buttonPrimaryText, fontWeight: '600' },

  // ============================================
  // TAG MODAL
  // ============================================
  tagModalContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  tagModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  tagModalSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  tagOptionsList: {
    gap: 8,
    marginBottom: 16,
  },
  tagOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    gap: 12,
  },
  tagOptionActive: {
    backgroundColor: withOpacity(colors.primary, 0.15),
    borderWidth: 2,
    borderColor: colors.primary,
  },
  tagOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
  tagOptionCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    gap: 8,
    marginBottom: 12,
  },
  tagClearBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  tagCloseBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  tagCloseBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.buttonPrimaryText,
  },
  
  dayTagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  dayTagBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
});
