/**
 * Report Generator - OnSite Timekeeper
 * 
 * Unified report format for all exports
 * Format matches WhatsApp-friendly display:
 * 
 * Cristony Bruno
 * ────────────────────
 * 📅  04 - jan- 26
 * 📍 Jobsite Avalon
 * *GPS    》12:00 PM → 2:00 PM
 * ▸ 1h 45min
 * 
 * 📍 Jobsite Norte
 * *Edited 》2:30 PM → 5:00 PM 
 * Break: 15min
 * ▸ 2h 15min
 * ════════════════════
 * TOTAL: 4h 00min
 * OnSite Timekeeper 
 * Ref #   49A2 - 1856
 * 
 * REFACTORED: All PT names converted to EN
 */

import { ComputedSession, formatDuration } from './database';

// ============================================
// CONSTANTS
// ============================================

const APP_NAME = 'OnSite Timekeeper';
const SEPARATOR_SINGLE = '────────────────────';
const SEPARATOR_DOUBLE = '════════════════════';

// ============================================
// HELPERS
// ============================================

/**
 * Format date: "04 - jan- 26"
 */
function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    const year = date.getFullYear().toString().slice(-2);
    return `${day} - ${month}- ${year}`;
  } catch {
    return isoDate;
  }
}

/**
 * Format time: "12:00 PM"
 */
function formatTimeAMPM(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  } catch {
    return '--:--';
  }
}

/**
 * Generate verification code: "49A2 - 1856"
 * Creates a unique hash based on session data
 */
function generateRefCode(sessions: ComputedSession[], timestamp: string): string {
  // Create hash from session data
  const data = sessions.map(s => `${s.id}|${s.entry_at}|${s.duration_minutes}`).join(';');
  const base = `${timestamp}|${data}`;
  
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    const char = base.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  const hexHash = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
  const part1 = hexHash.substring(0, 4);
  const part2 = timestamp.replace(/\D/g, '').slice(-4);
  
  return `${part1} - ${part2}`;
}

// ============================================
// MAIN REPORT GENERATOR
// ============================================

/**
 * Generate report in the unified WhatsApp-friendly format
 * Used by both single session and multi-day exports
 */
export function generateReport(
  sessions: ComputedSession[],
  userName?: string
): string {
  if (!sessions || sessions.length === 0) {
    return 'No sessions found.';
  }

  const timestamp = new Date().toISOString();
  const refCode = generateRefCode(sessions, timestamp);
  
  const lines: string[] = [];

  // ════════════════════════════════════════════
  // HEADER - User name
  // ════════════════════════════════════════════
  lines.push(userName || 'Time Report');
  lines.push(SEPARATOR_SINGLE);

  // ════════════════════════════════════════════
  // GROUP SESSIONS BY DATE
  // ════════════════════════════════════════════
  const byDate = new Map<string, ComputedSession[]>();
  sessions.forEach(s => {
    const dateKey = s.entry_at.split('T')[0];
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey)!.push(s);
  });

  // Sort dates chronologically
  const sortedDates = Array.from(byDate.keys()).sort();

  let totalMinutes = 0;

  // ════════════════════════════════════════════
  // EACH DAY
  // ════════════════════════════════════════════
  for (const dateKey of sortedDates) {
    const daySessions = byDate.get(dateKey)!;

    // 📅 Date header
    lines.push(`📅  ${formatDate(dateKey)}`);

    // Track previous location to add blank line between different locations
    let previousLocationName: string | null = null;

    // Each session in the day
    for (const session of daySessions) {
      const pauseMin = session.pause_minutes || 0;
      const netDuration = Math.max(0, session.duration_minutes - pauseMin);
      const isEdited = session.manually_edited === 1 || session.type === 'manual';
      
      const entryTime = formatTimeAMPM(session.entry_at);
      const exitTime = session.exit_at ? formatTimeAMPM(session.exit_at) : '--:--';

      const currentLocationName = session.location_name || 'Unknown';

      // Add blank line between different locations
      if (previousLocationName !== null && previousLocationName !== currentLocationName) {
        lines.push('');
      }

      // 📍 Location
      lines.push(`📍 ${currentLocationName}`);

      // Time line - GPS or Edited
      if (isEdited) {
        lines.push(`*Edited 》${entryTime} → ${exitTime}`);
      } else {
        lines.push(`*GPS    》${entryTime} → ${exitTime}`);
      }

      // Break (if any)
      if (pauseMin > 0) {
        lines.push(`Break: ${pauseMin}min`);
      }

      // Duration subtotal for this session
      lines.push(`▸ ${formatDuration(netDuration)}`);

      totalMinutes += netDuration;
      previousLocationName = currentLocationName;
    }
  }

  // ════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════
  lines.push(SEPARATOR_DOUBLE);
  lines.push(`TOTAL: ${formatDuration(totalMinutes)}`);
  lines.push('');
  lines.push(APP_NAME);
  lines.push(`Ref #   ${refCode}`);

  return lines.join('\n');
}

