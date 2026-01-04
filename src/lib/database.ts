/**
 * Database SQLite - OnSite Timekeeper
 * 
 * Source of truth local (offline-first)
 * - CRUD de locais
 * - CRUD de registros (sessões)
 * - Auditoria via sync_log
 * - Validações de negócio
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

// 1. ADICIONAR ESTE TIPO junto com os outros tipos (linha ~70):

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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      )
    `);

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

     // Tabela de heartbeat logs
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

/**
 * Cria um novo local de trabalho
 * - Valida distância mínima de 50m para outros locais ativos
 * - Valida nome único (case insensitive)
 */
export async function criarLocal(params: CriarLocalParams): Promise<string> {
  const { userId, nome, latitude, longitude, raio = 100, cor = '#3B82F6' } = params;
  const id = generateUUID();
  const timestamp = now();

  try {
    // Validação 1: Distância mínima de 50m
    const locaisAtivos = db.getAllSync<LocalDB>(
      `SELECT * FROM locais WHERE user_id = ? AND status = 'active'`,
      [userId]
    );

    for (const local of locaisAtivos) {
      const distancia = calcularDistancia(latitude, longitude, local.latitude, local.longitude);
      if (distancia < 50) {
        const erro = `Muito próximo de "${local.nome}" (${distancia.toFixed(0)}m). Mínimo: 50m`;
        logger.warn('database', erro);
        throw new Error(erro);
      }
    }

    // Validação 2: Nome único
    const nomeDuplicado = locaisAtivos.find(
      l => l.nome.toLowerCase() === nome.toLowerCase()
    );
    if (nomeDuplicado) {
      throw new Error(`Já existe um local com o nome "${nome}"`);
    }

    // Insert
    db.runSync(
      `INSERT INTO locais (id, user_id, nome, latitude, longitude, raio, cor, status, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [id, userId, nome, latitude, longitude, raio, cor, timestamp, timestamp, timestamp]
    );

    // Auditoria
    await registrarSyncLog(userId, 'local', id, 'create', null, {
      id, nome, latitude, longitude, raio, cor, status: 'active'
    });

    logger.info('database', `✅ Local criado: ${nome}`, { id });
    return id;
  } catch (error) {
    logger.error('database', 'Erro ao criar local', { error: String(error) });
    throw error;
  }
}

/**
 * Retorna todos os locais ativos do usuário
 */
export async function getLocaisAtivos(userId: string): Promise<LocalDB[]> {
  try {
    const locais = db.getAllSync<LocalDB>(
      `SELECT * FROM locais WHERE user_id = ? AND status = 'active' ORDER BY nome`,
      [userId]
    );
    
    // Atualiza last_seen_at
    if (locais.length > 0) {
      const ids = locais.map(l => `'${l.id}'`).join(',');
      db.runSync(
        `UPDATE locais SET last_seen_at = ? WHERE id IN (${ids})`,
        [now()]
      );
    }

    logger.debug('database', `${locais.length} locais ativos carregados`);
    return locais;
  } catch (error) {
    logger.error('database', 'Erro ao buscar locais', { error: String(error) });
    return [];
  }
}

/**
 * Retorna TODOS os locais (incluindo deletados) - para debug
 */
export async function getTodosLocais(userId: string): Promise<LocalDB[]> {
  try {
    return db.getAllSync<LocalDB>(
      `SELECT * FROM locais WHERE user_id = ? ORDER BY status, nome`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar todos locais', { error: String(error) });
    return [];
  }
}

/**
 * Busca local por ID
 */
export async function getLocalById(id: string): Promise<LocalDB | null> {
  try {
    return db.getFirstSync<LocalDB>(
      `SELECT * FROM locais WHERE id = ?`,
      [id]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar local', { error: String(error) });
    return null;
  }
}

/**
 * Atualiza um local
 */
export async function atualizarLocal(
  id: string,
  userId: string,
  updates: Partial<Pick<LocalDB, 'nome' | 'latitude' | 'longitude' | 'raio' | 'cor'>>
): Promise<void> {
  try {
    const localAtual = await getLocalById(id);
    if (!localAtual) {
      throw new Error('Local não encontrado');
    }

    const campos: string[] = [];
    const valores: unknown[] = [];

    if (updates.nome !== undefined) {
      campos.push('nome = ?');
      valores.push(updates.nome);
    }
    if (updates.latitude !== undefined) {
      campos.push('latitude = ?');
      valores.push(updates.latitude);
    }
    if (updates.longitude !== undefined) {
      campos.push('longitude = ?');
      valores.push(updates.longitude);
    }
    if (updates.raio !== undefined) {
      campos.push('raio = ?');
      valores.push(updates.raio);
    }
    if (updates.cor !== undefined) {
      campos.push('cor = ?');
      valores.push(updates.cor);
    }

    if (campos.length === 0) return;

    campos.push('updated_at = ?', 'synced_at = NULL');
    valores.push(now(), id);

    db.runSync(
      `UPDATE locais SET ${campos.join(', ')} WHERE id = ?`,
      valores
    );

    // Auditoria
    await registrarSyncLog(userId, 'local', id, 'update', localAtual, {
      ...localAtual,
      ...updates,
      updated_at: now()
    });

    logger.info('database', `✅ Local atualizado: ${localAtual.nome}`, { id });
  } catch (error) {
    logger.error('database', 'Erro ao atualizar local', { error: String(error) });
    throw error;
  }
}

/**
 * Soft delete de local (marca como deleted)
 */
export async function deletarLocal(id: string, userId: string): Promise<void> {
  try {
    const local = await getLocalById(id);
    if (!local) {
      throw new Error('Local não encontrado');
    }

    db.runSync(
      `UPDATE locais SET status = 'deleted', deleted_at = ?, updated_at = ?, synced_at = NULL WHERE id = ?`,
      [now(), now(), id]
    );

    // Auditoria
    await registrarSyncLog(userId, 'local', id, 'delete', local, {
      ...local,
      status: 'deleted',
      deleted_at: now()
    });

    logger.info('database', `🗑️ Local deletado: ${local.nome}`, { id });
  } catch (error) {
    logger.error('database', 'Erro ao deletar local', { error: String(error) });
    throw error;
  }
}

/**
 * Hard delete de locais deletados há mais de X dias
 */
export async function purgeLocaisDeletados(dias: number = 7): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
    
    const result = db.runSync(
      `DELETE FROM locais WHERE status = 'deleted' AND deleted_at < ?`,
      [cutoff]
    );

    const count = result.changes;
    if (count > 0) {
      logger.info('database', `🧹 Purge: ${count} locais removidos permanentemente`);
    }
    return count;
  } catch (error) {
    logger.error('database', 'Erro no purge de locais', { error: String(error) });
    return 0;
  }
}

// ============================================
// REGISTROS (Sessões) - CRUD
// ============================================

export interface CriarRegistroParams {
  userId: string;
  localId: string;
  localNome: string;
  tipo?: RegistroTipo;
  cor?: string;
  deviceId?: string;
}

/**
 * Cria registro de entrada (inicia sessão)
 */
export async function criarRegistroEntrada(params: CriarRegistroParams): Promise<string> {
  const { userId, localId, localNome, tipo = 'automatico', cor, deviceId } = params;
  const id = generateUUID();
  const timestamp = now();

  try {
    db.runSync(
      `INSERT INTO registros (id, user_id, local_id, local_nome, entrada, tipo, cor, device_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, localId, localNome, timestamp, tipo, cor, deviceId, timestamp]
    );

    // Auditoria
    await registrarSyncLog(userId, 'registro', id, 'create', null, {
      id, local_id: localId, local_nome: localNome, entrada: timestamp, tipo
    });

    logger.info('session', `▶️ Entrada registrada: ${localNome}`, { id, localId });
    return id;
  } catch (error) {
    logger.error('database', 'Erro ao criar registro de entrada', { error: String(error) });
    throw error;
  }
}

