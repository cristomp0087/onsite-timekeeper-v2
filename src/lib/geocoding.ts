/**
 * Geocoding Service - OnSite Timekeeper
 * 
 * Usa Nominatim (OpenStreetMap) para:
 * - Buscar endereços → coordenadas (forward geocoding)
 * - Coordenadas → endereço (reverse geocoding)
 * 
 * MODIFICADO:
 * - Adiciona bias de localização (prioriza resultados perto do GPS)
 * - Busca com viewbox para limitar área geográfica
 * 
 * 100% gratuito, sem API key necessária
 */

import { logger } from './logger';

// URL base do Nominatim
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

// User-Agent obrigatório (política do Nominatim)
const USER_AGENT = 'OnSiteTimekeeper/1.0';

// Raio padrão para bias de localização (em graus, ~100km)
const DEFAULT_BIAS_RADIUS = 1.0;

// ============================================
// TIPOS
// ============================================

export interface ResultadoGeocodificacao {
  latitude: number;
  longitude: number;
  endereco: string;
  cidade?: string;
  estado?: string;
  pais?: string;
}

export interface BuscaOptions {
  limite?: number;
  // Bias de localização - prioriza resultados perto destas coordenadas
  biasLatitude?: number;
  biasLongitude?: number;
  // Raio do bias em graus (default ~100km)
  biasRadius?: number;
}

// ============================================
// FORWARD GEOCODING (Endereço → Coordenadas)
// ============================================

/**
 * Busca endereços e retorna coordenadas
 * @param query - Texto de busca (endereço, local, etc.)
 * @param options - Opções de busca (limite, bias de localização)
 */
export async function buscarEndereco(
  query: string,
  options: BuscaOptions | number = 5
): Promise<ResultadoGeocodificacao[]> {
  try {
    // Compatibilidade: se passar número, é o limite
    const opts: BuscaOptions = typeof options === 'number' 
      ? { limite: options } 
      : options;
    
    const limite = opts.limite ?? 5;

    if (!query || query.length < 3) {
      return [];
    }

    logger.debug('gps', `🔍 Buscando endereço: "${query}"`, {
      bias: opts.biasLatitude ? `${opts.biasLatitude.toFixed(4)},${opts.biasLongitude?.toFixed(4)}` : 'none'
    });

    // Parâmetros base
    const params: Record<string, string> = {
      q: query,
      format: 'json',
      limit: String(limite),
      addressdetails: '1',
    };

    // Se tiver bias de localização, adiciona viewbox para priorizar área
    if (opts.biasLatitude !== undefined && opts.biasLongitude !== undefined) {
      const radius = opts.biasRadius ?? DEFAULT_BIAS_RADIUS;
      
      // Viewbox: left,top,right,bottom (minLon,maxLat,maxLon,minLat)
      const minLon = opts.biasLongitude - radius;
      const maxLon = opts.biasLongitude + radius;
      const minLat = opts.biasLatitude - radius;
      const maxLat = opts.biasLatitude + radius;
      
      params.viewbox = `${minLon},${maxLat},${maxLon},${minLat}`;
      params.bounded = '0'; // Não limita estritamente, apenas prioriza
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

    let resultados: ResultadoGeocodificacao[] = data.map((item: any) => ({
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      endereco: item.display_name,
      cidade: item.address?.city || item.address?.town || item.address?.village,
      estado: item.address?.state,
      pais: item.address?.country,
    }));

    // Se tiver bias, ordena por distância do ponto de referência
    if (opts.biasLatitude !== undefined && opts.biasLongitude !== undefined) {
      resultados = resultados.sort((a, b) => {
        const distA = calcularDistanciaSimples(
          opts.biasLatitude!, opts.biasLongitude!,
          a.latitude, a.longitude
        );
        const distB = calcularDistanciaSimples(
          opts.biasLatitude!, opts.biasLongitude!,
          b.latitude, b.longitude
        );
        return distA - distB;
      });
    }

    logger.info('gps', `✅ ${resultados.length} resultado(s) encontrado(s)`);
    return resultados;
  } catch (error) {
    logger.error('gps', 'Erro ao buscar endereço', { error: String(error) });
    return [];
  }
}

/**
 * Busca endereços com autocomplete (para usar com debounce)
 * Retorna resultados mais rapidamente, priorizando área local
 */
export async function buscarEnderecoAutocomplete(
  query: string,
  biasLatitude?: number,
  biasLongitude?: number
): Promise<ResultadoGeocodificacao[]> {
  return buscarEndereco(query, {
    limite: 5,
    biasLatitude,
    biasLongitude,
    biasRadius: 0.5, // ~50km para autocomplete (mais restrito)
  });
}

// ============================================
// REVERSE GEOCODING (Coordenadas → Endereço)
// ============================================

/**
 * Obtém endereço a partir de coordenadas
 * @param latitude - Latitude do ponto
 * @param longitude - Longitude do ponto
 */
export async function obterEndereco(
  latitude: number,
  longitude: number
): Promise<string | null> {
  try {
    logger.debug('gps', `📍 Reverse geocoding: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);

    const response = await fetch(
      `${NOMINATIM_URL}/reverse?` +
        new URLSearchParams({
          lat: String(latitude),
          lon: String(longitude),
          format: 'json',
        }),
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
    const endereco = data.display_name || null;

    if (endereco) {
      logger.debug('gps', `✅ Endereço encontrado: ${endereco.substring(0, 50)}...`);
    }

    return endereco;
  } catch (error) {
    logger.error('gps', 'Erro no reverse geocoding', { error: String(error) });
    return null;
  }
}

/**
 * Obtém detalhes do endereço a partir de coordenadas
 */
export async function obterDetalhesEndereco(
  latitude: number,
  longitude: number
): Promise<ResultadoGeocodificacao | null> {
  try {
    const response = await fetch(
      `${NOMINATIM_URL}/reverse?` +
        new URLSearchParams({
          lat: String(latitude),
          lon: String(longitude),
          format: 'json',
          addressdetails: '1',
        }),
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

    if (!data.lat || !data.lon) {
      return null;
    }

    return {
      latitude: parseFloat(data.lat),
      longitude: parseFloat(data.lon),
      endereco: data.display_name,
      cidade: data.address?.city || data.address?.town || data.address?.village,
      estado: data.address?.state,
      pais: data.address?.country,
    };
  } catch (error) {
    logger.error('gps', 'Erro ao obter detalhes do endereço', { error: String(error) });
    return null;
  }
}

// ============================================
// HELPERS
// ============================================

/**
 * Calcula distância simples entre dois pontos (aproximação rápida)
 * Usa fórmula euclidiana para ordenação - não precisa ser exata
 */
function calcularDistanciaSimples(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Formata endereço para exibição curta
 * Ex: "Rua das Flores, 123 - Centro, São Paulo"
 */
export function formatarEnderecoResumido(endereco: string): string {
  if (!endereco) return '';

  // Pega apenas os primeiros 2-3 componentes
  const partes = endereco.split(', ');
  if (partes.length <= 3) return endereco;

  return partes.slice(0, 3).join(', ');
}

/**
 * Cria função de debounce para autocomplete
 */
export function criarDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}
