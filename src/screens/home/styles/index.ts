/**
 * Styles Index - OnSite Timekeeper
 * 
 * Re-exporta todos os estilos para manter backward compatibility
 * 
 * Estrutura:
 * - shared.styles.ts  → Header, badges, modals genéricos, location cards
 * - home.styles.ts    → fixedStyles v1.5 (layout 50/25/25, timer vertical)
 * - reports.styles.ts → Calendário, week/month view, day modal, export
 * - legacy.styles.ts  → manualEntryStyles, compactStyles (deprecated)
 */

import { Dimensions, StyleSheet } from 'react-native';
import { sharedStyles } from './shared.styles';
import { reportsStyles } from './reports.styles';

// Re-export constante
const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const MONTH_DAY_SIZE = (SCREEN_WIDTH - 32 - 12) / 7;

// ============================================
// SHARED STYLES
// ============================================
export { sharedStyles, MONTH_DAY_SIZE as SHARED_MONTH_DAY_SIZE } from './shared.styles';

// ============================================
// HOME STYLES (v1.5)
// ============================================
export { homeStyles, fixedStyles } from './home.styles';

// ============================================
// REPORTS STYLES
// ============================================
export { reportsStyles, MONTH_DAY_SIZE as REPORTS_MONTH_DAY_SIZE } from './reports.styles';

// ============================================
// LEGACY STYLES (deprecated)
// ============================================
export { manualEntryStyles, compactStyles } from './legacy.styles';

// ============================================
// BACKWARD COMPATIBILITY
// ============================================
// Combina sharedStyles + reportsStyles para manter compatibilidade
// com código que usa: import { styles } from './styles'
export const styles = StyleSheet.create({
  ...sharedStyles,
  ...reportsStyles,
} as any);
