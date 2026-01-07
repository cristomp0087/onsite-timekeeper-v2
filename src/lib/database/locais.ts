/**
 * Database - Locais (Geofences)
 * 
 * CRUD de locais e funções de sync
 * 
 * MODIFICADO:
 * - upsertLocalFromSync não insere locais já deletados no servidor
 */

import { logger } from '../logger';
import {
  db,
  generateUUID,
  now,
  registrarSyncLog,
  type LocalDB,
} from './core';

// ============================================
// TIPOS
// ============================================

export interface CriarLocalParams {
  userId: string;
  nome: string;
  latitude: number;
  longitude: number;
  raio?: number;
  cor?: string;
}

// ============================================
// CRUD
// ============================================

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
    const values: (string | number | null)[] = [];

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
// SYNC
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
 * Upsert de local vindo do Supabase
 * 
 * REGRAS:
 * - Se local JÁ EXISTE localmente → atualiza (inclusive se status='deleted')
 * - Se local NÃO EXISTE E status='deleted' → NÃO INSERIR (era de outro device, já foi deletado)
 * - Se local NÃO EXISTE E status='active' → inserir normalmente
 */
export async function upsertLocalFromSync(local: LocalDB): Promise<void> {
  try {
    const existente = db.getFirstSync<LocalDB>(
      `SELECT * FROM locais WHERE id = ?`,
      [local.id]
    );

    if (existente) {
      // ============================================
      // CASO 1: Local já existe localmente
      // Atualiza se versão do servidor é mais recente
      // ============================================
      if (new Date(local.updated_at) > new Date(existente.updated_at)) {
        db.runSync(
          `UPDATE locais SET nome = ?, latitude = ?, longitude = ?, raio = ?, cor = ?, status = ?, 
           deleted_at = ?, updated_at = ?, synced_at = ? WHERE id = ?`,
          [local.nome, local.latitude, local.longitude, local.raio, local.cor, local.status,
           local.deleted_at, local.updated_at, now(), local.id]
        );
        logger.debug('sync', `Local atualizado do servidor: ${local.nome} (status: ${local.status})`);
      }
    } else {
      // ============================================
      // CASO 2: Local NÃO existe localmente
      // ============================================
      
      // Se já está deletado no servidor, NÃO INSERIR
      // Isso evita que locais deletados "voltem" após reinstalar o app
      if (local.status === 'deleted') {
        logger.debug('sync', `⏭️ Local ignorado (já deletado no servidor): ${local.nome}`);
        return;
      }
      
      // Insert novo (só se status = 'active')
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
