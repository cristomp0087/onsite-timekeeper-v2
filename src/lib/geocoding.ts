/**
 * Geocoding Service - OnSite Timekeeper
 * 
 * Uses Nominatim (OpenStreetMap) for:
 * - Search addresses → coordinates (forward geocoding)
 * - Coordinates → address (reverse geocoding)
 * 
 * IMPROVED:
 * - Smart search: tries local first, then expands
 * - Country detection from GPS
 * - Better proximity sorting
 * - Fallback strategy for better results
 * 
 * 100% free, no API key needed
 */

import { logger } from './logger';

// Base URL for Nominatim
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

// Required User-Agent (Nominatim policy)
const USER_AGENT = 'OnSiteTimekeeper/1.0';

// ============================================
// TYPES
// ============================================

export interface ResultadoGeocodificacao {
  latitude: number;
  longitude: number;
  endereco: string;
  cidade?: string;
  estado?: string;
  pais?: string;
  distancia?: number; // Distance from bias point in km
}

interface BuscaOptions {
  limite?: number;
  biasLatitude?: number;
  biasLongitude?: number;
  countryCodes?: string[];
  strategy?: 'local_first' | 'global';
}

// ============================================
// COUNTRY DETECTION
// ============================================

function detectCountryCodes(latitude: number, longitude: number): string[] {
  const regions: { codes: string[]; minLat: number; maxLat: number; minLon: number; maxLon: number }[] = [
    { codes: ['ca'], minLat: 41.7, maxLat: 83.1, minLon: -141.0, maxLon: -52.6 },
    { codes: ['us'], minLat: 24.5, maxLat: 49.4, minLon: -125.0, maxLon: -66.9 },
    { codes: ['mx'], minLat: 14.5, maxLat: 32.7, minLon: -118.4, maxLon: -86.7 },
    { codes: ['gb'], minLat: 49.9, maxLat: 60.8, minLon: -8.6, maxLon: 1.8 },
    { codes: ['au'], minLat: -43.6, maxLat: -10.7, minLon: 113.3, maxLon: 153.6 },
    { codes: ['br'], minLat: -33.8, maxLat: 5.3, minLon: -73.9, maxLon: -34.8 },
  ];

  const detected: string[] = [];
  
  for (const region of regions) {
    if (
      latitude >= region.minLat && latitude <= region.maxLat &&
      longitude >= region.minLon && longitude <= region.maxLon
    ) {
      detected.push(...region.codes);
    }
  }

  if (detected.includes('ca') && latitude < 50) {
    if (!detected.includes('us')) detected.push('us');
  }
  if (detected.includes('us') && latitude > 40) {
    if (!detected.includes('ca')) detected.push('ca');
  }

  return detected.length > 0 ? detected : [];
}

function calcularDistanciaKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================
// FORWARD GEOCODING (Address → Coordinates)
// ============================================

