/**
 * Serviço de Localização - OnSite Timekeeper
 * 
 * - Permissões de GPS (foreground e background)
 * - Localização atual (alta precisão)
 * - Watch de posição em tempo real
 * - Geofencing nativo via expo-location
 * - Background location updates
 */

import * as Location from 'expo-location';
import { logger } from './logger';

// Nomes das tasks de background (devem ser únicos)
export const LOCATION_TASK_NAME = 'onsite-background-location';
export const GEOFENCE_TASK_NAME = 'onsite-geofence';

// Cor OnSite Amber para notificações
const ONSITE_AMBER = '#F7B324';

// ============================================
// TIPOS
// ============================================

export interface Coordenadas {
  latitude: number;
  longitude: number;
}

export interface LocalizacaoResult {
  coords: Coordenadas;
  accuracy: number | null;
  timestamp: number;
}

export interface GeofenceRegion {
  identifier: string;
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter?: boolean;
  notifyOnExit?: boolean;
}

export interface PermissoesStatus {
  foreground: boolean;
  background: boolean;
}

// ============================================
// PERMISSÕES
// ============================================

/**
 * Verifica status atual das permissões
 */
export async function verificarPermissoes(): Promise<PermissoesStatus> {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = await Location.getBackgroundPermissionsAsync();

    return {
      foreground: foreground.status === 'granted',
      background: background.status === 'granted',
    };
  } catch (error) {
    logger.error('gps', 'Erro ao verificar permissões', { error: String(error) });
    return { foreground: false, background: false };
  }
}

/**
 * Solicita permissão de localização em primeiro plano
 */
export async function solicitarPermissaoForeground(): Promise<boolean> {
  try {
    logger.info('gps', 'Solicitando permissão de localização (foreground)');
    const { status } = await Location.requestForegroundPermissionsAsync();
    const granted = status === 'granted';
    logger.info('gps', `Permissão foreground: ${granted ? '✅' : '❌'}`);
    return granted;
  } catch (error) {
    logger.error('gps', 'Erro ao solicitar permissão foreground', { error: String(error) });
    return false;
  }
}

/**
 * Solicita permissão de localização em segundo plano
 * IMPORTANTE: Deve ser chamada APÓS obter permissão foreground
 */
export async function solicitarPermissaoBackground(): Promise<boolean> {
  try {
    logger.info('gps', 'Solicitando permissão de localização (background)');
    const { status } = await Location.requestBackgroundPermissionsAsync();
    const granted = status === 'granted';
    logger.info('gps', `Permissão background: ${granted ? '✅' : '❌'}`);
    return granted;
  } catch (error) {
    logger.error('gps', 'Erro ao solicitar permissão background', { error: String(error) });
    return false;
  }
}

/**
 * Solicita todas as permissões necessárias em sequência
 */
export async function solicitarTodasPermissoes(): Promise<PermissoesStatus> {
  const foreground = await solicitarPermissaoForeground();
  
  if (!foreground) {
    return { foreground: false, background: false };
  }

  const background = await solicitarPermissaoBackground();
  return { foreground, background };
}

// ============================================
// LOCALIZAÇÃO ATUAL
// ============================================

/**
 * Obtém localização atual com alta precisão
 */
export async function obterLocalizacaoAtual(): Promise<LocalizacaoResult | null> {
  try {
    const permissoes = await verificarPermissoes();
    if (!permissoes.foreground) {
      const granted = await solicitarPermissaoForeground();
      if (!granted) {
        logger.warn('gps', 'Sem permissão para obter localização');
        return null;
      }
    }

    logger.debug('gps', 'Obtendo localização atual...');

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const result: LocalizacaoResult = {
      coords: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      },
      accuracy: location.coords.accuracy ?? null,
      timestamp: location.timestamp,
    };

    logger.info('gps', '📍 Localização obtida', {
      lat: result.coords.latitude.toFixed(6),
      lng: result.coords.longitude.toFixed(6),
      accuracy: result.accuracy ? `${result.accuracy.toFixed(0)}m` : 'N/A',
    });

    return result;
  } catch (error) {
    logger.error('gps', 'Erro ao obter localização', { error: String(error) });
    return null;
  }
}

// ============================================
// WATCH DE POSIÇÃO (TEMPO REAL)
// ============================================

let locationSubscription: Location.LocationSubscription | null = null;

export interface WatchOptions {
  accuracy?: Location.Accuracy;
  distanceInterval?: number; // metros
  timeInterval?: number; // milissegundos
}

/**
 * Inicia monitoramento de posição em tempo real
 */
export async function iniciarWatchPosicao(
  onUpdate: (location: LocalizacaoResult) => void,
  options: WatchOptions = {}
): Promise<boolean> {
  try {
    const permissoes = await verificarPermissoes();
    if (!permissoes.foreground) {
      logger.warn('gps', 'Sem permissão para watch de posição');
      return false;
    }

    // Para watch anterior se existir
    await pararWatchPosicao();

    logger.info('gps', '👁️ Iniciando watch de posição');

    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: options.accuracy ?? Location.Accuracy.Balanced,
        distanceInterval: options.distanceInterval ?? 10,
        timeInterval: options.timeInterval ?? 5000,
      },
      (location) => {
        const result: LocalizacaoResult = {
          coords: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          },
          accuracy: location.coords.accuracy ?? null,
          timestamp: location.timestamp,
        };

        logger.debug('gps', 'Atualização de posição', {
          lat: result.coords.latitude.toFixed(6),
          lng: result.coords.longitude.toFixed(6),
        });

        onUpdate(result);
      }
    );

    return true;
  } catch (error) {
    logger.error('gps', 'Erro ao iniciar watch de posição', { error: String(error) });
    return false;
  }
}

