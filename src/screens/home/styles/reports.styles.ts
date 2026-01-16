/**
 * Reports Styles - OnSite Timekeeper
 * 
 * Estilos específicos para a tela Reports
 * - Calendar Card
 * - Week/Month Views
 * - Day Modal
 * - Export Buttons
 * - Batch Actions
 */

import { StyleSheet, Dimensions, Platform } from 'react-native';
import { colors, withOpacity, shadows } from '../../../constants/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const MONTH_DAY_SIZE = (SCREEN_WIDTH - 32 - 12) / 7;

export const reportsStyles = StyleSheet.create({
  // ============================================
  // CALENDAR CARD
  // ============================================
  calendarCard: { 
    padding: 16, 
    marginBottom: 0,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  calendarHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
  },
  calendarCenter: { alignItems: 'center', flex: 1 },
  navBtn: { 
    width: 36, 
    height: 36, 
    borderRadius: 18, 
    backgroundColor: colors.surfaceMuted, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  navBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: 'bold' },
  calendarTitle: { 
    fontSize: 13, 
    fontWeight: '500', 
    color: colors.textSecondary, 
    textAlign: 'center',
  },
  calendarTotal: { 
    fontSize: 24, 
    fontWeight: '700', 
    color: colors.text, 
    textAlign: 'center',
  },

  // View toggle (Week/Month)
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
    backgroundColor: colors.surfaceMuted,
  },
  viewToggleBtnActive: {
    backgroundColor: colors.accent,
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  viewToggleTextActive: {
    color: colors.white,
  },

  // ============================================
  // SELECTION BAR
  // ============================================
  selectionBar: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: colors.accent, 
    paddingVertical: 8, 
    paddingHorizontal: 16, 
    borderRadius: 8, 
    marginBottom: 12,
  },
  selectionText: { color: colors.white, fontSize: 14, fontWeight: '500' },
  selectionCancel: { color: colors.white, fontSize: 14, fontWeight: '600' },

  // ============================================
  // WEEK VIEW - DAY ROW
  // ============================================
  dayRow: { 
    flexDirection: 'row', 
    backgroundColor: colors.card, 
    borderRadius: 12, 
    padding: 12, 
    marginBottom: 8, 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  dayRowToday: { 
    borderWidth: 2, 
    borderColor: colors.primary,
  },
  dayRowSelected: { 
    backgroundColor: withOpacity(colors.primary, 0.08), 
    borderWidth: 2, 
    borderColor: colors.primary,
  },
  dayRowWeekend: {
    backgroundColor: withOpacity(colors.textMuted, 0.08),
  },
  dayRowFuture: {
    opacity: 0.5,
  },
  
  checkbox: { 
    width: 24, 
    height: 24, 
    borderRadius: 6, 
    borderWidth: 2, 
    borderColor: colors.border, 
    marginRight: 10, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
  checkboxSelected: { 
    backgroundColor: colors.accent, 
    borderColor: colors.accent,
  },
  checkmark: { color: colors.white, fontSize: 14, fontWeight: 'bold' },
  
  dayLeft: { width: 44, alignItems: 'center', marginRight: 12 },
  dayName: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  dayNameToday: { color: colors.accent },
  dayCircle: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 2,
  },
  dayCircleToday: { 
    backgroundColor: colors.primary,
  },
  dayNumber: { fontSize: 14, fontWeight: '600', color: colors.text },
  dayNumberToday: { color: colors.buttonPrimaryText },
  
  dayRight: { flex: 1 },
  dayEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayEmptyText: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  dayPreview: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  dayPreviewDuration: { fontSize: 15, fontWeight: '600', color: colors.text },
  expandIcon: { fontSize: 12, color: colors.textSecondary, marginLeft: 8 },

  // ============================================
  // MONTH VIEW
  // ============================================
  monthContainer: {
    marginBottom: 8,
    marginTop: 16,
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
    gap: 4,
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
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  monthDayToday: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  monthDaySelected: {
    backgroundColor: colors.accent,
  },
  monthDayHasData: {
    backgroundColor: withOpacity(colors.primary, 0.15),
  },
  monthDayNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  monthDayNumberToday: {
    color: colors.accent,
    fontWeight: 'bold',
  },
  monthDayNumberSelected: {
    color: colors.white,
    fontWeight: 'bold',
  },
  monthDayIndicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginTop: 2,
  },
  monthDayWeekend: {
    backgroundColor: withOpacity(colors.textMuted, 0.15),
  },
  monthDayFuture: {
    opacity: 0.4,
  },
  monthDayNumberFuture: {
    color: colors.textMuted,
  },
  monthDayTagIndicator: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  monthExpandedReport: {
    marginTop: 12,
  },

  // ============================================
  // EXPORT BUTTONS
  // ============================================
  exportBtn: { 
    backgroundColor: colors.primary, 
    paddingVertical: 14, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  exportBtnText: { color: colors.buttonPrimaryText, fontSize: 15, fontWeight: '600' },
  exportBtnSecondary: { 
    backgroundColor: colors.card, 
    paddingVertical: 14, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginTop: 16, 
    borderWidth: 1, 
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  exportBtnSecondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },

  // ============================================
  // DAY DETAIL MODAL
  // ============================================
  dayModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dayModalContainer: {
    flex: 1,
    width: '100%',
    maxHeight: '95%',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 20,
    overflow: 'hidden',
    ...shadows.lg,
  },
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dayModalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  dayModalHeaderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  dayModalHeaderBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayModalHeaderBtnText: {
    fontSize: 18,
  },
  dayModalCloseHeaderBtn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dayModalCloseHeaderBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.white,
  },
  
  dayModalSelectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    color: colors.accent,
  },

  dayModalSessionsList: {
    flex: 1,
  },
  dayModalSessionsContent: {
    padding: 16,
    paddingBottom: 20,
  },
  dayModalSessions: {
    maxHeight: 350,
  },
  dayModalEmpty: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  dayModalEmptyIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.3,
  },
  dayModalEmptyText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  dayModalAddBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 25,
  },
  dayModalAddBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.buttonPrimaryText,
  },

  dayModalSession: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayModalSessionSelected: {
    backgroundColor: withOpacity(colors.primary, 0.1),
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dayModalCheckbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: 14,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayModalCheckboxSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dayModalCheckmark: {
    color: colors.white,
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
    marginBottom: 6,
  },
  dayModalSessionLocation: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  dayModalSessionDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dayModalSessionTime: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  dayModalSessionTimeEdited: {
    color: colors.warning,
  },
  dayModalSessionPause: {
    fontSize: 13,
    color: colors.textTertiary,
    marginBottom: 4,
  },
  dayModalSessionTotal: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 6,
  },

  dayModalTotalBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dayModalTotalLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  dayModalTotalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },

  dayModalFooter: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  dayModalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
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
    color: colors.buttonPrimaryText,
  },
  
  dayModalCloseBtn: {
    paddingVertical: 16,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dayModalCloseBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // ============================================
  // BATCH ACTION BAR
  // ============================================
  batchActionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  batchActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  batchActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batchActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  batchActionBtnText: {
    fontSize: 18,
  },
  batchActionBtnCancel: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  batchActionCancelText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.white,
  },
});
