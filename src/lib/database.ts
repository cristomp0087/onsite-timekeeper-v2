/**
 * Database SQLite - OnSite Timekeeper
 * 
 * Source of truth local (offline-first)
 * - CRUD de locais
 * - CRUD de registros (sessões)
 * - Auditoria via sync_log
 * - Geopontos (auditoria GPS)
 * - Validações de negócio
 * - TELEMETRIA AGREGADA (NOVO)
 */

import * as SQLite from 'expo-sqlite';
import { logger } from './logger';

// Instância única do banco
const db = SQLite.openDatabaseSync('onsite-timekeeper.db');

// ============================================
// TIPOS
// ============================================

export type LocalStatus = 'active' | 'deleted' | 'pending_delete' | 'syncing';
export type RegistroTipo = 'automatico' | 'manual';
export type SyncLogAction = 'create' | 'update' | 'delete' | 'sync_up' | 'sync_down';
export type SyncLogStatus = 'pending' | 'synced' | 'conflict' | 'failed';
export type GeopontoFonte = 'polling' | 'geofence' | 'heartbeat' | 'background' | 'manual';

export interface LocalDB {
  id: string;
  user_id: string;
  nome: string;
  latitude: number;
  longitude: number;
  raio: number;
  cor: string;
  status: LocalStatus;
  deleted_at: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface RegistroDB {
  id: string;
  user_id: string;
  local_id: string;
  local_nome: string | null;
  entrada: string;
  saida: string | null;
  tipo: RegistroTipo;
  editado_manualmente: number; // SQLite não tem boolean
  motivo_edicao: string | null;
  hash_integridade: string | null;
  cor: string | null;
  device_id: string | null;
  pausa_minutos: number | null;
  created_at: string;
  synced_at: string | null;
}

export interface SyncLogDB {
  id: string;
  user_id: string;
  entity_type: 'local' | 'registro';
  entity_id: string;
  action: SyncLogAction;
  old_value: string | null;
  new_value: string | null;
  sync_status: SyncLogStatus;
  error_message: string | null;
  created_at: string;
}

// Sessão com campos calculados para UI
export interface SessaoComputada extends RegistroDB {
  status: 'ativa' | 'pausada' | 'finalizada';
  duracao_minutos: number;
}

export interface EstatisticasDia {
  total_minutos: number;
  total_sessoes: number;
}

export interface HeartbeatLogDB {
  id: string;
  user_id: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  inside_fence: number; // 0 ou 1 (SQLite não tem boolean)
  fence_id: string | null;
  fence_name: string | null;
  sessao_id: string | null;
  battery_level: number | null;
  created_at: string;
}

export interface GeopontoDB {
  id: string;
  sessao_id: string | null;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: string;
  fonte: GeopontoFonte;
  dentro_fence: number; // 0 ou 1
  fence_id: string | null;
  fence_nome: string | null;
  created_at: string;
  synced_at: string | null;
}

// ============================================
// NOVO: TELEMETRIA DIÁRIA AGREGADA
// ============================================

export interface TelemetryDailyDB {
  date: string; // YYYY-MM-DD (PRIMARY KEY junto com user_id)
  user_id: string;
  
  // Uso do app
  app_opens: number;
  
  // Entries
  manual_entries_count: number;
  geofence_entries_count: number;
  
  // Geofence performance
  geofence_triggers: number;
  geofence_accuracy_sum: number; // Para calcular média
  geofence_accuracy_count: number;
  
  // Background & Battery
  background_location_checks: number;
  battery_level_sum: number;
  battery_level_count: number;
  
  // Sync health
  offline_entries_count: number;
  sync_attempts: number;
  sync_failures: number;
  
  // Heartbeat (agregado do antigo heartbeat_log)
  heartbeat_count: number;
  heartbeat_inside_fence_count: number;
  
