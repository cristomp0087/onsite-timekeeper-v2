/**
 * Database - Locations (Geofences)
 * 
 * CRUD for locations and sync functions
 */

import { logger } from '../logger';
import {
  db,
  generateUUID,
  now,
  type LocationDB,
} from './core';
import { trackMetric, trackFeatureUsed } from './analytics';

// ============================================
// TYPES
// ============================================

export interface CreateLocationParams {
  userId: string;
  name: string;
  latitude: number;
  longitude: number;
  radius?: number;
  color?: string;
}

// ============================================
// CRUD
// ============================================

export async function createLocation(params: CreateLocationParams): Promise<string> {
  const id = generateUUID();
  const timestamp = now();

  try {
    db.runSync(
      `INSERT INTO locations (id, user_id, name, latitude, longitude, radius, color, status, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.userId,
        params.name,
        params.latitude,
        params.longitude,
        params.radius || 100,
        params.color || '#3B82F6',
        'active',
        timestamp,
        timestamp,
        timestamp
      ]
    );

    // Track analytics
    try {
      await trackMetric(params.userId, 'locations_created');
      await trackFeatureUsed(params.userId, 'create_location');
    } catch (e) {
      // Ignore tracking errors
    }

    logger.info('database', `📍 Location created: ${params.name}`, { id });
    return id;
  } catch (error) {
    logger.error('database', 'Error creating location', { error: String(error) });
    throw error;
  }
}

export async function getLocations(userId: string): Promise<LocationDB[]> {
  try {
    return db.getAllSync<LocationDB>(
      `SELECT * FROM locations WHERE user_id = ? AND status = 'active' ORDER BY name ASC`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching locations', { error: String(error) });
    return [];
  }
}

export async function getLocationById(id: string): Promise<LocationDB | null> {
  try {
    return db.getFirstSync<LocationDB>(
      `SELECT * FROM locations WHERE id = ?`,
      [id]
    );
  } catch (error) {
    logger.error('database', 'Error fetching location by ID', { error: String(error) });
    return null;
  }
}

// BACKWARD COMPATIBLE: 2 args (id, updates)
export async function updateLocation(
  id: string,
  updates: Partial<Pick<LocationDB, 'name' | 'latitude' | 'longitude' | 'radius' | 'color'>>
): Promise<void> {
  try {
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.latitude !== undefined) {
      setClauses.push('latitude = ?');
      values.push(updates.latitude);
    }
    if (updates.longitude !== undefined) {
      setClauses.push('longitude = ?');
      values.push(updates.longitude);
    }
    if (updates.radius !== undefined) {
      setClauses.push('radius = ?');
      values.push(updates.radius);
    }
    if (updates.color !== undefined) {
      setClauses.push('color = ?');
      values.push(updates.color);
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = ?');
    values.push(now());

    setClauses.push('synced_at = NULL');

    values.push(id);

    db.runSync(
      `UPDATE locations SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    logger.info('database', `📍 Location updated: ${id}`, { updates });
  } catch (error) {
    logger.error('database', 'Error updating location', { error: String(error) });
    throw error;
  }
}

export async function removeLocation(userId: string, id: string): Promise<void> {
  try {
    // Soft delete
    db.runSync(
      `UPDATE locations SET status = 'deleted', deleted_at = ?, updated_at = ?, synced_at = NULL WHERE id = ? AND user_id = ?`,
      [now(), now(), id, userId]
    );

    // Track analytics
    try {
      await trackMetric(userId, 'locations_deleted');
      await trackFeatureUsed(userId, 'delete_location');
    } catch (e) {
      // Ignore tracking errors
    }

    logger.info('database', `🗑️ Location removed (soft): ${id}`);
  } catch (error) {
    logger.error('database', 'Error removing location', { error: String(error) });
    throw error;
  }
}

export async function updateLastSeen(id: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE locations SET last_seen_at = ? WHERE id = ?`,
      [now(), id]
    );
  } catch (error) {
    logger.error('database', 'Error updating last_seen', { error: String(error) });
  }
}

// ============================================
// SYNC
// ============================================

export async function getLocationsForSync(userId: string): Promise<LocationDB[]> {
  try {
    return db.getAllSync<LocationDB>(
      `SELECT * FROM locations WHERE user_id = ? AND synced_at IS NULL`,
      [userId]
    );
  } catch (error) {
    logger.error('database', 'Error fetching locations for sync', { error: String(error) });
    return [];
  }
}

export async function markLocationSynced(id: string): Promise<void> {
  try {
    db.runSync(
      `UPDATE locations SET synced_at = ? WHERE id = ?`,
      [now(), id]
    );
  } catch (error) {
    logger.error('database', 'Error marking location synced', { error: String(error) });
  }
}

/**
 * Upsert location from Supabase
 */
export async function upsertLocationFromSync(location: LocationDB): Promise<void> {
  try {
    const existing = db.getFirstSync<LocationDB>(
      `SELECT * FROM locations WHERE id = ?`,
      [location.id]
    );

    if (existing) {
      // Update if server version is more recent
      if (new Date(location.updated_at) > new Date(existing.updated_at)) {
        db.runSync(
          `UPDATE locations SET name = ?, latitude = ?, longitude = ?, radius = ?, color = ?, status = ?, 
           deleted_at = ?, updated_at = ?, synced_at = ? WHERE id = ?`,
          [location.name, location.latitude, location.longitude, location.radius, location.color, location.status,
           location.deleted_at, location.updated_at, now(), location.id]
        );
        logger.debug('sync', `Location updated from server: ${location.name} (status: ${location.status})`);
      }
    } else {
      // If already deleted on server, DO NOT INSERT
      if (location.status === 'deleted') {
        logger.debug('sync', `⭕ Location ignored (already deleted on server): ${location.name}`);
        return;
      }
      
      // Insert new (only if status = 'active')
      db.runSync(
        `INSERT INTO locations (id, user_id, name, latitude, longitude, radius, color, status, deleted_at, 
         last_seen_at, created_at, updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [location.id, location.user_id, location.name, location.latitude, location.longitude, location.radius, 
         location.color, location.status, location.deleted_at, now(), location.created_at, location.updated_at, now()]
      );
      logger.debug('sync', `Location inserted from server: ${location.name}`);
    }
  } catch (error) {
    logger.error('database', 'Error in location upsert', { error: String(error) });
  }
}
