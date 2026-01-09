/**
 * Home Screen Styles - OnSite Timekeeper
 * 
 * UPDATED: Added Day Detail Modal styles
 */

import { StyleSheet, Dimensions, Platform, StatusBar } from 'react-native';
import { colors, withOpacity } from '../../constants/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const MONTH_DAY_SIZE = (SCREEN_WIDTH - 32 - 12) / 7;

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { 
    padding: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 16 : 60,
  },

  // HEADER
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  headerLogoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLogoEmoji: {
    fontSize: 24,
  },
  headerLogoText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.primary,
  },
  headerLogo: { 
    width: 100, 
    height: 32 
  },
  greeting: { fontSize: 16, fontWeight: '500', color: colors.textSecondary },

  // TIMER
  timerCard: { 
    padding: 20, 
    marginBottom: 0, 
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 16,
  },
  timerCardActive: { 
    backgroundColor: '#0D0D0D', 
    borderColor: '#3A3A3A',
  },
  timerCardIdle: { 
    backgroundColor: '#0D0D0D',
    borderColor: '#2A2A2A',
  },
  
  locationBadge: {
    backgroundColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 12,
  },
  locationBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.buttonPrimaryText,
  },
  
  timerHint: { fontSize: 14, color: colors.textSecondary, marginBottom: 8 },
  timer: { fontSize: 48, fontWeight: 'bold', fontVariant: ['tabular-nums'], color: colors.text, marginBottom: 8 },
  timerPaused: { opacity: 0.5 },
  timerActions: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  actionBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24, minWidth: 120, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  // Pause: dark background, light text
  pauseBtn: { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#3A3A3A' },
  pauseBtnText: { color: colors.text },
  // Resume: yellow/amber
  continueBtn: { backgroundColor: colors.primary },
  continueBtnText: { color: colors.buttonPrimaryText },
  // Stop: red
  stopBtn: { backgroundColor: colors.error },
  stopBtnText: { color: colors.white },
  // Start: yellow/amber
  startBtn: { backgroundColor: colors.primary },
  startBtnText: { color: colors.buttonPrimaryText },

  pausaContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1A1A', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginBottom: 16, gap: 8 },
  pausaLabel: { fontSize: 14, color: colors.textSecondary },
  pausaTimer: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'], color: colors.textSecondary },
  pausaTimerActive: { color: colors.primary },

  sectionDivider: { height: 1, backgroundColor: colors.border, marginVertical: 16, marginHorizontal: 20, opacity: 0.5 },

  // CALENDAR CARD
  calendarCard: { padding: 16, marginBottom: 0 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarCenter: { alignItems: 'center', flex: 1 },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  navBtnText: { color: colors.black, fontSize: 14, fontWeight: 'bold' },
  calendarTitle: { fontSize: 14, fontWeight: '500', color: colors.textSecondary, textAlign: 'center' },
  calendarTotal: { fontSize: 22, fontWeight: 'bold', color: colors.primary, textAlign: 'center' },

  // VIEW TOGGLE
  viewToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
  },
  viewToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: colors.backgroundTertiary,
  },
  viewToggleBtnActive: {
    backgroundColor: colors.primary,
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  viewToggleTextActive: {
    color: colors.black,
  },

  // SELECTION
  selectionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, marginBottom: 12 },
  selectionText: { color: colors.black, fontSize: 14, fontWeight: '500' },
  selectionCancel: { color: colors.black, fontSize: 14, fontWeight: '600' },

  // WEEK VIEW - DAY ROW
  dayRow: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 10, marginBottom: 6, alignItems: 'center' },
  dayRowToday: { borderWidth: 2, borderColor: colors.primary },
  dayRowSelected: { backgroundColor: withOpacity(colors.primary, 0.1), borderWidth: 2, borderColor: colors.primary },
  
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 10, justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.black, fontSize: 14, fontWeight: 'bold' },
  
  dayLeft: { width: 44, alignItems: 'center', marginRight: 10 },
  dayName: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  dayNameToday: { color: colors.primary },
  dayCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  dayCircleToday: { borderColor: colors.primary, backgroundColor: colors.primary },
  dayNumber: { fontSize: 14, fontWeight: 'bold', color: colors.text },
  dayNumberToday: { color: colors.black },
  dayRight: { flex: 1 },
  dayEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayEmptyText: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
  addBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  addBtnText: { color: colors.black, fontSize: 18, fontWeight: 'bold', marginTop: -2 },
  dayPreview: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  dayPreviewDuration: { fontSize: 14, fontWeight: '600', color: colors.primary },
  expandIcon: { fontSize: 10, color: colors.textSecondary, marginLeft: 8 },

  // MONTH VIEW
  monthContainer: {
    marginBottom: 8,
  },
  monthWeekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  monthWeekHeaderText: {
    width: MONTH_DAY_SIZE,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  monthDayEmpty: {
    width: MONTH_DAY_SIZE,
    height: MONTH_DAY_SIZE,
  },
  monthDay: {
    width: MONTH_DAY_SIZE,
    height: MONTH_DAY_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  monthDayToday: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  monthDaySelected: {
    backgroundColor: colors.primary,
  },
  monthDayHasData: {
    backgroundColor: withOpacity(colors.primary, 0.2),
  },
  monthDayNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  monthDayNumberToday: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  monthDayNumberSelected: {
    color: colors.black,
    fontWeight: 'bold',
  },
  monthDayIndicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 2,
  },
  monthExpandedReport: {
    marginTop: 12,
  },

  // EXPORT
  exportBtn: { backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  exportBtnText: { color: colors.black, fontSize: 15, fontWeight: '600' },
  exportBtnSecondary: { backgroundColor: colors.backgroundSecondary, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: colors.primary },
  exportBtnSecondaryText: { color: colors.primary, fontSize: 15, fontWeight: '600' },

  // ============================================
  // DAY DETAIL MODAL (NEW!)
  // ============================================
  dayModalContent: {
    backgroundColor: colors.backgroundSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '85%',
  },
  dayModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  dayModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  dayModalHeaderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  dayModalHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayModalHeaderBtnText: {
    fontSize: 16,
  },
  
  // Selection bar inside modal
  dayModalSelectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.backgroundTertiary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  dayModalSelectionText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  dayModalSelectionActions: {
    flexDirection: 'row',
    gap: 16,
  },
  dayModalSelectionBtn: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },

  // Sessions list
  dayModalSessions: {
    maxHeight: 350,
  },
  dayModalEmpty: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  dayModalEmptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  dayModalAddBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  dayModalAddBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.black,
  },

  // Session item
  dayModalSession: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: 8,
  },
  dayModalSessionSelected: {
    backgroundColor: withOpacity(colors.primary, 0.15),
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dayModalCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: 12,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayModalCheckboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayModalCheckmark: {
    color: colors.black,
    fontSize: 14,
    fontWeight: 'bold',
  },
  dayModalSessionInfo: {
    flex: 1,
  },
  dayModalSessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dayModalSessionLocation: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  dayModalSessionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dayModalSessionTime: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  dayModalSessionTimeEdited: {
    color: colors.warning,
  },
  dayModalSessionPause: {
    fontSize: 12,
    color: colors.textTertiary,
    marginBottom: 2,
  },
  dayModalSessionTotal: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 4,
  },

  // Total bar
  dayModalTotalBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dayModalTotalLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  dayModalTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.primary,
  },

  // Footer
  dayModalFooter: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  dayModalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.backgroundTertiary,
    alignItems: 'center',
  },
  dayModalCancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayModalExportBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  dayModalExportBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.black,
  },

  // ============================================
  // MODAL (Manual Entry) - unchanged
  // ============================================
  modalOverlay: { flex: 1, backgroundColor: withOpacity(colors.black, 0.7), justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.backgroundSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text, textAlign: 'center' },
  modalSubtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 6 },
  localPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  localOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: colors.backgroundTertiary, borderWidth: 1, borderColor: colors.border },
  localOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  localDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  localOptionText: { fontSize: 13, color: colors.text },
  localOptionTextActive: { color: colors.black, fontWeight: '500' },

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
    backgroundColor: colors.backgroundTertiary, 
    color: colors.text,
    width: 56,
  },
  timeSeparator: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginHorizontal: 4,
  },
  timeInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 18, textAlign: 'center', fontWeight: '600', backgroundColor: colors.backgroundTertiary, color: colors.text },
  pausaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  pausaInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 20, textAlign: 'center', fontWeight: '600', width: 70, backgroundColor: colors.backgroundTertiary, color: colors.text },
  pausaHint: { fontSize: 16, color: colors.textSecondary },
  inputHint: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: colors.backgroundTertiary, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  saveBtnText: { fontSize: 15, color: colors.black, fontWeight: '600' },

  // ============================================
  // DEPRECATED: Session Finished Modal - REMOVED
  // ============================================
  // (styles kept for reference but no longer used)
});