  // Metadata
  created_at: string;
  synced_at: string | null;
}


// ============================================
// INICIALIZAÇÃO
// ============================================

let dbInitialized = false;

export async function initDatabase(): Promise<void> {
  if (dbInitialized) {
    logger.debug('database', 'Database já inicializado');
    return;
  }

  try {
    logger.info('boot', '🗄️ Inicializando SQLite...');

    // Tabela de locais
    db.execSync(`
      CREATE TABLE IF NOT EXISTS locais (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        raio INTEGER DEFAULT 100,
        cor TEXT DEFAULT '#3B82F6',
        status TEXT DEFAULT 'active',
        deleted_at TEXT,
        last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

    // Tabela de registros (sessões)
    db.execSync(`
      CREATE TABLE IF NOT EXISTS registros (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        local_id TEXT NOT NULL,
        local_nome TEXT,
        entrada TEXT NOT NULL,
        saida TEXT,
        tipo TEXT DEFAULT 'automatico',
        editado_manualmente INTEGER DEFAULT 0,
        motivo_edicao TEXT,
        hash_integridade TEXT,
        cor TEXT,
        device_id TEXT,
        pausa_minutos INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

    // ============================================
    // MIGRATION: Adicionar coluna pausa_minutos se não existir
    // ============================================
    try {
      // Tenta adicionar a coluna - se já existe, vai dar erro e ignoramos
      db.execSync(`ALTER TABLE registros ADD COLUMN pausa_minutos INTEGER DEFAULT 0`);
      logger.info('database', '✅ Migration: coluna pausa_minutos adicionada');
    } catch (migrationError) {
      // Coluna já existe, ignorar erro
      logger.debug('database', 'Coluna pausa_minutos já existe (ok)');
    }

    // Tabela de auditoria de sync
    db.execSync(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        sync_status TEXT DEFAULT 'pending',
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

     // Tabela de heartbeat logs (LEGADO - será migrado para telemetry_daily)
    db.execSync(`
      CREATE TABLE IF NOT EXISTS heartbeat_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        inside_fence INTEGER DEFAULT 0,
        fence_id TEXT,
        fence_name TEXT,
        sessao_id TEXT,
        battery_level INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

     // Índice para heartbeat
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_heartbeat_user ON heartbeat_log(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_heartbeat_timestamp ON heartbeat_log(timestamp)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_heartbeat_sessao ON heartbeat_log(sessao_id)`);

    // ============================================
    // TABELA GEOPONTOS (Auditoria GPS)
    // ============================================
    db.execSync(`
      CREATE TABLE IF NOT EXISTS geopontos (
        id TEXT PRIMARY KEY,
        sessao_id TEXT,
        user_id TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        timestamp TEXT NOT NULL,
        fonte TEXT DEFAULT 'polling',
        dentro_fence INTEGER DEFAULT 0,
        fence_id TEXT,
        fence_nome TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

    // Índices para geopontos
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_geopontos_user ON geopontos(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_geopontos_sessao ON geopontos(sessao_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_geopontos_timestamp ON geopontos(timestamp)`);

    // ============================================
    // NOVO: TABELA TELEMETRY_DAILY (Agregado)
    // ============================================
    db.execSync(`
      CREATE TABLE IF NOT EXISTS telemetry_daily (
        date TEXT NOT NULL,
        user_id TEXT NOT NULL,
        
        -- Uso do app
        app_opens INTEGER DEFAULT 0,
        
        -- Entries
        manual_entries_count INTEGER DEFAULT 0,
        geofence_entries_count INTEGER DEFAULT 0,
        
        -- Geofence performance
        geofence_triggers INTEGER DEFAULT 0,
        geofence_accuracy_sum REAL DEFAULT 0,
        geofence_accuracy_count INTEGER DEFAULT 0,
        
        -- Background & Battery
        background_location_checks INTEGER DEFAULT 0,
        battery_level_sum REAL DEFAULT 0,
        battery_level_count INTEGER DEFAULT 0,
        
        -- Sync health
        offline_entries_count INTEGER DEFAULT 0,
        sync_attempts INTEGER DEFAULT 0,
        sync_failures INTEGER DEFAULT 0,
        
        -- Heartbeat agregado
        heartbeat_count INTEGER DEFAULT 0,
        heartbeat_inside_fence_count INTEGER DEFAULT 0,
        
        -- Metadata
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT,
        
        PRIMARY KEY (date, user_id)
      )
    `);

    // Índice para telemetry_daily
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_telemetry_user ON telemetry_daily(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_telemetry_synced ON telemetry_daily(synced_at)`);

    // Índices para performance
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_locais_user ON locais(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_locais_status ON locais(status)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_registros_user ON registros(user_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_registros_local ON registros(local_id)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_registros_entrada ON registros(entrada)`);
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_id)`);

    dbInitialized = true;
    logger.info('boot', '✅ SQLite inicializado com sucesso');
  } catch (error) {
    logger.error('database', '❌ Erro ao inicializar SQLite', { error: String(error) });
    throw error;
  }
}

// ============================================
// HELPERS
// ============================================

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function now(): string {
  return new Date().toISOString();
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Calcula distância entre dois pontos (Haversine)
 */
export function calcularDistancia(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Raio da Terra em metros
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Calcula duração em minutos entre duas datas
 */
export function calcularDuracao(inicio: string, fim: string | null): number {
  if (!inicio) return 0;
  const start = new Date(inicio).getTime();
  const end = fim ? new Date(fim).getTime() : Date.now();
  if (isNaN(start) || isNaN(end)) return 0;
  const diff = Math.round((end - start) / 60000);
  return diff > 0 ? diff : 0;
}

/**
 * Formata duração em minutos para string legível
 */
export function formatarDuracao(minutos: number | null | undefined): string {
  if (minutos === null || minutos === undefined || isNaN(minutos)) {
    return '0min';
  }
  const total = Math.floor(Math.max(0, minutos));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

// ============================================
// SYNC LOG (Auditoria)
// ============================================

export async function registrarSyncLog(
  userId: string,
  entityType: 'local' | 'registro',
  entityId: string,
  action: SyncLogAction,
  oldValue: unknown | null,
  newValue: unknown | null,
  status: SyncLogStatus = 'pending',
  errorMessage: string | null = null
): Promise<void> {
  try {
    const id = generateUUID();
    db.runSync(
      `INSERT INTO sync_log (id, user_id, entity_type, entity_id, action, old_value, new_value, sync_status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        entityType,
        entityId,
        action,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        status,
        errorMessage,
        now()
      ]
    );
    logger.debug('database', `📝 Sync log: ${action} ${entityType}`, { entityId });
  } catch (error) {
    logger.error('database', 'Erro ao registrar sync log', { error: String(error) });
  }
}

export async function getSyncLogs(
  userId: string,
  limit: number = 100
): Promise<SyncLogDB[]> {
  try {
    return db.getAllSync<SyncLogDB>(
      `SELECT * FROM sync_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar sync logs', { error: String(error) });
    return [];
  }
}

export async function getSyncLogsByEntity(
  entityType: 'local' | 'registro',
  entityId: string
): Promise<SyncLogDB[]> {
  try {
    return db.getAllSync<SyncLogDB>(
      `SELECT * FROM sync_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC`,
      [entityType, entityId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar sync logs por entidade', { error: String(error) });
    return [];
  }
}

// ============================================
// LOCAIS - CRUD
// ============================================

export interface CriarLocalParams {
  userId: string;
  nome: string;
  latitude: number;
  longitude: number;
  raio?: number;
  cor?: string;
}

export async function criarLocal(params: CriarLocalParams): Promise<string> {
  const id = generateUUID();
  const timestamp = now();

  try {
    db.runSync(
      `INSERT INTO locais (id, user_id, nome, latitude, longitude, raio, cor, status, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.userId,
        params.nome,
        params.latitude,
        params.longitude,
        params.raio || 100,
        params.cor || '#3B82F6',
        'active',
        timestamp,
        timestamp,
        timestamp
      ]
    );

    // Log de sync
    await registrarSyncLog(params.userId, 'local', id, 'create', null, params);

    logger.info('database', `📍 Local criado: ${params.nome}`, { id });
    return id;
  } catch (error) {
    logger.error('database', 'Erro ao criar local', { error: String(error) });
    throw error;
  }
}

export async function getLocais(userId: string): Promise<LocalDB[]> {
  try {
    return db.getAllSync<LocalDB>(
      `SELECT * FROM locais WHERE user_id = ? AND status = 'active' ORDER BY nome ASC`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar locais', { error: String(error) });
    return [];
  }
}

export async function getLocalById(id: string): Promise<LocalDB | null> {
  try {
    return db.getFirstSync<LocalDB>(
      `SELECT * FROM locais WHERE id = ?`,
      [id]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar local por ID', { error: String(error) });
    return null;
  }
}

export async function atualizarLocal(
  id: string,
  updates: Partial<Pick<LocalDB, 'nome' | 'latitude' | 'longitude' | 'raio' | 'cor'>>
): Promise<void> {
  try {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.nome !== undefined) {
      setClauses.push('nome = ?');
      values.push(updates.nome);
    }
    if (updates.latitude !== undefined) {
      setClauses.push('latitude = ?');
      values.push(updates.latitude);
    }
    if (updates.longitude !== undefined) {
      setClauses.push('longitude = ?');
      values.push(updates.longitude);
    }
    if (updates.raio !== undefined) {
      setClauses.push('raio = ?');
      values.push(updates.raio);
    }
    if (updates.cor !== undefined) {
      setClauses.push('cor = ?');
      values.push(updates.cor);
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = ?');
    values.push(now());

    setClauses.push('synced_at = NULL');

    values.push(id);

    db.runSync(
      `UPDATE locais SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    logger.info('database', `📍 Local atualizado: ${id}`, { updates });
  } catch (error) {
    logger.error('database', 'Erro ao atualizar local', { error: String(error) });
    throw error;
  }
}

export async function removerLocal(userId: string, id: string): Promise<void> {
  try {
    // Soft delete
    db.runSync(
      `UPDATE locais SET status = 'deleted', deleted_at = ?, updated_at = ?, synced_at = NULL WHERE id = ? AND user_id = ?`,
      [now(), now(), id, userId]
    );

    // Log de sync
    await registrarSyncLog(userId, 'local', id, 'delete', { id }, null);

    logger.info('database', `🗑️ Local removido (soft): ${id}`);
  } catch (error) {
    logger.error('database', 'Erro ao remover local', { error: String(error) });
    throw error;
  }
}

export async function atualizarLastSeen(id: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE locais SET last_seen_at = ? WHERE id = ?`,
      [now(), id]
    );
  } catch (error) {
    logger.error('database', 'Erro ao atualizar last_seen', { error: String(error) });
  }
}

// ============================================
// REGISTROS (SESSÕES) - CRUD
// ============================================

export interface CriarRegistroParams {
  userId: string;
  localId: string;
  localNome: string;
  tipo?: RegistroTipo;
  cor?: string;
}

export async function criarRegistroEntrada(params: CriarRegistroParams): Promise<string> {
  const id = generateUUID();
  const timestamp = now();

  try {
    // Buscar cor do local se não fornecida
    let cor = params.cor;
    if (!cor) {
      const local = await getLocalById(params.localId);
      cor = local?.cor || '#3B82F6';
    }

    db.runSync(
      `INSERT INTO registros (id, user_id, local_id, local_nome, entrada, tipo, cor, pausa_minutos, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        id,
        params.userId,
        params.localId,
        params.localNome,
        timestamp,
        params.tipo || 'automatico',
        cor,
        timestamp
      ]
    );

    // Log de sync
    await registrarSyncLog(params.userId, 'registro', id, 'create', null, params);

    // NOVO: Incrementa telemetria
    if (params.tipo === 'manual') {
      await incrementarTelemetria(params.userId, 'manual_entries_count');
    } else {
      await incrementarTelemetria(params.userId, 'geofence_entries_count');
    }

    logger.info('database', `📥 Registro criado: ${params.localNome}`, { id });
    return id;
  } catch (error) {
    logger.error('database', 'Erro ao criar registro', { error: String(error) });
    throw error;
  }
}

export async function registrarSaida(
  userId: string,
  localId: string,
  ajusteMinutos: number = 0
): Promise<void> {
  try {
    // Busca sessão ativa para este local
    const sessao = db.getFirstSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND local_id = ? AND saida IS NULL ORDER BY entrada DESC LIMIT 1`,
      [userId, localId]
    );

    if (!sessao) {
      throw new Error('Nenhuma sessão ativa encontrada para este local');
    }

    // Calcular saída com ajuste
    let saidaTime = new Date();
    if (ajusteMinutos > 0) {
      saidaTime = new Date(saidaTime.getTime() - ajusteMinutos * 60000);
    }

    db.runSync(
      `UPDATE registros SET saida = ?, synced_at = NULL WHERE id = ?`,
      [saidaTime.toISOString(), sessao.id]
    );

    // Log de sync
    await registrarSyncLog(userId, 'registro', sessao.id, 'update', 
      { saida: null }, 
      { saida: saidaTime.toISOString() }
    );

    logger.info('database', `📤 Saída registrada`, { id: sessao.id, ajusteMinutos });
  } catch (error) {
    logger.error('database', 'Erro ao registrar saída', { error: String(error) });
    throw error;
  }
}

export async function getSessaoAberta(userId: string, localId: string): Promise<RegistroDB | null> {
  try {
    return db.getFirstSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND local_id = ? AND saida IS NULL ORDER BY entrada DESC LIMIT 1`,
      [userId, localId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar sessão aberta', { error: String(error) });
    return null;
  }
}

export async function getSessaoAtivaGlobal(userId: string): Promise<SessaoComputada | null> {
  try {
    const sessao = db.getFirstSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND saida IS NULL ORDER BY entrada DESC LIMIT 1`,
      [userId]
    );

    if (!sessao) return null;

    return {
      ...sessao,
      status: 'ativa',
      duracao_minutos: calcularDuracao(sessao.entrada, null),
    };
  } catch (error) {
    logger.error('database', 'Erro ao buscar sessão ativa global', { error: String(error) });
    return null;
  }
}

export async function getSessoesHoje(userId: string): Promise<SessaoComputada[]> {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);

    const sessoes = db.getAllSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND entrada >= ? AND entrada < ? ORDER BY entrada DESC`,
      [userId, hoje.toISOString(), amanha.toISOString()]
    );

    return sessoes.map(s => ({
      ...s,
      status: s.saida ? 'finalizada' : 'ativa',
      duracao_minutos: calcularDuracao(s.entrada, s.saida),
    })) as SessaoComputada[];
  } catch (error) {
    logger.error('database', 'Erro ao buscar sessões de hoje', { error: String(error) });
    return [];
  }
}

export async function getSessoesPorPeriodo(
  userId: string,
  dataInicio: string,
  dataFim: string
): Promise<SessaoComputada[]> {
  try {
    const sessoes = db.getAllSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND entrada >= ? AND entrada <= ? ORDER BY entrada ASC`,
      [userId, dataInicio, dataFim]
    );

    return sessoes.map(s => ({
      ...s,
      status: s.saida ? 'finalizada' : 'ativa',
      duracao_minutos: calcularDuracao(s.entrada, s.saida),
    })) as SessaoComputada[];
  } catch (error) {
    logger.error('database', 'Erro ao buscar sessões por período', { error: String(error) });
    return [];
  }
}