// ============================================
// SINGLE SESSION REPORT
// ============================================

/**
 * Generate single session report
 * Called after clock out via "Share" button
 */
export function generateSessionReport(
  session: ComputedSession,
  userName?: string
): string {
  return generateReport([session], userName);
}

// ============================================
// COMPLETE REPORT
// ============================================

/**
 * Generate complete report for period
 * Called from weekly export and share report
 */
export function generateCompleteReport(
  sessions: ComputedSession[],
  userName?: string
): string {
  return generateReport(sessions, userName);
}

// ============================================
// SUMMARY
// ============================================

/**
 * Generate quick summary (for preview in UI)
 */
export function generateSummary(sessions: ComputedSession[]): string {
  if (!sessions || sessions.length === 0) {
    return 'No sessions selected.';
  }

  const totalMinutes = sessions.reduce((acc, s) => {
    const pause = s.pause_minutes || 0;
    return acc + Math.max(0, s.duration_minutes - pause);
  }, 0);

  return `${sessions.length} session(s) • ${formatDuration(totalMinutes)}`;
}

// ============================================
// METADATA (for programmatic use)
// ============================================

export interface ReportMetadata {
  generatedAt: string;
  refCode: string;
  totalSessions: number;
  totalMinutes: number;
}

export function getReportMetadata(
  sessions: ComputedSession[],
): ReportMetadata {
  const timestamp = new Date().toISOString();
  const refCode = generateRefCode(sessions, timestamp);
  
  const totalMinutes = sessions.reduce((acc, s) => {
    const pause = s.pause_minutes || 0;
    return acc + Math.max(0, s.duration_minutes - pause);
  }, 0);

  return {
    generatedAt: timestamp,
    refCode,
    totalSessions: sessions.length,
    totalMinutes,
  };
}

// ============================================
// GROUPING HELPERS
// ============================================

export interface GroupedReport {
  locationName: string;
  sessions: {
    date: string;
    entry: string;
    exit: string;
    duration: number;
    pauseMinutes: number;
    netDuration: number;
    edited: boolean;
  }[];
  subtotalGross: number;
  subtotalPause: number;
  subtotalNet: number;
}

export function groupSessionsByLocation(sessions: ComputedSession[]): GroupedReport[] {
  const groups: Record<string, GroupedReport> = {};

  for (const session of sessions) {
    const locationName = session.location_name || 'Unknown';

    if (!groups[locationName]) {
      groups[locationName] = {
        locationName,
        sessions: [],
        subtotalGross: 0,
        subtotalPause: 0,
        subtotalNet: 0,
      };
    }

    const pauseMinutes = session.pause_minutes || 0;
    const netDuration = Math.max(0, session.duration_minutes - pauseMinutes);

    groups[locationName].sessions.push({
      date: session.entry_at.split('T')[0],
      entry: formatTimeAMPM(session.entry_at),
      exit: session.exit_at ? formatTimeAMPM(session.exit_at) : 'In progress',
      duration: session.duration_minutes,
      pauseMinutes,
      netDuration,
      edited: session.manually_edited === 1,
    });

    groups[locationName].subtotalGross += session.duration_minutes;
    groups[locationName].subtotalPause += pauseMinutes;
    groups[locationName].subtotalNet += netDuration;
  }

  return Object.values(groups).sort((a, b) => b.subtotalNet - a.subtotalNet);
}

// ============================================
// DEPRECATED ALIASES (backward compatibility)
// Remove after all consumers updated
// ============================================

/** @deprecated Use generateSessionReport instead */
export const gerarRelatorioSessao = generateSessionReport;

/** @deprecated Use generateCompleteReport instead */
export const gerarRelatorioCompleto = generateCompleteReport;

/** @deprecated Use generateSummary instead */
export const gerarResumo = generateSummary;

/** @deprecated Use ReportMetadata instead */
export type RelatorioMetadata = ReportMetadata;

/** @deprecated Use getReportMetadata instead */
export const getRelatorioMetadata = getReportMetadata;

/** @deprecated Use GroupedReport instead */
export type RelatorioAgrupado = GroupedReport;

/** @deprecated Use groupSessionsByLocation instead */
export const agruparSessoesPorLocal = groupSessionsByLocation;
