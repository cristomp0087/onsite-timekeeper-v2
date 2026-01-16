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
 * Ref #   QC-A3F8-0106-03
 * 
 * REF # FORMAT: RG-USER-MMDD-SS
 *   RG   = Region code from GPS (QC, ON, BC, etc)
 *   USER = Last 4 chars of user_id (for support lookup)
 *   MMDD = Export date (month/day)
 *   SS   = Session count
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
 * Generate verification code with decodable info
 * Format: RG-USER-MMDD-SS
 *   RG = Region code (from GPS)
 *   USER = Last 4 chars of user_id
 *   MMDD = Export date
 *   SS = Session count
 * 
 * Example: QC-A3F8-0110-03
 *   = Quebec, user ending in A3F8, Jan 10, 3 sessions
 */
function generateRefCode(
  sessions: ComputedSession[], 
  timestamp: string,
  userId?: string,
  coordinates?: { latitude: number; longitude: number }
): string {
  const date = new Date(timestamp);
  
  // Region from GPS (2 chars)
  const regionPart = coordinates 
    ? getRegionCode(coordinates.latitude, coordinates.longitude)
    : 'XX';
  
  // User suffix (4 chars)
  const userPart = userId 
    ? userId.replace(/-/g, '').slice(-4).toUpperCase() 
    : '0000';
  
  // Date MMDD
  const datePart = `${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}`;
  
  // Session count (2 digits, max 99)
  const sessionsPart = Math.min(sessions.length, 99).toString().padStart(2, '0');
  
  return `${regionPart}-${userPart}-${datePart}-${sessionsPart}`;
}

/**
 * Get region code from GPS coordinates
 * Covers Canada provinces + US regions + fallback
 */
function getRegionCode(lat: number, lng: number): string {
  // Canada Provinces (approximate bounding boxes)
  const canadaRegions: Array<{ code: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
    // Ontario
    { code: 'ON', minLat: 41.7, maxLat: 56.9, minLng: -95.2, maxLng: -74.3 },
    // Quebec
    { code: 'QC', minLat: 45.0, maxLat: 62.6, minLng: -79.8, maxLng: -57.1 },
    // British Columbia
    { code: 'BC', minLat: 48.3, maxLat: 60.0, minLng: -139.1, maxLng: -114.0 },
    // Alberta
    { code: 'AB', minLat: 49.0, maxLat: 60.0, minLng: -120.0, maxLng: -110.0 },
    // Manitoba
    { code: 'MB', minLat: 49.0, maxLat: 60.0, minLng: -102.0, maxLng: -95.2 },
    // Saskatchewan
    { code: 'SK', minLat: 49.0, maxLat: 60.0, minLng: -110.0, maxLng: -102.0 },
    // Nova Scotia
    { code: 'NS', minLat: 43.4, maxLat: 47.0, minLng: -66.4, maxLng: -59.7 },
    // New Brunswick
    { code: 'NB', minLat: 44.6, maxLat: 48.1, minLng: -69.1, maxLng: -63.8 },
    // Newfoundland
    { code: 'NL', minLat: 46.6, maxLat: 60.4, minLng: -67.8, maxLng: -52.6 },
    // PEI
    { code: 'PE', minLat: 45.9, maxLat: 47.1, minLng: -64.4, maxLng: -62.0 },
    // Yukon
    { code: 'YT', minLat: 60.0, maxLat: 69.6, minLng: -141.0, maxLng: -124.0 },
    // NWT
    { code: 'NT', minLat: 60.0, maxLat: 78.8, minLng: -136.5, maxLng: -102.0 },
    // Nunavut
    { code: 'NU', minLat: 51.7, maxLat: 83.1, minLng: -120.7, maxLng: -61.2 },
  ];

  // US Regions (simplified - by time zone areas)
  const usRegions: Array<{ code: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
    // Northeast
    { code: 'NE', minLat: 38.9, maxLat: 47.5, minLng: -80.5, maxLng: -66.9 },
    // Southeast
    { code: 'SE', minLat: 24.5, maxLat: 39.0, minLng: -91.6, maxLng: -75.0 },
    // Midwest
    { code: 'MW', minLat: 36.0, maxLat: 49.4, minLng: -104.1, maxLng: -80.5 },
    // Southwest
    { code: 'SW', minLat: 25.8, maxLat: 42.0, minLng: -124.4, maxLng: -94.0 },
    // West
    { code: 'WE', minLat: 42.0, maxLat: 49.0, minLng: -124.8, maxLng: -104.0 },
    // Alaska
    { code: 'AK', minLat: 51.2, maxLat: 71.4, minLng: -180.0, maxLng: -129.0 },
    // Hawaii
    { code: 'HI', minLat: 18.9, maxLat: 28.4, minLng: -178.4, maxLng: -154.8 },
  ];

  // Check Canada first (priority for your users)
  for (const region of canadaRegions) {
    if (lat >= region.minLat && lat <= region.maxLat && 
        lng >= region.minLng && lng <= region.maxLng) {
      return region.code;
    }
  }

  // Check US
  for (const region of usRegions) {
    if (lat >= region.minLat && lat <= region.maxLat && 
        lng >= region.minLng && lng <= region.maxLng) {
      return region.code;
    }
  }

  // Fallback by hemisphere
  if (lat >= 0) {
    return lng >= 0 ? 'EU' : 'NA'; // Europe or North America
  } else {
    return lng >= 0 ? 'AF' : 'SA'; // Africa/Asia or South America
  }
}