/**
 * Registra saída (finaliza sessão)
 */
export async function registrarSaida(
  userId: string,
  localId: string,
  ajusteMinutos: number = 0
): Promise<string | null> {
  try {
    // Busca sessão aberta para este local
    const sessaoAberta = db.getFirstSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND local_id = ? AND saida IS NULL ORDER BY entrada DESC LIMIT 1`,
      [userId, localId]
    );

    if (!sessaoAberta) {
      logger.warn('database', 'Nenhuma sessão aberta para este local', { localId });
      return null;
    }

    // Calcula horário de saída (com ajuste se houver)
    const saidaTime = new Date(Date.now() + ajusteMinutos * 60000);
    const saida = saidaTime.toISOString();
    const editadoManualmente = ajusteMinutos !== 0 ? 1 : 0;

    db.runSync(
      `UPDATE registros SET saida = ?, editado_manualmente = ?, synced_at = NULL WHERE id = ?`,
      [saida, editadoManualmente, sessaoAberta.id]
    );

    // Auditoria
    await registrarSyncLog(userId, 'registro', sessaoAberta.id, 'update', sessaoAberta, {
      ...sessaoAberta,
      saida,
      editado_manualmente: editadoManualmente
    });

    logger.info('session', `⏹️ Saída registrada: ${sessaoAberta.local_nome}`, {
      id: sessaoAberta.id,
      ajuste: ajusteMinutos
    });

    return sessaoAberta.id;
  } catch (error) {
    logger.error('database', 'Erro ao registrar saída', { error: String(error) });
    throw error;
  }
}

/**
 * Busca sessão aberta (ativa) para um local
 */
export async function getSessaoAberta(userId: string, localId: string): Promise<SessaoComputada | null> {
  try {
    const row = db.getFirstSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND local_id = ? AND saida IS NULL ORDER BY entrada DESC LIMIT 1`,
      [userId, localId]
    );

    if (!row) return null;

    return {
      ...row,
      status: 'ativa',
      duracao_minutos: calcularDuracao(row.entrada, null)
    };
  } catch (error) {
    logger.error('database', 'Erro ao buscar sessão aberta', { error: String(error) });
    return null;
  }
}

/**
 * Busca qualquer sessão aberta do usuário (independente do local)
 */