/**
 * Para monitoramento de posição
 */
export async function pararWatchPosicao(): Promise<void> {
  if (locationSubscription) {
    logger.info('gps', '⏹️ Parando watch de posição');
    locationSubscription.remove();
    locationSubscription = null;
  }
}

// ============================================
// GEOFENCING
// ============================================

/**
 * Inicia monitoramento de geofences
 */
export async function iniciarGeofencing(regions: GeofenceRegion[]): Promise<boolean> {
  try {
    if (regions.length === 0) {
      logger.warn('geofence', 'Nenhuma região para monitorar');
      return false;
    }

    const permissoes = await verificarPermissoes();
    if (!permissoes.background) {
      const granted = await solicitarPermissaoBackground();
      if (!granted) {
        logger.warn('geofence', 'Sem permissão background para geofencing');
        return false;
      }
    }

    logger.info('geofence', `🎯 Iniciando geofencing para ${regions.length} região(ões)`);

    // Configura as regiões
    const locationRegions = regions.map(r => ({
      identifier: r.identifier,
      latitude: r.latitude,
      longitude: r.longitude,
      radius: r.radius,
      notifyOnEnter: r.notifyOnEnter ?? true,
      notifyOnExit: r.notifyOnExit ?? true,
    }));

    await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, locationRegions);

    logger.info('geofence', '✅ Geofencing iniciado com sucesso');
    return true;
  } catch (error) {
    logger.error('geofence', 'Erro ao iniciar geofencing', { error: String(error) });
    return false;
  }
}

/**
 * Para monitoramento de geofences
 */
export async function pararGeofencing(): Promise<void> {
  try {
    const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
    if (isRunning) {
      logger.info('geofence', '⏹️ Parando geofencing');
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
  } catch (error) {
    logger.error('geofence', 'Erro ao parar geofencing', { error: String(error) });
  }
}

/**
 * Verifica se geofencing está ativo
 */
export async function isGeofencingAtivo(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
  } catch {
    return false;
  }
}

// ============================================
// BACKGROUND LOCATION UPDATES
// ============================================

/**
 * Inicia atualizações de localização em background
 * Útil como fallback quando geofencing nativo é lento
 */
export async function iniciarBackgroundLocation(): Promise<boolean> {
  try {
    const permissoes = await verificarPermissoes();
    if (!permissoes.background) {
      logger.warn('gps', 'Sem permissão background');
      return false;
    }

    logger.info('gps', '🔄 Iniciando background location');

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50, // Atualiza a cada 50m de movimento
      timeInterval: 60000, // Ou a cada 1 minuto
      deferredUpdatesInterval: 300000, // Batch a cada 5 min
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'OnSite Timekeeper',
        notificationBody: 'Marcando horas de trabalho',
        notificationColor: "#868584ff", // Cor OnSite Amber
      },
    });

    logger.info('gps', '✅ Background location iniciado');
    return true;
  } catch (error) {
    logger.error('gps', 'Erro ao iniciar background location', { error: String(error) });
    return false;
  }
}

/**
 * Para atualizações de localização em background
 */
export async function pararBackgroundLocation(): Promise<void> {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (isRunning) {
      logger.info('gps', '⏹️ Parando background location');
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  } catch (error) {
    logger.error('gps', 'Erro ao parar background location', { error: String(error) });
  }
}

/**
 * Verifica se background location está ativo
 */
export async function isBackgroundLocationAtivo(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

// ============================================
// UTILITÁRIOS
// ============================================

/**
 * Calcula distância entre dois pontos (Haversine)
 */
export function calcularDistancia(
  ponto1: Coordenadas,
  ponto2: Coordenadas
): number {
  const R = 6371e3; // Raio da Terra em metros
  const φ1 = (ponto1.latitude * Math.PI) / 180;
  const φ2 = (ponto2.latitude * Math.PI) / 180;
  const Δφ = ((ponto2.latitude - ponto1.latitude) * Math.PI) / 180;
  const Δλ = ((ponto2.longitude - ponto1.longitude) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distância em metros
}

/**
 * Verifica se um ponto está dentro de um geofence
 */
export function estaDentroGeofence(
  posicao: Coordenadas,
  geofence: GeofenceRegion
): boolean {
  const distancia = calcularDistancia(posicao, {
    latitude: geofence.latitude,
    longitude: geofence.longitude,
  });
  return distancia <= geofence.radius;
}

/**
 * Formata distância para exibição
 */
export function formatarDistancia(metros: number): string {
  if (metros < 1000) {
    return `${Math.round(metros)}m`;
  }
  return `${(metros / 1000).toFixed(1)}km`;
}
