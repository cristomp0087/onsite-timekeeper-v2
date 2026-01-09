/**
 * Map Screen Hooks - OnSite Timekeeper
 * 
 * Custom hook containing all logic for the Map screen
 * 
 * REFACTORED: Updated to use English selectors and methods
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert, Keyboard, Animated } from 'react-native';
import type MapView from 'react-native-maps';
import type { Region } from 'react-native-maps';
import type { TextInput } from 'react-native';

import { 
  useLocationStore, 
  selectLocations,
  selectCurrentLocation,
  selectIsGeofencingActive,
} from '../../stores/locationStore';
import { getRandomGeofenceColor } from '../../constants/colors';
import {
  DEFAULT_REGION,
  DEFAULT_RADIUS,
  ZOOM_CLOSE,
  ZOOM_DEFAULT,
  MAP_ANIMATION_DURATION,
  type TempPin,
  type SearchResult,
} from './constants';

// ============================================
// HOOK
// ============================================

export function useMapScreen() {
  // Refs
  const mapRef = useRef<MapView>(null);
  const nameInputRef = useRef<TextInput>(null);
  const shakeAnimation = useRef(new Animated.Value(0)).current;

  // Store - selectors for state
  const locations = useLocationStore(selectLocations);
  const currentLocation = useLocationStore(selectCurrentLocation);
  const isMonitoringActive = useLocationStore(selectIsGeofencingActive);
  
  // Store - methods (English names)
  const addLocation = useLocationStore(s => s.addLocation);
  const removeLocation = useLocationStore(s => s.removeLocation);
  const editLocation = useLocationStore(s => s.editLocation);
  const startMonitoring = useLocationStore(s => s.startMonitoring);
  const stopMonitoring = useLocationStore(s => s.stopMonitoring);
  // FIX: Use refreshCurrentLocation instead of updateLocation for getting GPS
  const refreshCurrentLocation = useLocationStore(s => s.refreshCurrentLocation);

  // ============================================
  // STATE
  // ============================================
  
  const [mapReady, setMapReady] = useState(false);
  const [region, setRegion] = useState<Region>(() => {
    if (currentLocation?.latitude && currentLocation?.longitude) {
      return {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        ...ZOOM_DEFAULT,
      };
    }
    return DEFAULT_REGION;
  });

  // Temporary pin (before confirming)
  const [tempPin, setTempPin] = useState<TempPin | null>(null);

  // Radius adjustment modal
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [showRadiusModal, setShowRadiusModal] = useState(false);

  // Add location modal
  const [showNameModal, setShowNameModal] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationRadius, setNewLocationRadius] = useState(DEFAULT_RADIUS);
  const [nameInputError, setNameInputError] = useState(false);

  // Loading
  const [isAdding, setIsAdding] = useState(false);

  // ============================================
  // EFFECTS
  // ============================================

  // Update location on mount
  useEffect(() => {
    // FIX: Use refreshCurrentLocation (no args) instead of updateLocation
    refreshCurrentLocation();
  }, []);

  // Update region when location changes
  useEffect(() => {
    if (currentLocation?.latitude && currentLocation?.longitude && !mapReady) {
      setRegion({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        ...ZOOM_DEFAULT,
      });
    }
  }, [currentLocation, mapReady]);

  // ============================================
  // HELPERS
  // ============================================

  const shakeInput = useCallback(() => {
    setNameInputError(true);
    Animated.sequence([
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();

    nameInputRef.current?.focus();
    setTimeout(() => setNameInputError(false), 2000);
  }, [shakeAnimation]);

  const cancelAndClearPin = useCallback(() => {
    setShowNameModal(false);
    setTempPin(null);
    setNewLocationName('');
    setNewLocationRadius(DEFAULT_RADIUS);
    setNameInputError(false);
  }, []);

  const animateToLocation = useCallback((
    latitude: number,
    longitude: number,
    zoom: 'close' | 'default' = 'close'
  ) => {
    const delta = zoom === 'close' ? ZOOM_CLOSE : ZOOM_DEFAULT;
    mapRef.current?.animateToRegion(
      { latitude, longitude, ...delta },
      MAP_ANIMATION_DURATION
    );
  }, []);

  // ============================================
  // HANDLERS
  // ============================================

  const handleMapReady = useCallback(() => {
    console.log('🗺️ Map loaded');
    setMapReady(true);
  }, []);

  const handleMapPress = useCallback(() => {
    // Simple tap just dismisses keyboard
    Keyboard.dismiss();
  }, []);

  const handleMapLongPress = useCallback((e: any) => {
    Keyboard.dismiss();

    const { latitude, longitude } = e.nativeEvent.coordinate;
    setTempPin({ lat: latitude, lng: longitude });

    // Open name modal automatically
    setNewLocationName('');
    setNewLocationRadius(DEFAULT_RADIUS);
    setNameInputError(false);
    setShowNameModal(true);
  }, []);

  const handleSelectSearchResult = useCallback((result: SearchResult) => {
    // Create temporary pin
    setTempPin({ lat: result.latitude, lng: result.longitude });

    // Move map
    animateToLocation(result.latitude, result.longitude, 'close');

    // Open name modal after short delay (to see map)
    setTimeout(() => {
      setNewLocationName('');
      setNewLocationRadius(DEFAULT_RADIUS);
      setNameInputError(false);
      setShowNameModal(true);
    }, 600);
  }, [animateToLocation]);

  const handleGoToMyLocation = useCallback(() => {
    if (currentLocation) {
      animateToLocation(currentLocation.latitude, currentLocation.longitude, 'default');
    } else {
      Alert.alert('GPS', 'Location not available');
    }
  }, [currentLocation, animateToLocation]);

  const handleConfirmAddLocation = useCallback(async () => {
    // Validation: if no name, shake and don't close
    if (!newLocationName.trim()) {
      shakeInput();
      return;
    }
    if (!tempPin) return;

    setIsAdding(true);
    try {
      // FIX: addLocation now takes separate arguments, not an object
      await addLocation(
        newLocationName.trim(),
        tempPin.lat,
        tempPin.lng,
        newLocationRadius,
        getRandomGeofenceColor()
      );

      // Clear everything
      setTempPin(null);
      setShowNameModal(false);
      setNewLocationName('');
      setNewLocationRadius(DEFAULT_RADIUS);
      setNameInputError(false);

      Alert.alert('✅ Success', `Location "${newLocationName}" added!`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not add location');
    } finally {
      setIsAdding(false);
    }
  }, [newLocationName, tempPin, newLocationRadius, addLocation, shakeInput]);

  const handleCirclePress = useCallback((locationId: string) => {
    setSelectedLocationId(locationId);
    setShowRadiusModal(true);
  }, []);

  const handleCircleLongPress = useCallback((locationId: string, locationName: string) => {
    Alert.alert(
      '🗑️ Remove Location',
      `Remove "${locationName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeLocation(locationId);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Could not remove');
            }
          },
        },
      ]
    );
  }, [removeLocation]);

  const handleChangeRadius = useCallback(async (newRadius: number) => {
    if (!selectedLocationId) return;

    try {
      await editLocation(selectedLocationId, { radius: newRadius });
      setShowRadiusModal(false);
      setSelectedLocationId(null);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not change radius');
    }
  }, [selectedLocationId, editLocation]);

  const handleToggleMonitoring = useCallback(() => {
    if (isMonitoringActive) {
      stopMonitoring();
    } else {
      if (locations.length === 0) {
        Alert.alert('Warning', 'Add at least one location first');
        return;
      }
      startMonitoring();
    }
  }, [isMonitoringActive, locations.length, startMonitoring, stopMonitoring]);

  const handleLocationChipPress = useCallback((latitude: number, longitude: number) => {
    animateToLocation(latitude, longitude, 'close');
  }, [animateToLocation]);

  const handleCloseRadiusModal = useCallback(() => {
    setShowRadiusModal(false);
    setSelectedLocationId(null);
  }, []);

  // ============================================
  // COMPUTED VALUES
  // ============================================

  const selectedLocation = locations.find(l => l.id === selectedLocationId);

  // ============================================
  // RETURN
  // ============================================

  return {
    // Refs
    mapRef,
    nameInputRef,
    shakeAnimation,

    // State
    mapReady,
    region,
    tempPin,
    showNameModal,
    newLocationName,
    newLocationRadius,
    nameInputError,
    isAdding,
    showRadiusModal,
    selectedLocation,

    // Store data
    locations,
    currentLocation,
    isMonitoringActive,

    // Setters
    setNewLocationName,
    setNewLocationRadius,
    setNameInputError,

    // Handlers
    handleMapReady,
    handleMapPress,
    handleMapLongPress,
    handleSelectSearchResult,
    handleGoToMyLocation,
    handleConfirmAddLocation,
    handleCirclePress,
    handleCircleLongPress,
    handleChangeRadius,
    handleToggleMonitoring,
    handleLocationChipPress,
    handleCloseRadiusModal,
    cancelAndClearPin,
  };
}