export async function getSessaoAtivaGlobal(userId: string): Promise<SessaoComputada | null> {
  try {
    const row = db.getFirstSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND saida IS NULL ORDER BY entrada DESC LIMIT 1`,
      [userId]
    );

    if (!row) return null;

    return {
      ...row,
      status: 'ativa',
      duracao_minutos: calcularDuracao(row.entrada, null)
    };
  } catch (error) {
    logger.error('database', 'Erro ao buscar sessão global', { error: String(error) });
    return null;
  }
}

/**
 * Busca todas as sessões de hoje
 */
export async function getSessoesHoje(userId: string): Promise<SessaoComputada[]> {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const rows = db.getAllSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND entrada LIKE ? ORDER BY entrada DESC`,
      [userId, `${hoje}%`]
    );

    return rows.map(r => ({
      ...r,
      status: r.saida ? 'finalizada' : 'ativa',
      duracao_minutos: calcularDuracao(r.entrada, r.saida)
    }));
  } catch (error) {
    logger.error('database', 'Erro ao buscar sessões de hoje', { error: String(error) });
    return [];
  }
}

/**
 * Busca sessões por período
 */
export async function getSessoesPorPeriodo(
  userId: string,
  dataInicio: string,
  dataFim: string
): Promise<SessaoComputada[]> {
  try {
    const rows = db.getAllSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND entrada >= ? AND entrada <= ? ORDER BY entrada DESC`,
      [userId, dataInicio, dataFim]
    );

    return rows.map(r => ({
      ...r,
      status: r.saida ? 'finalizada' : 'ativa',
      duracao_minutos: calcularDuracao(r.entrada, r.saida)
    }));
  } catch (error) {
    logger.error('database', 'Erro ao buscar sessões por período', { error: String(error) });
    return [];
  }
}

/**
 * Calcula estatísticas do dia
 */
export async function getEstatisticasHoje(userId: string): Promise<EstatisticasDia> {
  try {
    const sessoes = await getSessoesHoje(userId);
    const finalizadas = sessoes.filter(s => s.saida !== null);
    const totalMinutos = finalizadas.reduce((acc, s) => acc + s.duracao_minutos, 0);

    return {
      total_minutos: totalMinutos,
      total_sessoes: finalizadas.length
    };
  } catch (error) {
    logger.error('database', 'Erro ao calcular estatísticas', { error: String(error) });
    return { total_minutos: 0, total_sessoes: 0 };
  }
}

// ============================================
// SYNC - Operações para sincronização
// ============================================

/**
 * Retorna locais pendentes de sync (synced_at = NULL)
 */
export async function getLocaisPendentesSync(userId: string): Promise<LocalDB[]> {
  try {
    return db.getAllSync<LocalDB>(
      `SELECT * FROM locais WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar locais pendentes', { error: String(error) });
    return [];
  }
}

/**
 * Retorna registros pendentes de sync
 */
export async function getRegistrosPendentesSync(userId: string): Promise<RegistroDB[]> {
  try {
    return db.getAllSync<RegistroDB>(
      `SELECT * FROM registros WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Erro ao buscar registros pendentes', { error: String(error) });
    return [];
  }
}

/**
 * Marca local como sincronizado
 */
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

/**
 * Marca registro como sincronizado
 */
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
    const existente = await getLocalById(local.id);

    if (existente) {
      // Só atualiza se o remoto for mais recente
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
        `UPDATE registros SET saida = ?, editado_manualmente = ?, motivo_edicao = ?, synced_at = ? WHERE id = ?`,
        [registro.saida, registro.editado_manualmente, registro.motivo_edicao, now(), registro.id]
      );
    } else {
      db.runSync(
        `INSERT INTO registros (id, user_id, local_id, local_nome, entrada, saida, tipo, 
         editado_manualmente, motivo_edicao, cor, device_id, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [registro.id, registro.user_id, registro.local_id, registro.local_nome, registro.entrada,
         registro.saida, registro.tipo, registro.editado_manualmente, registro.motivo_edicao,
         registro.cor, registro.device_id, registro.created_at, now()]
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
}> {
  try {
    const locaisTotal = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locais`);
    const locaisAtivos = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locais WHERE status = 'active'`);
    const locaisDeletados = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM locais WHERE status = 'deleted'`);
    const registrosTotal = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM registros`);
    const registrosAbertos = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM registros WHERE saida IS NULL`);
    const syncLogs = db.getFirstSync<{ count: number }>(`SELECT COUNT(*) as count FROM sync_log`);

    return {
      locais_total: locaisTotal?.count || 0,
      locais_ativos: locaisAtivos?.count || 0,
      locais_deletados: locaisDeletados?.count || 0,
      registros_total: registrosTotal?.count || 0,
      registros_abertos: registrosAbertos?.count || 0,
      sync_logs: syncLogs?.count || 0,
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
    logger.info('database', '✅ Database resetado');
  } catch (error) {
    logger.error('database', 'Erro ao resetar database', { error: String(error) });
    throw error;
  }
}

/**
 * Registra um heartbeat
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
