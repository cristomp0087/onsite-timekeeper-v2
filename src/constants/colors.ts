/**
 * OnSite Club - Paleta de Cores
 * 
 * Baseado no brand guide:
 * - OnSite Amber (Hero): #F7B324
 * - OnSite Black: #1A1A1A
 * - OnSite White: #FFFFFF
 * - Graphite: #3D3D3D
 * - Steel Grey: #666666
 */

export const colors = {
  // ============================================
  // CORES PRIMÁRIAS (Brand)
  // ============================================
  primary: '#F7B324',        // OnSite Amber - cor principal/destaque
  primaryLight: '#FFC94D',   // Amber mais claro
  primaryDark: '#D99B1A',    // Amber mais escuro
  
  // ============================================
  // NEUTROS
  // ============================================
  black: '#1A1A1A',          // OnSite Black - textos principais
  white: '#FFFFFF',          // OnSite White - fundos
  graphite: '#3D3D3D',       // Graphite - textos secundários
  steel: '#666666',          // Steel Grey - textos terciários
  
  // ============================================
  // BACKGROUNDS
  // ============================================
  background: '#FFFFFF',           // Fundo principal
  backgroundSecondary: '#F5F5F5',  // Fundo secundário (cards, seções)
  
  // ============================================
  // TEXTOS
  // ============================================
  text: '#1A1A1A',           // Texto principal (OnSite Black)
  textSecondary: '#666666',  // Texto secundário (Steel Grey)
  textTertiary: '#999999',   // Texto terciário
  
  // ============================================
  // BORDAS
  // ============================================
  border: '#E0E0E0',         // Bordas padrão
  borderLight: '#F0F0F0',    // Bordas sutis
  
  // ============================================
  // STATUS
  // ============================================
  success: '#4CAF50',        // Verde - sucesso, ativo
  warning: '#FF9800',        // Laranja - aviso, pausa
  error: '#F44336',          // Vermelho - erro, deletar
  info: '#2196F3',           // Azul - informação
  
  // ============================================
  // COMPONENTES ESPECÍFICOS
  // ============================================
  timerActive: '#F7B324',    // Timer ativo (amber)
  timerIdle: '#3D3D3D',      // Timer inativo (graphite)
  mapCircle: 'rgba(247, 179, 36, 0.3)',  // Círculo no mapa (amber transparente)
};

/**
 * Helper para criar cor com opacidade
 */
export function withOpacity(color: string, opacity: number): string {
  // Se já é rgba, extrai e recalcula
  if (color.startsWith('rgba')) {
    return color.replace(/[\d.]+\)$/, `${opacity})`);
  }
  
  // Converte hex para rgba
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Cores para locais (círculos no mapa)
 */
export const localColors = [
  '#F7B324',  // Amber (principal)
  '#4CAF50',  // Verde
  '#2196F3',  // Azul
  '#9C27B0',  // Roxo
  '#FF5722',  // Laranja escuro
  '#00BCD4',  // Ciano
  '#E91E63',  // Rosa
  '#8BC34A',  // Verde claro
];

export function getLocalColor(index: number): string {
  return localColors[index % localColors.length];
}