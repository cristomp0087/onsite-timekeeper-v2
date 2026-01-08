/**
 * Home Screen Helpers - OnSite Timekeeper
 * 
 * Utility functions for date and calendar manipulation
 * 
 * REFACTORED: All PT names removed, English only
 */

import type { ComputedSession } from '../../lib/database';

// ============================================
// CONSTANTS
// ============================================

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// ============================================
// TYPES
// ============================================

export interface CalendarDay {
  date: Date;
  weekday: string;
  dayNumber: number;
  sessions: ComputedSession[];
  totalMinutes: number;
}

// ============================================
// WEEK FUNCTIONS
// ============================================

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

// ============================================
// MONTH FUNCTIONS
// ============================================

export function getMonthStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getMonthEnd(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function getMonthCalendarDays(date: Date): (Date | null)[] {
  const start = getMonthStart(date);
  const end = getMonthEnd(date);
  const days: (Date | null)[] = [];
  
  // Fill empty days at the start
  const firstDayOfWeek = start.getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    days.push(null);
  }
  
  // Fill days of the month
  const current = new Date(start);
  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  return days;
}

// ============================================
// FORMATTING
// ============================================

export function formatDateRange(start: Date, end: Date): string {
  const formatDay = (d: Date) => d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  return `${formatDay(start)} - ${formatDay(end)}`;
}

export function formatMonthYear(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatTimeAMPM(iso: string): string {
  const date = new Date(iso);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

// ============================================
// DATE COMPARISON
// ============================================

export function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function getDayKey(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

// ============================================
// DEPRECATED ALIASES (backward compatibility)
// Remove after all components updated
// ============================================

/** @deprecated Use WEEKDAYS instead */
export const DIAS_SEMANA = WEEKDAYS;

/** @deprecated Use CalendarDay instead */
export type DiaCalendario = CalendarDay;

/** @deprecated Use getWeekStart instead */
export const getInicioSemana = getWeekStart;

/** @deprecated Use getWeekEnd instead */
export const getFimSemana = getWeekEnd;

/** @deprecated Use getMonthStart instead */
export const getInicioMes = getMonthStart;

/** @deprecated Use getMonthEnd instead */
export const getFimMes = getMonthEnd;