export async function getEstatisticasHoje(userId: string): Promise<EstatisticasDia> {
  try {
    const sessoes = await getSessoesHoje(userId);
    const finalizadas = sessoes.filter(s => s.saida);
    
    // Calcula total considerando pausas
    let totalMinutos = 0;
    for (const s of finalizadas) {
      const duracao = calcularDuracao(s.entrada, s.saida);
      const pausa = s.pausa_minutos || 0;
      totalMinutos += Math.max(0, duracao - pausa);
    }

    return {
      total_minutos: totalMinutos,
      total_sessoes: finalizadas.length,
    };
  } catch (error) {
    logger.error('database', 'Erro ao calcular estatísticas', { error: String(error) });
    return { total_minutos: 0, total_sessoes: 0 };
  }
}

// ============================================
// SYNC - Funções para sincronização
// ============================================

export async function getLocaisParaSync(userId: string): Promise<LocalDB[]> {
  try {
    return db.getAllSync<LocalDB>(
      `SELECT * FROM locais WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar locais para sync', { error: String(error) });
    return [];
  }
}

export async function getRegistrosParaSync(userId: string): Promise<RegistroDB[]> {
  try {
    return db.getAllSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar registros para sync', { error: String(error) });
    return [];
  }
}

export async function marcarLocalSincronizado(id: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE locais SET synced_at = ? WHERE id = ?`,
      [now(), id]
    );
  } catch (error) {
    logger.error('database', 'Erro ao marcar local sincronizado', { error: String(error) });
  }
}

