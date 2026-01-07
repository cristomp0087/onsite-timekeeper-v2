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
 * Pausa: 15min
 * ▸ 2h 15min
 * ════════════════════
 * TOTAL: 4h 00min
 * OnSite Timekeeper 
 * Ref #   49A2 - 1856
 * 
 * MODIFICADO:
 * - Adiciona linha em branco entre locais diferentes
 */

import { SessaoComputada, formatarDuracao } from './database';
import { logger } from './logger';

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
function generateRefCode(sessoes: SessaoComputada[], timestamp: string): string {
  // Create hash from session data
  const data = sessoes.map(s => `${s.id}|${s.entrada}|${s.duracao_minutos}`).join(';');
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
  sessoes: SessaoComputada[],
  userName?: string
): string {
  if (!sessoes || sessoes.length === 0) {
    return 'No sessions found.';
  }

  const timestamp = new Date().toISOString();
  const refCode = generateRefCode(sessoes, timestamp);
  
  const lines: string[] = [];

  // ════════════════════════════════════════════
  // HEADER - User name
  // ════════════════════════════════════════════
  lines.push(userName || 'Time Report');
  lines.push(SEPARATOR_SINGLE);

  // ════════════════════════════════════════════
  // GROUP SESSIONS BY DATE
  // ════════════════════════════════════════════
  const byDate = new Map<string, SessaoComputada[]>();
  sessoes.forEach(s => {
    const dateKey = s.entrada.split('T')[0];
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
    let previousLocalNome: string | null = null;

    // Each session in the day
    for (const sessao of daySessions) {
      const pausaMin = sessao.pausa_minutos || 0;
      const duracaoLiquida = Math.max(0, sessao.duracao_minutos - pausaMin);
      const isEdited = sessao.editado_manualmente === 1 || sessao.tipo === 'manual';
      
      const entryTime = formatTimeAMPM(sessao.entrada);
      const exitTime = sessao.saida ? formatTimeAMPM(sessao.saida) : '--:--';

      const currentLocalNome = sessao.local_nome || 'Unknown';

      // Add blank line between different locations
      if (previousLocalNome !== null && previousLocalNome !== currentLocalNome) {
        lines.push('');
      }

      // 📍 Location
      lines.push(`📍 ${currentLocalNome}`);

      // Time line - GPS or Edited
      if (isEdited) {
        lines.push(`*Edited 》${entryTime} → ${exitTime}`);
      } else {
        lines.push(`*GPS    》${entryTime} → ${exitTime}`);
      }

      // Pause (if any)
      if (pausaMin > 0) {
        lines.push(`Pausa: ${pausaMin}min`);
      }

      // Duration subtotal for this session
      lines.push(`▸ ${formatarDuracao(duracaoLiquida)}`);

      totalMinutes += duracaoLiquida;
      previousLocalNome = currentLocalNome;
    }
  }

  // ════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════
  lines.push(SEPARATOR_DOUBLE);
  lines.push(`TOTAL: ${formatarDuracao(totalMinutes)}`);
  lines.push('');
  lines.push(APP_NAME);
  lines.push(`Ref #   ${refCode}`);

  return lines.join('\n');
}

// ============================================
// LEGACY FUNCTION ALIASES (for compatibility)
// ============================================

/**
 * Generate single session report
 * Called after clock out via "Compartilhar" button
 */
export function gerarRelatorioSessao(
  sessao: SessaoComputada,
  nomeUsuario?: string
): string {
  return generateReport([sessao], nomeUsuario);
}

/**
 * Generate complete report for period
 * Called from weekly export and compartilharRelatorio
 */
export function gerarRelatorioCompleto(
  sessoes: SessaoComputada[],
  nomeUsuario?: string
): string {
  return generateReport(sessoes, nomeUsuario);
}

/**
 * Generate quick summary (for preview in UI)
 */
export function gerarResumo(sessoes: SessaoComputada[]): string {
  if (!sessoes || sessoes.length === 0) {
    return 'No sessions selected.';
  }

  const totalMinutes = sessoes.reduce((acc, s) => {
    const pausa = s.pausa_minutos || 0;
    return acc + Math.max(0, s.duracao_minutos - pausa);
  }, 0);

  return `${sessoes.length} session(s) • ${formatarDuracao(totalMinutes)}`;
}

// ============================================
// METADATA (for programmatic use)
// ============================================

export interface RelatorioMetadata {
  geradoEm: string;
  refCode: string;
  totalSessoes: number;
  totalMinutos: number;
}

export function getRelatorioMetadata(
  sessoes: SessaoComputada[],
  nomeUsuario?: string
): RelatorioMetadata {
  const timestamp = new Date().toISOString();
  const refCode = generateRefCode(sessoes, timestamp);
  
  const totalMinutos = sessoes.reduce((acc, s) => {
    const pausa = s.pausa_minutos || 0;
    return acc + Math.max(0, s.duracao_minutos - pausa);
  }, 0);

  return {
    geradoEm: timestamp,
    refCode,
    totalSessoes: sessoes.length,
    totalMinutos,
  };
}

// ============================================
// GROUPING HELPERS (kept for compatibility)
// ============================================

export interface RelatorioAgrupado {
  localNome: string;
  sessoes: {
    data: string;
    entrada: string;
    saida: string;
    duracao: number;
    pausaMinutos: number;
    duracaoLiquida: number;
    editado: boolean;
  }[];
  subtotalBruto: number;
  subtotalPausa: number;
  subtotalLiquido: number;
}

export function agruparSessoesPorLocal(sessoes: SessaoComputada[]): RelatorioAgrupado[] {
  const grupos: Record<string, RelatorioAgrupado> = {};

  for (const sessao of sessoes) {
    const localNome = sessao.local_nome || 'Unknown';

    if (!grupos[localNome]) {
      grupos[localNome] = {
        localNome,
        sessoes: [],
        subtotalBruto: 0,
        subtotalPausa: 0,
        subtotalLiquido: 0,
      };
    }

    const pausaMinutos = sessao.pausa_minutos || 0;
    const duracaoLiquida = Math.max(0, sessao.duracao_minutos - pausaMinutos);

    grupos[localNome].sessoes.push({
      data: sessao.entrada.split('T')[0],
      entrada: formatTimeAMPM(sessao.entrada),
      saida: sessao.saida ? formatTimeAMPM(sessao.saida) : 'In progress',
      duracao: sessao.duracao_minutos,
      pausaMinutos,
      duracaoLiquida,
      editado: sessao.editado_manualmente === 1,
    });

    grupos[localNome].subtotalBruto += sessao.duracao_minutos;
    grupos[localNome].subtotalPausa += pausaMinutos;
    grupos[localNome].subtotalLiquido += duracaoLiquida;
  }

  return Object.values(grupos).sort((a, b) => b.subtotalLiquido - a.subtotalLiquido);
}
