/**
 * Map Screen Constants - OnSite Timekeeper
 * 
 * Constants, types, and configuration for the Map screen
 */

import type { Region } from 'react-native-maps';

// ============================================
// DEFAULT VALUES
// ============================================

// Default region (Ottawa, CA)
export const DEFAULT_REGION: Region = {
  latitude: 45.4215,
  longitude: -75.6972,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

// Default radius in meters
export const DEFAULT_RADIUS = 100;

// Available radius options
export const RADIUS_OPTIONS = [100, 150, 250, 400];

// Debounce delay for autocomplete (ms)
export const AUTOCOMPLETE_DELAY = 400;

// Animation duration for map movements
export const MAP_ANIMATION_DURATION = 500;

// Zoom levels
export const ZOOM_CLOSE: Pick<Region, 'latitudeDelta' | 'longitudeDelta'> = {
  latitudeDelta: 0.005,
  longitudeDelta: 0.005,
};

export const ZOOM_DEFAULT: Pick<Region, 'latitudeDelta' | 'longitudeDelta'> = {
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

// ============================================
// TYPES
// ============================================

export interface TempPin {
  lat: number;
  lng: number;
}

export interface SearchResult {
  latitude: number;
  longitude: number;
  endereco: string;
  cidade?: string;
  estado?: string;
  pais?: string;
  distancia?: number; // Distance from user in km
}

export interface MapScreenState {
  // Map
  mapReady: boolean;
  region: Region;
  
  // Search
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  showSearchResults: boolean;
  
  // Temporary pin (before confirming)
  tempPin: TempPin | null;
  
  // Radius adjustment modal
  selectedLocationId: string | null;
  showRadiusModal: boolean;
  
  // Add location modal
  showNameModal: boolean;
  newLocationName: string;
  newLocationRadius: number;
  nameInputError: boolean;
  
  // Loading
  isAdding: boolean;
}

// ============================================
// INITIAL STATE
// ============================================

export const INITIAL_STATE: Omit<MapScreenState, 'region'> = {
  mapReady: false,
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  showSearchResults: false,
  tempPin: null,
  selectedLocationId: null,
  showRadiusModal: false,
  showNameModal: false,
  newLocationName: '',
  newLocationRadius: DEFAULT_RADIUS,
  nameInputError: false,
  isAdding: false,
};