export async function marcarRegistroSincronizado(id: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE registros SET synced_at = ? WHERE id = ?`,
      [now(), id]
    );
  } catch (error) {
    logger.error('database', 'Erro ao marcar registro sincronizado', { error: String(error) });
  }
}

/**
 * Upsert de local vindo do Supabase
 */
export async function upsertLocalFromSync(local: LocalDB): Promise<void> {
  try {
    const existente = db.getFirstSync<LocalDB>(
      `SELECT * FROM locais WHERE id = ?`,
      [local.id]
    );

    if (existente) {
      // Só atualiza se a versão do servidor é mais recente
      if (new Date(local.updated_at) > new Date(existente.updated_at)) {
        db.runSync(
          `UPDATE locais SET nome = ?, latitude = ?, longitude = ?, raio = ?, cor = ?, status = ?, 
           deleted_at = ?, updated_at = ?, synced_at = ? WHERE id = ?`,
          [local.nome, local.latitude, local.longitude, local.raio, local.cor, local.status,
           local.deleted_at, local.updated_at, now(), local.id]
        );
        logger.debug('sync', `Local atualizado do servidor: ${local.nome}`);
      }
    } else {
      // Insert novo
      db.runSync(
        `INSERT INTO locais (id, user_id, nome, latitude, longitude, raio, cor, status, deleted_at, 
         last_seen_at, created_at, updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [local.id, local.user_id, local.nome, local.latitude, local.longitude, local.raio, 
         local.cor, local.status, local.deleted_at, now(), local.created_at, local.updated_at, now()]
      );
      logger.debug('sync', `Local inserido do servidor: ${local.nome}`);
    }
  } catch (error) {
    logger.error('database', 'Erro no upsert de local', { error: String(error) });
  }
}

