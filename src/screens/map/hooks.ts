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
  type WorkLocation,
} from '../../stores/locationStore';
import { logger } from '../../lib/logger';
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

  // Radius adjustment modal - store full object to avoid race condition
  const [selectedLocation, setSelectedLocation] = useState<WorkLocation | null>(null);
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
    logger.debug('ui', '❌ Add location cancelled');
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
    logger.debug('ui', '📍 Map long press - creating temp pin', { lat: latitude.toFixed(5), lng: longitude.toFixed(5) });
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
      logger.debug('ui', '⚠️ Location name empty - validation failed');
      shakeInput();
      return;
    }
    if (!tempPin) return;

    setIsAdding(true);
    logger.info('ui', `➕ Adding location: "${newLocationName}"`, { 
      lat: tempPin.lat.toFixed(5), 
      lng: tempPin.lng.toFixed(5),
      radius: newLocationRadius 
    });
    
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

      logger.info('ui', `✅ Location added successfully: "${newLocationName}"`);
      Alert.alert('✅ Success', `Location "${newLocationName}" added!`);
    } catch (error: any) {
      logger.error('ui', `❌ Failed to add location: "${newLocationName}"`, { error: error.message });
      Alert.alert('Error', error.message || 'Could not add location');
    } finally {
      setIsAdding(false);
    }
  }, [newLocationName, tempPin, newLocationRadius, addLocation, shakeInput]);

  const handleCirclePress = useCallback((locationId: string) => {
    const location = locations.find(l => l.id === locationId);
    if (location) {
      logger.debug('ui', `🎯 Opening options modal: "${location.name}"`);
      setSelectedLocation(location);
      setShowRadiusModal(true);
    } else {
      logger.warn('ui', `⚠️ Location not found for id: ${locationId}`);
    }
  }, [locations]);

  const handleCircleLongPress = useCallback((locationId: string, locationName: string) => {
    logger.debug('ui', `🗑️ Delete requested: "${locationName}"`);
    Alert.alert(
      '🗑️ Remove Location',
      `Remove "${locationName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            logger.info('ui', `🗑️ Deleting location: "${locationName}"`, { id: locationId });
            try {
              await removeLocation(locationId);
              logger.info('ui', `✅ Location deleted: "${locationName}"`);
            } catch (error: any) {
              logger.error('ui', `❌ Failed to delete location: "${locationName}"`, { error: error.message });
              Alert.alert('Error', error.message || 'Could not remove');
            }
          },
        },
      ]
    );
  }, [removeLocation]);

  const handleChangeRadius = useCallback(async (newRadius: number) => {
    if (!selectedLocation) return;

    logger.info('ui', `📏 Changing radius: "${selectedLocation.name}"`, { 
      from: selectedLocation.radius, 
      to: newRadius 
    });
    
    try {
      await editLocation(selectedLocation.id, { radius: newRadius });
      logger.info('ui', `✅ Radius updated: "${selectedLocation.name}" → ${newRadius}m`);
      setShowRadiusModal(false);
      setSelectedLocation(null);
    } catch (error: any) {
      logger.error('ui', `❌ Failed to change radius: "${selectedLocation.name}"`, { error: error.message });
      Alert.alert('Error', error.message || 'Could not change radius');
    }
  }, [selectedLocation, editLocation]);

  const handleToggleMonitoring = useCallback(() => {
    if (isMonitoringActive) {
      logger.info('ui', '⏹️ User toggled monitoring OFF');
      stopMonitoring();
    } else {
      if (locations.length === 0) {
        logger.warn('ui', '⚠️ Cannot start monitoring - no locations');
        Alert.alert('Warning', 'Add at least one location first');
        return;
      }
      logger.info('ui', `▶️ User toggled monitoring ON (${locations.length} locations)`);
      startMonitoring();
    }
  }, [isMonitoringActive, locations.length, startMonitoring, stopMonitoring]);

  const handleLocationChipPress = useCallback((latitude: number, longitude: number) => {
    animateToLocation(latitude, longitude, 'close');
  }, [animateToLocation]);

  const handleCloseRadiusModal = useCallback(() => {
    logger.debug('ui', '❌ Options modal closed');
    setShowRadiusModal(false);
    setSelectedLocation(null);
  }, []);

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
    handleCloseRadiusModal,
    cancelAndClearPin,
  };
}
