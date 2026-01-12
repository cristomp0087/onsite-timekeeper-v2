/**
 * Logging System - OnSite Timekeeper
 * 
 * - Colored logs in console (dev)
 * - Listeners for DevMonitor
 * - PRIVACY: Masks emails and GPS coords in production
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
  | 'record'
  | 'registro'    // Legacy (Portuguese)
  | 'telemetry'
  | 'ttl'
  | 'pingpong'
  | 'permissions'
  | 'settings';


export interface LogEntry {
  id: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

// Configuration
const CONFIG = {
  enableConsole: __DEV__,
  maxStoredLogs: 500,
  enableColors: true,
  // PRIVACY: Always mask sensitive data (even in dev)
  showSensitiveData: false,
};

// Emojis per level
const levelEmoji: Record<LogLevel, string> = {
  debug: '🔵',
  info: '🟢',
  warn: '🟡',
  error: '🔴',
};

const categoryColor: Record<LogCategory, string> = {
  auth: '\x1b[35m',        // magenta
  gps: '\x1b[36m',         // cyan
  geofence: '\x1b[33m',    // yellow
  sync: '\x1b[34m',        // blue
  database: '\x1b[32m',    // green
  notification: '\x1b[31m', // red
  session: '\x1b[95m',     // light magenta
  ui: '\x1b[94m',          // light blue
  boot: '\x1b[96m',        // light cyan
  heartbeat: '\x1b[93m',   // light yellow
  record: '\x1b[92m',      // light green
  registro: '\x1b[92m',    // light green (Legacy)
  telemetry: '\x1b[90m',   // gray
  ttl: '\x1b[93m',         // light yellow
  pingpong: '\x1b[95m',    // light magenta
  permissions: '\x1b[36m', // cyan
  settings: '\x1b[37m',    // white
};

// In-memory log storage
const logStorage: LogEntry[] = [];

// Listeners for DevMonitor
type LogListener = (entry: LogEntry) => void;
const listeners: Set<LogListener> = new Set();

// ============================================
// PRIVACY HELPERS
// ============================================

/**
 * Mask email address for privacy
 * cristony.bruno@gmail.com → c******@gmail.com
 */
function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}******@${domain}`;
}

/**
 * Mask GPS coordinates for privacy
 * Returns only accuracy, not exact position
 */
function maskCoordinates(lat: number | string, lng: number | string, accuracy?: number | string): string {
  if (CONFIG.showSensitiveData) {
    return `lat:${lat}, lng:${lng}, acc:${accuracy ?? '?'}m`;
  }
  return `[GPS hidden] acc:${accuracy ?? '?'}m`;
}

/**
 * Sanitize metadata object - remove or mask sensitive fields
 */
function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (CONFIG.showSensitiveData) return metadata;

  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    const keyLower = key.toLowerCase();
    
    // Mask email fields
    if (keyLower.includes('email') && typeof value === 'string') {
      sanitized[key] = maskEmail(value);
      continue;
    }
    
    // Mask coordinate fields
    if ((keyLower === 'lat' || keyLower === 'latitude') && typeof value !== 'undefined') {
      sanitized[key] = '[hidden]';
      continue;
    }
    if ((keyLower === 'lng' || keyLower === 'longitude') && typeof value !== 'undefined') {
      sanitized[key] = '[hidden]';
      continue;
    }
    
    // Mask userId (show only first 8 chars)
    if (keyLower === 'userid' && typeof value === 'string') {
      sanitized[key] = value.length > 8 ? `${value.substring(0, 8)}...` : value;
      continue;
    }
    
    // Keep other fields as-is
    sanitized[key] = value;
  }
  
  return sanitized;
}

/**
 * Sanitize log message - mask inline sensitive data
 */
function sanitizeMessage(message: string): string {
  if (CONFIG.showSensitiveData) return message;
  
  // Mask email patterns in message
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let sanitized = message.replace(emailPattern, (email) => maskEmail(email));
  
  // Mask coordinate patterns like "45.375171" (6+ decimal digits after dot)
  // Only if it looks like a coordinate (between -180 and 180)
  const coordPattern = /-?\d{1,3}\.\d{5,}/g;
  sanitized = sanitized.replace(coordPattern, '[coord]');
  
  return sanitized;
}

// ============================================
// CORE LOGGING
// ============================================

/**
 * Generate simple UUID for logs
 */
function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Add listener to receive logs in real-time
 */
export function addLogListener(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify all listeners about new log
 */
function notifyListeners(entry: LogEntry): void {
  listeners.forEach(listener => {
    try {
      listener(entry);
    } catch (e) {
      // Prevent listener error from breaking logging
      console.error('Log listener error:', e);
    }
  });
}

/**
 * Main logging function
 */
function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  metadata?: Record<string, unknown>
): void {
  // Sanitize for privacy
  const safeMessage = sanitizeMessage(message);
  const safeMetadata = sanitizeMetadata(metadata);

  const entry: LogEntry = {
    id: generateLogId(),
    level,
    category,
    message: safeMessage,
    metadata: safeMetadata,
    timestamp: new Date(),
  };

  // Store in memory (with limit)
  logStorage.push(entry);
  if (logStorage.length > CONFIG.maxStoredLogs) {
    logStorage.shift();
  }

  // Console in development
  if (CONFIG.enableConsole) {
    const emoji = levelEmoji[level];
    const color = CONFIG.enableColors ? categoryColor[category] : '';
    const reset = CONFIG.enableColors ? '\x1b[0m' : '';
    const time = entry.timestamp.toLocaleTimeString('en-US');
    
    const metaStr = safeMetadata ? ` ${JSON.stringify(safeMetadata)}` : '';
    console.log(
      `${emoji} ${color}[${time}][${category.toUpperCase()}]${reset} ${safeMessage}${metaStr}`
    );
  }

  // Notify listeners (DevMonitor)
  notifyListeners(entry);
}

/**
 * Public logger API
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

// ============================================
// LOG RETRIEVAL
// ============================================

/**
 * Return all stored logs
 */
export function getStoredLogs(): LogEntry[] {
  return [...logStorage];
}

/**
 * Return logs filtered by level
 */
export function getLogsByLevel(level: LogLevel): LogEntry[] {
  return logStorage.filter(l => l.level === level);
}

/**
 * Return logs filtered by category
 */
export function getLogsByCategory(category: LogCategory): LogEntry[] {
  return logStorage.filter(l => l.category === category);
}

/**
 * Clear all stored logs
 */
export function clearLogs(): void {
  logStorage.length = 0;
  logger.info('database', 'Logs cleared');
}

/**
 * Export logs as text for debug
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
