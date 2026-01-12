/**
 * Map Screen Styles - OnSite Timekeeper
 */

import { StyleSheet, Dimensions, Platform } from 'react-native';
import { colors, withOpacity } from '../../constants/colors';

const { width } = Dimensions.get('window');

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  map: {
    flex: 1,
  },

  // ============================================
  // MARKERS
  // ============================================
  marker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.white,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  tempMarker: {
    backgroundColor: colors.primary,
  },
  markerText: {
    fontSize: 16,
  },

  // ============================================
  // SEARCH - WHITE BACKGROUND
  // ============================================
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1A1A1A',
    paddingVertical: 0,
  },
  searchResults: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 8,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  searchResultIcon: {
    marginRight: 10,
  },
  searchResultText: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A1A',
  },

  // ============================================
  // BUTTONS
  // ============================================
  myLocationButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 110,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  monitorButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 110,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  monitorButtonActive: {
    backgroundColor: colors.success,
  },
  monitorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
    marginRight: 6,
  },
  monitorDotActive: {
    backgroundColor: colors.white,
  },
  monitorText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  monitorTextActive: {
    color: colors.white,
  },

  // ============================================
  // LOCATION LABELS (on map)
  // ============================================
  locationLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
    maxWidth: 140,
  },
  locationLabelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  locationLabelText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },

  // ============================================
  // HINT
  // ============================================
  hintContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(colors.black, 0.7),
    padding: 16,
    borderRadius: 12,
  },
  hintText: {
    color: colors.white,
    fontSize: 14,
    textAlign: 'center',
  },

  // ============================================
  // MODAL OVERLAY
  // ============================================
  modalOverlay: {
    flex: 1,
    backgroundColor: withOpacity(colors.black, 0.5),
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ============================================
  // LOCATION OPTIONS MODAL
  // ============================================
  optionsModal: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    width: width - 48,
    maxWidth: 360,
  },
  optionsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionsModalIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionsModalHeaderInfo: {
    flex: 1,
  },
  optionsModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  optionsModalSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  optionsModalDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 16,
  },
  optionsSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  radiusOptionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  radiusChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  radiusChipActive: {
    backgroundColor: withOpacity(colors.primary, 0.15),
    borderColor: colors.primary,
  },
  radiusChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  radiusChipTextActive: {
    color: colors.primary,
  },
  optionsActionsList: {
    gap: 2,
  },
  optionsActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 12,
  },
  optionsActionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  optionsActionHint: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  colorPreview: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  optionsDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: withOpacity(colors.error, 0.1),
    borderRadius: 12,
  },
  optionsDeleteText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.error,
  },

  // ============================================
  // NAME MODAL
  // ============================================
  nameModal: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    width: width - 48,
    maxWidth: 340,
  },
  nameModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 4,
  },
  nameModalIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: withOpacity(colors.primary, 0.15),
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  nameModalSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.backgroundTertiary,
  },
  nameInputError: {
    borderColor: colors.error,
    borderWidth: 2,
  },
  nameInputErrorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 6,
    textAlign: 'center',
  },
  radiusSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 10,
    textAlign: 'center',
  },
  radiusOptionsInline: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  radiusOptionSmall: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
    minWidth: 55,
    alignItems: 'center',
  },
  radiusOptionSmallActive: {
    backgroundColor: colors.primary,
  },
  radiusOptionSmallText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  radiusOptionSmallTextActive: {
    color: colors.buttonPrimaryText,
  },
  nameModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  nameModalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
  },
  nameModalCancelText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  nameModalConfirm: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  nameModalConfirmDisabled: {
    opacity: 0.6,
  },
  nameModalConfirmText: {
    fontSize: 15,
    color: colors.buttonPrimaryText,
    fontWeight: '600',
  },
});