/**
 * Upsert de registro vindo do Supabase
 */
export async function upsertRegistroFromSync(registro: RegistroDB): Promise<void> {
  try {
    const existente = db.getFirstSync<RegistroDB>(
      `SELECT * FROM registros WHERE id = ?`,
      [registro.id]
    );

    if (existente) {
      // Atualiza se mudou
      db.runSync(
        `UPDATE registros SET saida = ?, editado_manualmente = ?, motivo_edicao = ?, pausa_minutos = ?, synced_at = ? WHERE id = ?`,
        [registro.saida, registro.editado_manualmente, registro.motivo_edicao, registro.pausa_minutos || 0, now(), registro.id]
      );
    } else {
      db.runSync(
        `INSERT INTO registros (id, user_id, local_id, local_nome, entrada, saida, tipo, 
         editado_manualmente, motivo_edicao, cor, device_id, pausa_minutos, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [registro.id, registro.user_id, registro.local_id, registro.local_nome, registro.entrada,
         registro.saida, registro.tipo, registro.editado_manualmente, registro.motivo_edicao,
         registro.cor, registro.device_id, registro.pausa_minutos || 0, registro.created_at, now()]
      );
    }
  } catch (error) {
    logger.error('database', 'Erro no upsert de registro', { error: String(error) });
  }
}

// ============================================
// DEBUG - Funções para DevMonitor
// ============================================

/**
 * Retorna contagem de registros em cada tabela
 */
export async function getDbStats(): Promise<{
  locais_total: number;
  locais_ativos: number;
  locais_deletados: number;
  registros_total: number;
  registros_abertos: number;
  sync_logs: number;
  geopontos_total: number;
  telemetry_days: number;
}> {
  try {
    const locaisTotal = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locais`);
    const locaisAtivos = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locais WHERE status = 'active'`);
    const locaisDeletados = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locais WHERE status = 'deleted'`);
    const registrosTotal = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM registros`);
    const registrosAbertos = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM registros WHERE saida IS NULL`);
    const syncLogs = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM sync_log`);
    const geopontosTotal = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM geopontos`);
    const telemetryDays = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM telemetry_daily`);

    return {
      locais_total: locaisTotal?.count || 0,
      locais_ativos: locaisAtivos?.count || 0,
      locais_deletados: locaisDeletados?.count || 0,
      registros_total: registrosTotal?.count || 0,
      registros_abertos: registrosAbertos?.count || 0,
      sync_logs: syncLogs?.count || 0,
      geopontos_total: geopontosTotal?.count || 0,
      telemetry_days: telemetryDays?.count || 0,
    };
  } catch (error) {
    logger.error('database', 'Erro ao obter stats', { error: String(error) });
    return {
      locais_total: 0,
      locais_ativos: 0,
      locais_deletados: 0,
      registros_total: 0,
      registros_abertos: 0,
      sync_logs: 0,
      geopontos_total: 0,
      telemetry_days: 0,
    };
  }
}

/**
 * Limpa todos os dados locais (NUCLEAR OPTION)
 */
export async function resetDatabase(): Promise<void> {
  try {
    logger.warn('database', '⚠️ RESET DATABASE - Limpando todos os dados locais');
    db.execSync(`DELETE FROM sync_log`);
    db.execSync(`DELETE FROM registros`);
    db.execSync(`DELETE FROM locais`);
    db.execSync(`DELETE FROM geopontos`);
    db.execSync(`DELETE FROM heartbeat_log`);
    db.execSync(`DELETE FROM telemetry_daily`);
    logger.info('database', '✅ Database resetado');
  } catch (error) {
    logger.error('database', 'Erro ao resetar database', { error: String(error) });
    throw error;
  }
}

// ============================================
// HEARTBEAT LOG (LEGADO - manter por enquanto)
// ============================================

/**
 * Registra um heartbeat
 * NOTA: Esta função será substituída por incrementarTelemetria no Passo 3
 */
export async function registrarHeartbeat(
  userId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  insideFence: boolean,
  fenceId: string | null,
  fenceName: string | null,
  sessaoId: string | null,
  batteryLevel: number | null
): Promise<string> {
  const id = generateUUID();
  const timestamp = now();
  
  try {
    db.runSync(
      `INSERT INTO heartbeat_log (id, user_id, timestamp, latitude, longitude, accuracy, 
       inside_fence, fence_id, fence_name, sessao_id, battery_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, timestamp, latitude, longitude, accuracy, 
       insideFence ? 1 : 0, fenceId, fenceName, sessaoId, batteryLevel, timestamp]
    );
    
    // NOVO: Também incrementa telemetria agregada
    await incrementarTelemetriaHeartbeat(userId, insideFence, batteryLevel);
    
    logger.debug('heartbeat', 'Heartbeat registrado', { id, insideFence, fenceId });
    return id;
  } catch (error) {
    logger.error('database', 'Erro ao registrar heartbeat', { error: String(error) });
    throw error;
  }
}

