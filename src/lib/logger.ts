/**
 * Sistema de Logging do OnSite Timekeeper
 * 
 * - Logs coloridos no console (dev)
 * - Listeners para DevMonitor
 * - Fila de envio para Supabase (opcional)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogCategory = 
  | 'auth' 
  | 'gps' 
  | 'geofence' 
  | 'sync' 
  | 'database' 
  | 'notification'
  | 'session'
  | 'ui'
  | 'boot'
  | 'heartbeat'   
  | 'registro'
  | 'telemetry';  // NOVO

export interface LogEntry {
  id: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

// Configuração
const CONFIG = {
  enableConsole: __DEV__,
  maxStoredLogs: 500,
  enableColors: true,
};

// Emojis por nível
const levelEmoji: Record<LogLevel, string> = {
  debug: '🔵',
  info: '🟢',
  warn: '🟡',
  error: '🔴',
};

// Cores por categoria (para console)
const categoryColor: Record<LogCategory, string> = {
  auth: '\x1b[35m',      // magenta
  gps: '\x1b[36m',       // cyan
  geofence: '\x1b[33m',  // yellow
  sync: '\x1b[34m',      // blue
  database: '\x1b[32m',  // green
  notification: '\x1b[31m', // red
  session: '\x1b[95m',   // light magenta
  ui: '\x1b[94m',        // light blue
  boot: '\x1b[96m',      // light cyan
  heartbeat: '\x1b[93m', // light yellow
  registro: '\x1b[92m',  // light green
  telemetry: '\x1b[90m', // NOVO: gray
};

// Storage de logs em memória
const logStorage: LogEntry[] = [];

// Listeners para DevMonitor
type LogListener = (entry: LogEntry) => void;
const listeners: Set<LogListener> = new Set();

/**
 * Gera UUID simples para logs
 */
function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Adiciona listener para receber logs em tempo real
 */
export function addLogListener(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notifica todos os listeners sobre novo log
 */
function notifyListeners(entry: LogEntry): void {
  listeners.forEach(listener => {
    try {
      listener(entry);
    } catch (e) {
      // Evita que erro em listener quebre o logging
      console.error('Log listener error:', e);
    }
  });
}

/**
 * Função principal de logging
 */
function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  metadata?: Record<string, unknown>
): void {
  const entry: LogEntry = {
    id: generateLogId(),
    level,
    category,
    message,
    metadata,
    timestamp: new Date(),
  };

  // Armazena em memória (com limite)
  logStorage.push(entry);
  if (logStorage.length > CONFIG.maxStoredLogs) {
    logStorage.shift();
  }

  // Console em desenvolvimento
  if (CONFIG.enableConsole) {
    const emoji = levelEmoji[level];
    const color = CONFIG.enableColors ? categoryColor[category] : '';
    const reset = CONFIG.enableColors ? '\x1b[0m' : '';
    const time = entry.timestamp.toLocaleTimeString('pt-BR');
    
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
    console.log(
      `${emoji} ${color}[${time}][${category.toUpperCase()}]${reset} ${message}${metaStr}`
    );
  }

  // Notifica listeners (DevMonitor)
  notifyListeners(entry);
}

/**
 * API pública do logger
 */
export const logger = {
  debug: (category: LogCategory, message: string, metadata?: Record<string, unknown>) =>
    log('debug', category, message, metadata),
  
  info: (category: LogCategory, message: string, metadata?: Record<string, unknown>) =>
    log('info', category, message, metadata),
  
  warn: (category: LogCategory, message: string, metadata?: Record<string, unknown>) =>
    log('warn', category, message, metadata),
  
  error: (category: LogCategory, message: string, metadata?: Record<string, unknown>) =>
    log('error', category, message, metadata),
};

/**
 * Retorna todos os logs armazenados
 */
export function getStoredLogs(): LogEntry[] {
  return [...logStorage];
}

/**
 * Retorna logs filtrados por nível
 */
export function getLogsByLevel(level: LogLevel): LogEntry[] {
  return logStorage.filter(l => l.level === level);
}

/**
 * Retorna logs filtrados por categoria
 */
export function getLogsByCategory(category: LogCategory): LogEntry[] {
  return logStorage.filter(l => l.category === category);
}

/**
 * Limpa todos os logs armazenados
 */
export function clearLogs(): void {
  logStorage.length = 0;
  logger.info('database', 'Logs limpos');
}

/**
 * Exporta logs como texto para debug
 */
export function exportLogsAsText(): string {
  return logStorage
    .map(l => {
      const time = l.timestamp.toISOString();
      const meta = l.metadata ? ` | ${JSON.stringify(l.metadata)}` : '';
      return `[${time}][${l.level.toUpperCase()}][${l.category}] ${l.message}${meta}`;
    })
    .join('\n');
}
