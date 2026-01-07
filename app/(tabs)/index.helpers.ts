/**
 * Home Screen Helpers - OnSite Timekeeper
 * 
 * Funções utilitárias para manipulação de datas e calendário
 */

import type { SessaoComputada } from '../../src/lib/database';

// ============================================
// CONSTANTES
// ============================================

export const DIAS_SEMANA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DIAS_SEMANA_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// ============================================
// TIPOS
// ============================================

export interface DiaCalendario {
  data: Date;
  diaSemana: string;
  diaNumero: number;
  sessoes: SessaoComputada[];
  totalMinutos: number;
}

// ============================================
// FUNÇÕES DE SEMANA
// ============================================

export function getInicioSemana(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getFimSemana(date: Date): Date {
  const inicio = getInicioSemana(date);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 6);
  fim.setHours(23, 59, 59, 999);
  return fim;
}

// ============================================
// FUNÇÕES DE MÊS
// ============================================

export function getInicioMes(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getFimMes(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function getMonthCalendarDays(date: Date): (Date | null)[] {
  const inicio = getInicioMes(date);
  const fim = getFimMes(date);
  const days: (Date | null)[] = [];
  
  // Preenche dias vazios no início
  const firstDayOfWeek = inicio.getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    days.push(null);
  }
  
  // Preenche dias do mês
  const current = new Date(inicio);
  while (current <= fim) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  return days;
}

// ============================================
// FORMATAÇÃO
// ============================================

export function formatDateRange(inicio: Date, fim: Date): string {
  const formatDay = (d: Date) => d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  return `${formatDay(inicio)} - ${formatDay(fim)}`;
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
// COMPARAÇÃO DE DATAS
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