/**
 * Busca último heartbeat de uma sessão
 */
export async function getUltimoHeartbeatSessao(sessaoId: string): Promise<HeartbeatLogDB | null> {
  try {
    return db.getFirstSync<HeartbeatLogDB>(
      `SELECT * FROM heartbeat_log WHERE sessao_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [sessaoId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar último heartbeat', { error: String(error) });
    return null;
  }
}

/**
 * Busca último heartbeat do usuário (qualquer sessão)
 */
export async function getUltimoHeartbeat(userId: string): Promise<HeartbeatLogDB | null> {
  try {
    return db.getFirstSync<HeartbeatLogDB>(
      `SELECT * FROM heartbeat_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar último heartbeat', { error: String(error) });
    return null;
  }
}

/**
 * Busca heartbeats por período
 */
export async function getHeartbeatsPorPeriodo(
  userId: string,
  dataInicio: string,
  dataFim: string
): Promise<HeartbeatLogDB[]> {
  try {
    return db.getAllSync<HeartbeatLogDB>(
      `SELECT * FROM heartbeat_log WHERE user_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`,
      [userId, dataInicio, dataFim]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar heartbeats', { error: String(error) });
    return [];
  }
}

/**
 * Limpa heartbeats antigos (mais de X dias)
 */
export async function limparHeartbeatsAntigos(diasManter: number = 30): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - diasManter);
    
    const result = db.runSync(
      `DELETE FROM heartbeat_log WHERE timestamp < ?`,
      [cutoff.toISOString()]
    );
    
    const deletados = result.changes || 0;
    if (deletados > 0) {
      logger.info('database', `Heartbeats antigos limpos: ${deletados}`);
    }
    return deletados;
  } catch (error) {
    logger.error('database', 'Erro ao limpar heartbeats', { error: String(error) });
    return 0;
  }
}

/**
 * Conta heartbeats (para stats)
 */
export async function getHeartbeatStats(userId: string): Promise<{
  total: number;
  hoje: number;
  ultimoTimestamp: string | null;
}> {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    
    const total = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM heartbeat_log WHERE user_id = ?`,
      [userId]
    );
    
    const hojeCount = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM heartbeat_log WHERE user_id = ? AND timestamp LIKE ?`,
      [userId, `${hoje}%`]
    );
    
    const ultimo = db.getFirstSync<{ timestamp: string }>(
      `SELECT timestamp FROM heartbeat_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [userId]
    );
    
    return {
      total: total?.count || 0,
      hoje: hojeCount?.count || 0,
      ultimoTimestamp: ultimo?.timestamp || null,
    };
  } catch (error) {
    logger.error('database', 'Erro ao obter stats de heartbeat', { error: String(error) });
    return { total: 0, hoje: 0, ultimoTimestamp: null };
  }
}

// ============================================
// GEOPONTOS (Auditoria GPS)
// ============================================

/**
 * Registra um geoponto (leitura GPS)
 */
export async function registrarGeoponto(
  userId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  fonte: GeopontoFonte,
  dentroFence: boolean,
  fenceId: string | null,
  fenceNome: string | null,
  sessaoId: string | null
): Promise<string> {
  const id = generateUUID();
  const timestamp = now();
  
  try {
    db.runSync(
      `INSERT INTO geopontos (id, sessao_id, user_id, latitude, longitude, accuracy, 
       timestamp, fonte, dentro_fence, fence_id, fence_nome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessaoId, userId, latitude, longitude, accuracy, 
       timestamp, fonte, dentroFence ? 1 : 0, fenceId, fenceNome, timestamp]
    );
    
    // NOVO: Incrementa telemetria de geofence se for trigger
    if (fonte === 'geofence') {
      await incrementarTelemetriaGeofence(userId, accuracy);
    } else if (fonte === 'background') {
      await incrementarTelemetria(userId, 'background_location_checks');
    }
    
    logger.debug('database', 'Geoponto registrado', { 
      id, 
      fonte, 
      dentroFence, 
      accuracy: accuracy?.toFixed(0) 
    });
    return id;
  } catch (error) {
    logger.error('database', 'Erro ao registrar geoponto', { error: String(error) });
    throw error;
  }
}

/**
 * Busca geopontos de uma sessão específica
 */
