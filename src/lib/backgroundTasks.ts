/**
 * Background Tasks - OnSite Timekeeper
 * 
 * Tasks que rodam em background:
 * - GEOFENCE_TASK: Detecta entrada/saída (tempo real, via SO)
 * - LOCATION_TASK: Updates de posição
 * - HEARTBEAT_TASK: Verifica a cada 15 min se ainda está na fence (safety net)
 * 
 * IMPORTANTE: Importar no entry point ANTES de usar
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import { logger } from './logger';
import { LOCATION_TASK_NAME, GEOFENCE_TASK_NAME } from './location';

// ============================================
// CONSTANTES
// ============================================

export const HEARTBEAT_TASK_NAME = 'onsite-heartbeat-task';
export const HEARTBEAT_INTERVAL = 15 * 60; // 15 minutos em segundos

// ============================================
// TIPOS
// ============================================

export interface GeofenceEvent {
  type: 'enter' | 'exit';
  regionIdentifier: string;
  timestamp: number;
}

export interface HeartbeatResult {
  isInsideFence: boolean;
  fenceId: string | null;
  fenceName: string | null;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null;
  timestamp: number;
  batteryLevel: number | null;
}

export interface ActiveFence {
  id: string;
  nome: string;
  latitude: number;
  longitude: number;
  radius: number;
}

// ============================================
// CALLBACKS (registrados pelos stores)
// ============================================

type GeofenceCallback = (event: GeofenceEvent) => void;
type LocationCallback = (location: Location.LocationObject) => void;
type HeartbeatCallback = (result: HeartbeatResult) => Promise<void>;

let onGeofenceEvent: GeofenceCallback | null = null;
let onLocationUpdate: LocationCallback | null = null;
let onHeartbeat: HeartbeatCallback | null = null;

// Fences ativas (atualizadas pelo locationStore)
let activeFences: ActiveFence[] = [];

/**
 * Registra callback para eventos de geofence
 */
export function setGeofenceCallback(callback: GeofenceCallback): void {
  onGeofenceEvent = callback;
  logger.debug('geofence', 'Callback de geofence registrado');
}

/**
 * Registra callback para atualizações de localização
 */
export function setLocationCallback(callback: LocationCallback): void {
  onLocationUpdate = callback;
  logger.debug('gps', 'Callback de location registrado');
}

/**
 * Registra callback para heartbeat
 */
export function setHeartbeatCallback(callback: HeartbeatCallback): void {
  onHeartbeat = callback;
  logger.debug('heartbeat', 'Callback de heartbeat registrado');
}

/**
 * Atualiza lista de fences ativas
 */
export function updateActiveFences(fences: ActiveFence[]): void {
  activeFences = fences;
  logger.debug('heartbeat', `Fences atualizadas: ${fences.length}`);
}

/**
 * Retorna fences ativas
 */
export function getActiveFences(): ActiveFence[] {
  return activeFences;
}

/**
 * Remove callbacks (cleanup)
 */
export function clearCallbacks(): void {
  onGeofenceEvent = null;
  onLocationUpdate = null;
  onHeartbeat = null;
  logger.debug('gps', 'Callbacks removidos');
}

// ============================================
// HELPER: Calcular distância (Haversine)
// ============================================

function calcularDistancia(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371e3; // Raio da Terra em metros
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distância em metros
}

/**
 * Verifica em qual fence o ponto está dentro
 */
function verificarDentroFence(
  latitude: number, 
  longitude: number
): { isInside: boolean; fenceId: string | null; fenceName: string | null } {
  for (const fence of activeFences) {
    const distancia = calcularDistancia(
      latitude, 
      longitude, 
      fence.latitude, 
      fence.longitude
    );
    
    if (distancia <= fence.radius) {
      return { isInside: true, fenceId: fence.id, fenceName: fence.nome };
    }
  }
  return { isInside: false, fenceId: null, fenceName: null };
}

// ============================================
// TASK: GEOFENCING (Nativo)
// ============================================

TaskManager.defineTask(GEOFENCE_TASK_NAME, ({ data, error }) => {
  if (error) {
    logger.error('geofence', 'Erro na task de geofence', { error: error.message });
    return;
  }

  if (data) {
    const { eventType, region } = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };

    const event: GeofenceEvent = {
      type: eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit',
      regionIdentifier: region.identifier || 'unknown',
      timestamp: Date.now(),
    };

    logger.info('geofence', `📍 Evento: ${event.type.toUpperCase()} - ${event.regionIdentifier}`, {
      type: event.type,
      region: event.regionIdentifier,
    });

    if (onGeofenceEvent) {
      try {
        onGeofenceEvent(event);
      } catch (e) {
        logger.error('geofence', 'Erro no callback de geofence', { error: String(e) });
      }
    } else {
      logger.warn('geofence', 'Evento recebido mas nenhum callback registrado');
    }
  }
});

// ============================================
// TASK: BACKGROUND LOCATION
// ============================================

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
  if (error) {
    logger.error('gps', 'Erro na task de location', { error: error.message });
    return;
  }

  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };

    if (locations && locations.length > 0) {
      const location = locations[0];

      logger.debug('gps', 'Background location update', {
        lat: location.coords.latitude.toFixed(6),
        lng: location.coords.longitude.toFixed(6),
        accuracy: location.coords.accuracy?.toFixed(0) ?? 'N/A',
      });

      if (onLocationUpdate) {
        try {
          onLocationUpdate(location);
        } catch (e) {
          logger.error('gps', 'Erro no callback de location', { error: String(e) });
        }
      }
    }
  }
});

// ============================================
// TASK: HEARTBEAT (Safety Net - 15 min)
// ============================================