/**
 * Generate ref code for empty reports
 */
function generateEmptyRefCode(timestamp: string): string {
  const date = new Date(timestamp);
  const datePart = `${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}`;
  return `XX-0000-${datePart}-00`;
}

/**
 * Try to get coordinates from sessions
 * Uses first session with location data
 */
function getCoordinatesFromSessions(sessions: ComputedSession[]): { latitude: number; longitude: number } | undefined {
  // ComputedSession may have location coordinates from join
  for (const session of sessions) {
    // Try different possible field names
    const lat = (session as any).latitude || (session as any).location_latitude;
    const lng = (session as any).longitude || (session as any).location_longitude;
    
    if (lat && lng && typeof lat === 'number' && typeof lng === 'number') {
      return { latitude: lat, longitude: lng };
    }
  }
  return undefined;
}

// ============================================
// MAIN REPORT GENERATOR
// ============================================

// Day tag info for reports
export interface DayTagInfo {
  dayKey: string;
  type: string;
  label: string;
}

/**
 * Report generation options
 */
export interface ReportOptions {
  userName?: string;
  userId?: string;
  selectedDays?: Set<string>;
  dayTags?: Record<string, { type: string; label: string }>;
  coordinates?: { latitude: number; longitude: number };
}

/**
 * Generate report in the unified WhatsApp-friendly format
 * Used by both single session and multi-day exports
 * 
 * @param sessions - Sessions to include
 * @param options - Report options (userName, userId, selectedDays, dayTags, coordinates)
 */