export async function getGeopontosSessao(sessaoId: string): Promise<GeopontoDB[]> {
  try {
    return db.getAllSync<GeopontoDB>(
      `SELECT * FROM geopontos WHERE sessao_id = ? ORDER BY timestamp ASC`,
      [sessaoId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar geopontos da sessão', { error: String(error) });
    return [];
  }
}

/**
 * Busca geopontos por período
 */
export async function getGeopontosPorPeriodo(
  userId: string,
  dataInicio: string,
  dataFim: string
): Promise<GeopontoDB[]> {
  try {
    return db.getAllSync<GeopontoDB>(
      `SELECT * FROM geopontos WHERE user_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`,
      [userId, dataInicio, dataFim]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar geopontos por período', { error: String(error) });
    return [];
  }
}

/**
 * Busca último geoponto do usuário
 */
export async function getUltimoGeoponto(userId: string): Promise<GeopontoDB | null> {
  try {
    return db.getFirstSync<GeopontoDB>(
      `SELECT * FROM geopontos WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar último geoponto', { error: String(error) });
    return null;
  }
}

/**
 * Limpa geopontos antigos (mais de X dias)
 */
export async function limparGeopontosAntigos(diasManter: number = 90): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - diasManter);
    
    const result = db.runSync(
      `DELETE FROM geopontos WHERE timestamp < ?`,
      [cutoff.toISOString()]
    );
    
    const deletados = result.changes || 0;
    if (deletados > 0) {
      logger.info('database', `Geopontos antigos limpos: ${deletados}`);
    }
    return deletados;
  } catch (error) {
    logger.error('database', 'Erro ao limpar geopontos', { error: String(error) });
    return 0;
  }
}

/**
 * Estatísticas de geopontos
 */
export async function getGeopontosStats(userId: string): Promise<{
  total: number;
  hoje: number;
  porFonte: Record<GeopontoFonte, number>;
  ultimoTimestamp: string | null;
}> {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    
    const total = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM geopontos WHERE user_id = ?`,
      [userId]
    );
    
    const hojeCount = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM geopontos WHERE user_id = ? AND timestamp LIKE ?`,
      [userId, `${hoje}%`]
    );
    
    const ultimo = db.getFirstSync<{ timestamp: string }>(
      `SELECT timestamp FROM geopontos WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [userId]
    );

    // Conta por fonte
    const fontes: GeopontoFonte[] = ['polling', 'geofence', 'heartbeat', 'background', 'manual'];
    const porFonte: Record<GeopontoFonte, number> = {
      polling: 0,
      geofence: 0,
      heartbeat: 0,
      background: 0,
      manual: 0,
    };

    for (const fonte of fontes) {
      const count = db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) as count FROM geopontos WHERE user_id = ? AND fonte = ?`,
        [userId, fonte]
      );
      porFonte[fonte] = count?.count || 0;
    }
    
    return {
      total: total?.count || 0,
      hoje: hojeCount?.count || 0,
      porFonte,
      ultimoTimestamp: ultimo?.timestamp || null,
    };
  } catch (error) {
    logger.error('database', 'Erro ao obter stats de geopontos', { error: String(error) });
    return { 
      total: 0, 
      hoje: 0, 
      porFonte: { polling: 0, geofence: 0, heartbeat: 0, background: 0, manual: 0 },
      ultimoTimestamp: null 
    };
  }
}

/**
 * Busca geopontos para sync (não sincronizados)
 */
export async function getGeopontosParaSync(userId: string, limit: number = 100): Promise<GeopontoDB[]> {
  try {
    return db.getAllSync<GeopontoDB>(
      `SELECT * FROM geopontos WHERE user_id = ? AND synced_at IS NULL ORDER BY timestamp ASC LIMIT ?`,
      [userId, limit]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar geopontos para sync', { error: String(error) });
    return [];
  }
}

/**
 * Marca geopontos como sincronizados
 */
export async function marcarGeopontosSincronizados(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  
  try {
    const placeholders = ids.map(() => '?').join(',');
    db.runSync(
      `UPDATE geopontos SET synced_at = ? WHERE id IN (${placeholders})`,
      [now(), ...ids]
    );
    logger.debug('database', `${ids.length} geopontos marcados como sincronizados`);
  } catch (error) {
    logger.error('database', 'Erro ao marcar geopontos sincronizados', { error: String(error) });
  }
}


// ============================================
// NOVO: TELEMETRIA DIÁRIA AGREGADA
// ============================================

/**
 * Garante que existe uma row para hoje
 */
function ensureTodayTelemetry(userId: string): void {
  const today = getToday();
  
  try {
    db.runSync(
      `INSERT OR IGNORE INTO telemetry_daily (date, user_id, created_at) VALUES (?, ?, ?)`,
      [today, userId, now()]
    );
  } catch (error) {
    // Ignora erro se já existe
    logger.debug('telemetry', 'Row de hoje já existe ou erro ao criar');
  }
}

/**
 * Incrementa um campo de telemetria do dia
 */
export async function incrementarTelemetria(
  userId: string,
  campo: 'app_opens' | 'manual_entries_count' | 'geofence_entries_count' | 
         'geofence_triggers' | 'background_location_checks' | 
         'offline_entries_count' | 'sync_attempts' | 'sync_failures'
): Promise<void> {
  try {
    ensureTodayTelemetry(userId);
    const today = getToday();
    
    db.runSync(
      `UPDATE telemetry_daily SET ${campo} = ${campo} + 1, synced_at = NULL WHERE date = ? AND user_id = ?`,
      [today, userId]
    );
    
    logger.debug('telemetry', `Incrementado: ${campo}`);
  } catch (error) {
    logger.error('telemetry', `Erro ao incrementar ${campo}`, { error: String(error) });
  }
}

/**
 * Incrementa telemetria específica de geofence (com accuracy)
 */
export async function incrementarTelemetriaGeofence(
  userId: string,
  accuracy: number | null
): Promise<void> {
  try {
    ensureTodayTelemetry(userId);
    const today = getToday();
    
    if (accuracy !== null && accuracy > 0) {
      db.runSync(
        `UPDATE telemetry_daily SET 
          geofence_triggers = geofence_triggers + 1,
          geofence_accuracy_sum = geofence_accuracy_sum + ?,
          geofence_accuracy_count = geofence_accuracy_count + 1,
          synced_at = NULL
        WHERE date = ? AND user_id = ?`,
        [accuracy, today, userId]
      );
    } else {
      db.runSync(
        `UPDATE telemetry_daily SET geofence_triggers = geofence_triggers + 1, synced_at = NULL WHERE date = ? AND user_id = ?`,
        [today, userId]
      );
    }
  } catch (error) {
    logger.error('telemetry', 'Erro ao incrementar geofence telemetry', { error: String(error) });
  }
}

/**
 * Incrementa telemetria de heartbeat (agregado)
 */
export async function incrementarTelemetriaHeartbeat(
  userId: string,
  insideFence: boolean,
  batteryLevel: number | null
): Promise<void> {
  try {
    ensureTodayTelemetry(userId);
    const today = getToday();
    
    if (batteryLevel !== null) {
      db.runSync(
        `UPDATE telemetry_daily SET 
          heartbeat_count = heartbeat_count + 1,
          heartbeat_inside_fence_count = heartbeat_inside_fence_count + ?,
          battery_level_sum = battery_level_sum + ?,
          battery_level_count = battery_level_count + 1,
          synced_at = NULL
        WHERE date = ? AND user_id = ?`,
        [insideFence ? 1 : 0, batteryLevel, today, userId]
      );
    } else {
      db.runSync(
        `UPDATE telemetry_daily SET 
          heartbeat_count = heartbeat_count + 1,
          heartbeat_inside_fence_count = heartbeat_inside_fence_count + ?,
          synced_at = NULL
        WHERE date = ? AND user_id = ?`,
        [insideFence ? 1 : 0, today, userId]
      );
    }
  } catch (error) {
    logger.error('telemetry', 'Erro ao incrementar heartbeat telemetry', { error: String(error) });
  }
}

/**
 * Busca telemetria de hoje
 */
export async function getTelemetriaHoje(userId: string): Promise<TelemetryDailyDB | null> {
  try {
    return db.getFirstSync<TelemetryDailyDB>(
      `SELECT * FROM telemetry_daily WHERE date = ? AND user_id = ?`,
      [getToday(), userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Erro ao buscar telemetria de hoje', { error: String(error) });
    return null;
  }
}

/**
 * Busca telemetria para sync (não sincronizada)
 */
export async function getTelemetriaParaSync(userId: string): Promise<TelemetryDailyDB[]> {
  try {
    return db.getAllSync<TelemetryDailyDB>(
      `SELECT * FROM telemetry_daily WHERE user_id = ? AND synced_at IS NULL ORDER BY date ASC`,
      [userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Erro ao buscar telemetria para sync', { error: String(error) });
    return [];
  }
}

/**
 * Marca telemetria como sincronizada
 */
export async function marcarTelemetriaSincronizada(date: string, userId: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE telemetry_daily SET synced_at = ? WHERE date = ? AND user_id = ?`,
      [now(), date, userId]
    );
  } catch (error) {
    logger.error('telemetry', 'Erro ao marcar telemetria sincronizada', { error: String(error) });
  }
}

/**
 * Limpa telemetria antiga (mais de X dias, só se já sincronizada)
 */
export async function limparTelemetriaAntiga(diasManter: number = 7): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - diasManter);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    const result = db.runSync(
      `DELETE FROM telemetry_daily WHERE date < ? AND synced_at IS NOT NULL`,
      [cutoffStr]
    );
    
    const deletados = result.changes || 0;
    if (deletados > 0) {
      logger.info('telemetry', `Telemetria antiga limpa: ${deletados} dias`);
    }
    return deletados;
  } catch (error) {
    logger.error('telemetry', 'Erro ao limpar telemetria antiga', { error: String(error) });
    return 0;
  }
}

/**
 * Stats de telemetria para debug
 */
export async function getTelemetriaStats(userId: string): Promise<{
  diasPendentes: number;
  diasSincronizados: number;
  hoje: TelemetryDailyDB | null;
}> {
  try {
    const pendentes = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM telemetry_daily WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
    
    const sincronizados = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) as count FROM telemetry_daily WHERE user_id = ? AND synced_at IS NOT NULL`,
      [userId]
    );
    
    const hoje = await getTelemetriaHoje(userId);
    
    return {
      diasPendentes: pendentes?.count || 0,
      diasSincronizados: sincronizados?.count || 0,
      hoje,
    };
  } catch (error) {
    logger.error('telemetry', 'Erro ao obter stats de telemetria', { error: String(error) });
    return { diasPendentes: 0, diasSincronizados: 0, hoje: null };
  }
}
