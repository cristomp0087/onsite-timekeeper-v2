/**
 * OnSite Club - Paleta de Cores (Dark Mode - COLD)
 * 
 * MODIFICADO:
 * - Cinzas puros/frios (sem tom amarelado)
 * - Visual frio quebrado pelo amarelo apenas em botões e destaques
 * - Tons levemente azulados para sensação moderna/tecnológica
 * 
 * Baseado no brand guide:
 * - OnSite Amber (Hero): #F7B324
 * - OnSite Black: #0A0A0B (preto frio)
 */

export const colors = {
  // ============================================
  // CORES PRIMÁRIAS (Brand)
  // ============================================
  primary: '#F7B324',        // OnSite Amber - cor principal/destaque
  primaryLight: '#FFC94D',   // Amber mais claro
  primaryDark: '#D99B1A',    // Amber mais escuro
  
  // ============================================
  // NEUTROS (Dark Mode - FRIO)
  // ============================================
  black: '#000000',          // Preto puro
  white: '#FFFFFF',          // Branco
  graphite: '#161618',       // Cards - cinza escuro frio
  steel: '#222226',          // Elementos secundários - cinza médio frio
  
  // ============================================
  // BACKGROUNDS (Dark Mode - FRIO)
  // ============================================
  background: '#0A0A0B',           // Fundo principal (preto frio)
  backgroundSecondary: '#131315',  // Fundo de cards (cinza muito escuro)
  backgroundTertiary: '#1D1D21',   // Fundo de inputs (cinza escuro)
  backgroundElevated: '#27272B',   // Elementos mais elevados
  
  // ============================================
  // TEXTOS (Dark Mode)
  // ============================================
  text: '#F5F5F7',           // Texto principal (branco levemente frio)
  textSecondary: '#A1A1A6',  // Texto secundário (cinza claro frio)
  textTertiary: '#6E6E73',   // Texto terciário (cinza médio)
  textMuted: '#48484A',      // Texto mudo/desabilitado
  
  // ============================================
  // BORDAS (Dark Mode - FRIO)
  // ============================================
  border: '#2C2C30',         // Bordas padrão (cinza frio)
  borderLight: '#1F1F23',    // Bordas sutis
  borderFocus: '#F7B324',    // Borda de foco (amber)
  
  // ============================================
  // STATUS
  // ============================================
  success: '#32D74B',        // Verde iOS
  successDark: '#248A3D',    // Verde escuro
  warning: '#FF9F0A',        // Laranja iOS
  warningDark: '#FF9500',    // Laranja escuro
  error: '#FF453A',          // Vermelho iOS
  errorDark: '#D70015',      // Vermelho escuro
  errorLight: 'rgba(255, 69, 58, 0.12)',
  info: '#0A84FF',           // Azul iOS
  infoDark: '#0071E3',       // Azul escuro
  
  // ============================================
  // COMPONENTES ESPECÍFICOS
  // ============================================
  timerActive: '#F7B324',    // Timer ativo (amber)
  timerIdle: '#6E6E73',      // Timer inativo (cinza frio)
  timerBackground: '#131315', // Fundo do timer
  
  // Cards
  card: '#131315',           // Fundo de cards (escuro frio)
  cardBorder: '#2C2C30',     // Borda de cards
  cardPressed: '#1D1D21',    // Card pressionado
  
  // Tab Bar
  tabBar: '#0A0A0B',         // Fundo da tab bar (mesmo do background)
  tabBarBorder: '#1F1F23',   // Borda superior sutil
  tabActive: '#F7B324',      // Ícone/texto ativo (amber)
  tabInactive: '#6E6E73',    // Ícone/texto inativo (cinza frio)
  
  // Header
  header: '#0A0A0B',         // Fundo do header
  headerText: '#F5F5F7',     // Texto do header
  
  // Inputs
  input: '#131315',          // Fundo de inputs
  inputBorder: '#2C2C30',    // Borda de inputs
  inputPlaceholder: '#48484A', // Placeholder (cinza escuro)
  
  // Buttons - AMARELO SÓ AQUI
  buttonPrimary: '#F7B324',  // Botão primário (amber)
  buttonPrimaryText: '#0A0A0B', // Texto do botão primário (preto frio)
  buttonSecondary: '#1D1D21', // Botão secundário (cinza frio)
  buttonSecondaryText: '#F5F5F7', // Texto do botão secundário
  buttonDisabled: '#27272B', // Botão desabilitado
  buttonDisabledText: '#48484A', // Texto desabilitado
  
  // Map
  mapCircle: 'rgba(247, 179, 36, 0.25)',  // Círculo no mapa (amber transparente)
  mapCircleBorder: '#F7B324', // Borda do círculo
  
  // Badges
  badgeSuccess: '#32D74B',   // Badge verde
  badgeWarning: '#FF9F0A',   // Badge laranja
  badgeError: '#FF453A',     // Badge vermelho
  badgeInfo: '#0A84FF',      // Badge azul
  
  // Overlay
  overlay: 'rgba(0, 0, 0, 0.75)', // Overlay escuro
  overlayLight: 'rgba(0, 0, 0, 0.5)', // Overlay mais claro
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
 * Cores vibrantes que contrastam com o fundo frio
 */
export const localColors = [
  '#F7B324',  // Amber (principal)
  '#32D74B',  // Verde
  '#0A84FF',  // Azul
  '#BF5AF2',  // Roxo
  '#FF9F0A',  // Laranja
  '#64D2FF',  // Ciano
  '#FF375F',  // Rosa
  '#30D158',  // Verde claro
];

export function getLocalColor(index: number): string {
  return localColors[index % localColors.length];
}

/**
 * Retorna uma cor aleatória para geofence
 */
export function getRandomGeofenceColor(): string {
  const randomIndex = Math.floor(Math.random() * localColors.length);
  return localColors[randomIndex];
}

/**
 * Espaçamentos padrão
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

/**
 * Border radius padrão
 */
export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

/**
 * Sombras (para dark mode, sombras são mais sutis)
 */
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 8,
  },
};