export function generateReport(
  sessions: ComputedSession[],
  options: ReportOptions = {}
): string {
  const { userName, userId, selectedDays, dayTags, coordinates } = options;
  
  const timestamp = new Date().toISOString();
  
  // Get coordinates from first session if not provided
  const coords = coordinates || getCoordinatesFromSessions(sessions);
  
  const refCode = sessions.length > 0 
    ? generateRefCode(sessions, timestamp, userId, coords) 
    : generateEmptyRefCode(timestamp);
  
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
  
  // Initialize with selected days (including empty ones)
  if (selectedDays && selectedDays.size > 0) {
    selectedDays.forEach(dayKey => {
      byDate.set(dayKey, []);
    });
  }
  
  // Add sessions to their dates
  sessions.forEach(s => {
    const dateKey = s.entry_at.split('T')[0];
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey)!.push(s);
  });

  // Sort dates chronologically
  const sortedDates = Array.from(byDate.keys()).sort();

  // Handle empty report
  if (sortedDates.length === 0) {
    return 'No sessions found.';
  }

  let totalMinutes = 0;

  // ════════════════════════════════════════════
  // EACH DAY
  // ════════════════════════════════════════════
  let isFirstDay = true;
  
  for (const dateKey of sortedDates) {
    const daySessions = byDate.get(dateKey)!;
    const dayTag = dayTags?.[dateKey];

    // Add blank line between days (except first)
    if (!isFirstDay) {
      lines.push('');
      lines.push('');
    }
    isFirstDay = false;

    // 📅 Date header
    lines.push(`📅  ${formatDate(dateKey)}`);
    
    // Show day tag if present
    if (dayTag) {
      const tagIcon = getTagIcon(dayTag.type);
      lines.push(`${tagIcon} ${dayTag.label}`);
    }

    // Handle days without sessions
    if (daySessions.length === 0) {
      if (!dayTag) {
        lines.push('⚪ No records');
      }
      continue;
    }

    // Check for absences first
    const absenceSessions = daySessions.filter(s => s.edit_reason?.startsWith('Absence:'));
    const workSessions = daySessions.filter(s => !s.edit_reason?.startsWith('Absence:'));

    // Show absences
    for (const session of absenceSessions) {
      const absenceReason = session.edit_reason?.replace('Absence: ', '') || 'Absence';
      const absenceIcon = getAbsenceIcon(absenceReason);
      lines.push(`${absenceIcon} ${absenceReason}`);
    }

    // Group work sessions by location and sum hours
    const byLocation = new Map<string, {
      locationName: string;
      totalMinutes: number;
      totalPause: number;
      sessionCount: number;
      isEdited: boolean;
      firstEntry: string;
      lastExit: string;
    }>();

    for (const session of workSessions) {
      const locationName = session.location_name || 'Unknown';
      const pauseMin = session.pause_minutes || 0;
      const netDuration = Math.max(0, session.duration_minutes - pauseMin);
      const isEdited = session.manually_edited === 1 || session.type === 'manual';
      
      if (!byLocation.has(locationName)) {
        byLocation.set(locationName, {
          locationName,
          totalMinutes: 0,
          totalPause: 0,
          sessionCount: 0,
          isEdited: false,
          firstEntry: session.entry_at,
          lastExit: session.exit_at || session.entry_at,
        });
      }

      const loc = byLocation.get(locationName)!;
      loc.totalMinutes += netDuration;
      loc.totalPause += pauseMin;
      loc.sessionCount += 1;
      loc.isEdited = loc.isEdited || isEdited;
      
      // Track first entry and last exit for time range
      if (session.entry_at < loc.firstEntry) {
        loc.firstEntry = session.entry_at;
      }
      if (session.exit_at && session.exit_at > loc.lastExit) {
        loc.lastExit = session.exit_at;
      }
    }

    // Output grouped locations
    for (const [locationName, data] of byLocation) {
      // 📍 Location
      lines.push(`📍 ${locationName}`);

      // Time range
      const entryTime = formatTimeAMPM(data.firstEntry);
      const exitTime = formatTimeAMPM(data.lastExit);
      
      if (data.isEdited) {
        lines.push(`*Edited 》${entryTime} → ${exitTime}`);
      } else {
        lines.push(`*GPS    》${entryTime} → ${exitTime}`);
      }

      // Show session count if multiple entries
      if (data.sessionCount > 1) {
        lines.push(`(${data.sessionCount} check-ins)`);
      }

      // Break (if any total pause)
      if (data.totalPause > 0) {
        lines.push(`Break: ${data.totalPause}min`);
      }

      // Duration subtotal for this location
      lines.push(`▸ ${formatDuration(data.totalMinutes)}`);

      totalMinutes += data.totalMinutes;
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

/**
 * Get icon for day tag type
 */
function getTagIcon(tagType: string): string {
  switch (tagType) {
    case 'rain': return '🌧️';
    case 'snow': return '❄️';
    case 'day_off': return '🏖️';
    case 'holiday': return '⭐';
    case 'sick': return '🏥';
    default: return '📌';
  }
}

/**
 * Get icon for absence reason
 */
function getAbsenceIcon(reason: string): string {
  const lowerReason = reason.toLowerCase();
  if (lowerReason.includes('rain')) return '🌧️';
  if (lowerReason.includes('snow')) return '❄️';
  if (lowerReason.includes('sick')) return '🏥';
  if (lowerReason.includes('day off')) return '🏖️';
  if (lowerReason.includes('holiday')) return '⭐';
  return '📋';
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
  userName?: string,
  userId?: string
): string {
  return generateReport([session], { userName, userId });
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
  userName?: string,
  userId?: string
): string {
  return generateReport(sessions, { userName, userId });
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
// REF CODE DECODER (for support)
// ============================================

export interface DecodedRefCode {
  regionCode: string;
  userSuffix: string;
  exportMonth: number;
  exportDay: number;
  sessionCount: number;
  raw: string;
}

/**
 * Decode a Ref # code for support/debugging
 * Example: "QC-A3F8-0106-03" → { regionCode: 'QC', userSuffix: 'A3F8', ... }
 */
export function decodeRefCode(refCode: string): DecodedRefCode | null {
  try {
    // Remove "Ref # " prefix if present
    const clean = refCode.replace(/^Ref\s*#?\s*/i, '').trim();
    
    // Format: RG-USER-MMDD-SS
    const parts = clean.split('-');
    if (parts.length !== 4) return null;
    
    const [regionCode, userSuffix, dateStr, sessionsStr] = parts;
    
    const exportMonth = parseInt(dateStr.substring(0, 2), 10);
    const exportDay = parseInt(dateStr.substring(2, 4), 10);
    const sessionCount = parseInt(sessionsStr, 10);
    
    if (isNaN(exportMonth) || isNaN(exportDay) || isNaN(sessionCount)) {
      return null;
    }
    
    return {
      regionCode,
      userSuffix: userSuffix.toLowerCase(),
      exportMonth,
      exportDay,
      sessionCount,
      raw: clean,
    };
  } catch {
    return null;
  }
}

/**
 * Generate SQL query hint for finding user by Ref #
 */
export function getRefCodeSearchHint(refCode: string): string | null {
  const decoded = decodeRefCode(refCode);
  if (!decoded) return null;
  
  return `
-- Search for user by Ref # ${decoded.raw}
-- Region: ${decoded.regionCode}
-- Date: ${decoded.exportMonth}/${decoded.exportDay}
-- Sessions: ${decoded.sessionCount}

SELECT * FROM auth.users 
WHERE id::text LIKE '%${decoded.userSuffix}';

-- Then verify with records:
-- SELECT COUNT(*) FROM records 
-- WHERE user_id = '<found_user_id>'
-- AND DATE(entry_at) = '2026-${decoded.exportMonth.toString().padStart(2,'0')}-${decoded.exportDay.toString().padStart(2,'0')}';
  `.trim();
}