TaskManager.defineTask(HEARTBEAT_TASK_NAME, async () => {
  const startTime = Date.now();
  logger.info('heartbeat', '💓 Heartbeat executando...');

  try {
    // 1. Pega localização atual
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5000,
      distanceInterval: 0,
    });

    const { latitude, longitude, accuracy } = location.coords;

    logger.info('heartbeat', `📍 Posição: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${accuracy?.toFixed(0)}m)`);

    // 2. Verifica se está dentro de alguma fence
    const { isInside, fenceId, fenceName } = verificarDentroFence(latitude, longitude);

    // 3. Tenta pegar nível de bateria (pode não estar disponível)
    let batteryLevel: number | null = null;
    try {
      // expo-battery não está instalado por padrão, então ignoramos
      batteryLevel = null;
    } catch {
      // Ignora
    }

    const result: HeartbeatResult = {
      isInsideFence: isInside,
      fenceId,
      fenceName,
      location: { latitude, longitude, accuracy },
      timestamp: Date.now(),
      batteryLevel,
    };

    const duration = Date.now() - startTime;
    logger.info('heartbeat', `Status: ${isInside ? `Dentro de "${fenceName}"` : 'Fora de todas as fences'} (${duration}ms)`);

    // 4. Dispara callback para o store processar
    if (onHeartbeat) {
      await onHeartbeat(result);
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    logger.error('heartbeat', 'Erro no heartbeat', { error: String(error) });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ============================================
// FUNÇÕES DE CONTROLE DO HEARTBEAT
// ============================================

/**
 * Inicia o heartbeat periódico
 */
export async function startHeartbeat(): Promise<boolean> {
  try {
    // Verifica se BackgroundFetch está disponível
    const status = await BackgroundFetch.getStatusAsync();
    
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) {
      logger.warn('heartbeat', 'BackgroundFetch restrito pelo sistema');
      return false;
    }
    
    if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      logger.warn('heartbeat', 'BackgroundFetch negado pelo usuário');
      return false;
    }

    // Verifica se já está registrado
    const isRegistered = await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME);
    if (isRegistered) {
      logger.info('heartbeat', 'Heartbeat já está ativo');
      return true;
    }

    // Registra a task
    await BackgroundFetch.registerTaskAsync(HEARTBEAT_TASK_NAME, {
      minimumInterval: HEARTBEAT_INTERVAL,
      stopOnTerminate: false,
      startOnBoot: true,
    });

    logger.info('heartbeat', `✅ Heartbeat iniciado (intervalo: ${HEARTBEAT_INTERVAL / 60} min)`);
    return true;
  } catch (error) {
    logger.error('heartbeat', 'Erro ao iniciar heartbeat', { error: String(error) });
    return false;
  }
}

/**
 * Para o heartbeat
 */
export async function stopHeartbeat(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(HEARTBEAT_TASK_NAME);
      logger.info('heartbeat', '⏹️ Heartbeat parado');
    }
  } catch (error) {
    logger.error('heartbeat', 'Erro ao parar heartbeat', { error: String(error) });
  }
}

/**
 * Executa heartbeat manualmente (para testes)
 */
export async function executeHeartbeatNow(): Promise<HeartbeatResult | null> {
  try {
    logger.info('heartbeat', '🔄 Executando heartbeat manual...');
    
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude, accuracy } = location.coords;
    const { isInside, fenceId, fenceName } = verificarDentroFence(latitude, longitude);

    const result: HeartbeatResult = {
      isInsideFence: isInside,
      fenceId,
      fenceName,
      location: { latitude, longitude, accuracy },
      timestamp: Date.now(),
      batteryLevel: null,
    };

    if (onHeartbeat) {
      await onHeartbeat(result);
    }

    return result;
  } catch (error) {
    logger.error('heartbeat', 'Erro no heartbeat manual', { error: String(error) });
    return null;
  }
}

// ============================================
// VERIFICAÇÕES DE STATUS
// ============================================

export async function isGeofencingTaskRunning(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK_NAME);
  } catch {
    return false;
  }
}

export async function isLocationTaskRunning(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

export async function isHeartbeatRunning(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME);
  } catch {
    return false;
  }
}

export async function getRegisteredTasks(): Promise<TaskManager.TaskManagerTask[]> {
  try {
    return await TaskManager.getRegisteredTasksAsync();
  } catch {
    return [];
  }
}

/**
 * Status completo das tasks
 */
export async function getTasksStatus(): Promise<{
  geofencing: boolean;
  location: boolean;
  heartbeat: boolean;
  activeFences: number;
  backgroundFetchStatus: string;
}> {
  const [geofencing, location, heartbeat, bgStatus] = await Promise.all([
    isGeofencingTaskRunning(),
    isLocationTaskRunning(),
    isHeartbeatRunning(),
    BackgroundFetch.getStatusAsync(),
  ]);

  const statusNames = {
    [BackgroundFetch.BackgroundFetchStatus.Restricted]: 'Restricted',
    [BackgroundFetch.BackgroundFetchStatus.Denied]: 'Denied',
    [BackgroundFetch.BackgroundFetchStatus.Available]: 'Available',
  };

  return {
    geofencing,
    location,
    heartbeat,
    activeFences: activeFences.length,
    backgroundFetchStatus: statusNames[bgStatus] || 'Unknown',
  };
}

// ============================================
// LOG DE INICIALIZAÇÃO
// ============================================

logger.info('boot', '📋 Background tasks definidas', {
  geofence: GEOFENCE_TASK_NAME,
  location: LOCATION_TASK_NAME,
  heartbeat: HEARTBEAT_TASK_NAME,
  heartbeatInterval: `${HEARTBEAT_INTERVAL / 60} min`,
});