async function searchNominatim(
  query: string,
  options: {
    limit: number;
    viewbox?: string;
    bounded?: boolean;
    countryCodes?: string[];
  }
): Promise<ResultadoGeocodificacao[]> {
  const params: Record<string, string> = {
    q: query,
    format: 'json',
    limit: String(options.limit),
    addressdetails: '1',
  };

  if (options.viewbox) {
    params.viewbox = options.viewbox;
    params.bounded = options.bounded ? '1' : '0';
  }

  if (options.countryCodes && options.countryCodes.length > 0) {
    params.countrycodes = options.countryCodes.join(',');
  }

  const response = await fetch(
    `${NOMINATIM_URL}/search?` + new URLSearchParams(params),
    {
      headers: {
        'User-Agent': USER_AGENT,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  return data.map((item: any) => ({
    latitude: parseFloat(item.lat),
    longitude: parseFloat(item.lon),
    endereco: item.display_name,
    cidade: item.address?.city || item.address?.town || item.address?.village,
    estado: item.address?.state,
    pais: item.address?.country,
  }));
}

/**
 * Search addresses with smart strategy (internal)
 */
async function buscarEndereco(
  query: string,
  options: BuscaOptions | number = 5
): Promise<ResultadoGeocodificacao[]> {
  try {
    const opts: BuscaOptions = typeof options === 'number' 
      ? { limite: options } 
      : options;
    
    const limite = opts.limite ?? 5;
    const strategy = opts.strategy ?? 'local_first';

    if (!query || query.length < 3) {
      return [];
    }

    const hasLocation = opts.biasLatitude !== undefined && opts.biasLongitude !== undefined;

    logger.debug('gps', `🔍 Searching: "${query}"`, {
      bias: hasLocation ? `${opts.biasLatitude!.toFixed(4)},${opts.biasLongitude!.toFixed(4)}` : 'none',
      strategy,
    });

    let resultados: ResultadoGeocodificacao[] = [];

    if (hasLocation && strategy === 'local_first') {
      const detectedCountries = opts.countryCodes ?? detectCountryCodes(opts.biasLatitude!, opts.biasLongitude!);
      
      const radiusDeg = 1.0;
      const viewbox = [
        opts.biasLongitude! - radiusDeg,
        opts.biasLatitude! + radiusDeg,
        opts.biasLongitude! + radiusDeg,
        opts.biasLatitude! - radiusDeg,
      ].join(',');

      logger.debug('gps', '📍 Trying local bounded search...');
      resultados = await searchNominatim(query, {
        limit: limite,
        viewbox,
        bounded: true,
        countryCodes: detectedCountries,
      });

      if (resultados.length < 3) {
        logger.debug('gps', '🌍 Expanding to country-level search...');
        const moreResults = await searchNominatim(query, {
          limit: limite,
          viewbox,
          bounded: false,
          countryCodes: detectedCountries,
        });
        
        const existingCoords = new Set(resultados.map(r => `${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}`));
        for (const r of moreResults) {
          const key = `${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}`;
          if (!existingCoords.has(key)) {
            resultados.push(r);
            existingCoords.add(key);
          }
        }
      }

      if (resultados.length < 2 && detectedCountries.length > 0) {
        logger.debug('gps', '🌐 Trying global search...');
        const globalResults = await searchNominatim(query, {
          limit: limite,
          viewbox,
          bounded: false,
        });

        const existingCoords = new Set(resultados.map(r => `${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}`));
        for (const r of globalResults) {
          const key = `${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}`;
          if (!existingCoords.has(key)) {
            resultados.push(r);
            existingCoords.add(key);
          }
        }
      }

      resultados = resultados.map(r => ({
        ...r,
        distancia: calcularDistanciaKm(opts.biasLatitude!, opts.biasLongitude!, r.latitude, r.longitude),
      }));

      resultados.sort((a, b) => (a.distancia ?? Infinity) - (b.distancia ?? Infinity));

    } else {
      resultados = await searchNominatim(query, { limit: limite });
    }

    resultados = resultados.slice(0, limite);

    const closestDist = resultados[0]?.distancia;
    logger.info('gps', `✅ ${resultados.length} result(s)`, {
      closest: closestDist ? `${closestDist.toFixed(1)}km` : 'n/a',
    });

    return resultados;
  } catch (error) {
    logger.error('gps', 'Error searching address', { error: String(error) });
    return [];
  }
}

/**
 * Search addresses with autocomplete (for use with debounce)
 * Uses smart local-first strategy
 */
export async function buscarEnderecoAutocomplete(
  query: string,
  biasLatitude?: number,
  biasLongitude?: number
): Promise<ResultadoGeocodificacao[]> {
  return buscarEndereco(query, {
    limite: 6,
    biasLatitude,
    biasLongitude,
    strategy: 'local_first',
  });
}

// ============================================
// HELPERS
// ============================================

/**
 * Format address for short display
 * Ex: "123 Main St, Downtown, Toronto"
 */
export function formatarEnderecoResumido(endereco: string): string {
  if (!endereco) return '';

  const partes = endereco.split(', ');
  if (partes.length <= 3) return endereco;

  return partes.slice(0, 3).join(', ');
}
