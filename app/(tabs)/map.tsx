/**
 * Map Screen - OnSite Timekeeper
 * 
 * Screen to manage work locations:
 * - Search address at top
 * - Long press on map = pin + name modal
 * - Long press on circle = delete
 * - Click on circle = adjust radius
 * 
 * REFACTORED: Using EN property names (name, radius, color)
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Animated,
  TextInput,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import { colors, withOpacity } from '../../src/constants/colors';
import { useMapScreen } from '../../src/screens/map/hooks';
import { SearchBox } from '../../src/screens/map/SearchBox';
import { styles } from '../../src/screens/map/styles';
import { RADIUS_OPTIONS } from '../../src/screens/map/constants';

// ============================================
// COMPONENT
// ============================================

export default function MapScreen() {
  const {
    // Refs
    mapRef,
    nameInputRef,
    shakeAnimation,

    // State
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
  } = useMapScreen();

  return (
    <View style={styles.container}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={region}
        onMapReady={handleMapReady}
        onPress={handleMapPress}
        onLongPress={handleMapLongPress}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        loadingEnabled={true}
        loadingIndicatorColor={colors.primary}
      >
        {/* Registered location circles */}
        {locations.map((location) => (
          <React.Fragment key={location.id}>
            <Circle
              center={{ latitude: location.latitude, longitude: location.longitude }}
              radius={location.radius}
              fillColor={withOpacity(location.color, 0.25)}
              strokeColor={location.color}
              strokeWidth={2}
            />
            <Marker
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              title={location.name}
              description={`Radius: ${location.radius}m`}
              onPress={() => handleCirclePress(location.id)}
              onCalloutPress={() => handleCirclePress(location.id)}
            >
              <View style={[styles.marker, { backgroundColor: location.color }]}>
                <Text style={styles.markerText}>📍</Text>
              </View>
            </Marker>
          </React.Fragment>
        ))}

        {/* Temporary pin - only shows if modal is open */}
        {tempPin && showNameModal && (
          <>
            <Circle
              center={{ latitude: tempPin.lat, longitude: tempPin.lng }}
              radius={newLocationRadius}
              fillColor={withOpacity(colors.primary, 0.2)}
              strokeColor={colors.primary}
              strokeWidth={2}
              lineDashPattern={[5, 5]}
            />
            <Marker coordinate={{ latitude: tempPin.lat, longitude: tempPin.lng }}>
              <View style={[styles.marker, styles.tempMarker]}>
                <Text style={styles.markerText}>📌</Text>
              </View>
            </Marker>
          </>
        )}
      </MapView>

      {/* SEARCH BOX - Memoized component */}
      <SearchBox
        currentLatitude={currentLocation?.latitude}
        currentLongitude={currentLocation?.longitude}
        onSelectResult={handleSelectSearchResult}
      />

      {/* MY LOCATION BUTTON */}
      <TouchableOpacity style={styles.myLocationButton} onPress={handleGoToMyLocation}>
        <Ionicons name="locate" size={24} color={colors.primary} />
      </TouchableOpacity>

      {/* MONITORING BUTTON */}
      <TouchableOpacity
        style={[styles.monitorButton, isMonitoringActive && styles.monitorButtonActive]}
        onPress={handleToggleMonitoring}
      >
        <Text style={[styles.monitorText, isMonitoringActive && styles.monitorTextActive]}>
          {isMonitoringActive ? '🟢 Monitoring' : '⚪ Monitoring OFF'}
        </Text>
      </TouchableOpacity>

      {/* LOCATIONS LIST (chips) */}
      {locations.length > 0 && (
        <View style={styles.locationsList}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {locations.map((location) => (
              <TouchableOpacity
                key={location.id}
                style={[styles.locationChip, { borderColor: location.color }]}
                onPress={() => handleLocationChipPress(location.latitude, location.longitude)}
                onLongPress={() => handleCircleLongPress(location.id, location.name)}
              >
                <View style={[styles.locationChipDot, { backgroundColor: location.color }]} />
                <Text style={styles.locationChipText} numberOfLines={1}>
                  {location.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* INITIAL HINT */}
      {locations.length === 0 && !showNameModal && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>
            🗺️ Long press on the map to add a work location
          </Text>
        </View>
      )}

      {/* NAME MODAL */}
      <Modal
        visible={showNameModal}
        transparent
        animationType="fade"
        onRequestClose={cancelAndClearPin}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={cancelAndClearPin}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <Animated.View
              style={[
                styles.nameModal,
                { transform: [{ translateX: shakeAnimation }] }
              ]}
            >
              <Text style={styles.nameModalTitle}>📍 New Location</Text>
              <Text style={styles.nameModalSubtitle}>
                Give this place a name
              </Text>

              <TextInput
                ref={nameInputRef}
                style={[styles.nameInput, nameInputError && styles.nameInputError]}
                placeholder="e.g. Main Office, Jobsite A..."
                placeholderTextColor={colors.textSecondary}
                value={newLocationName}
                onChangeText={(text) => {
                  setNewLocationName(text);
                  if (nameInputError) setNameInputError(false);
                }}
                autoFocus
                maxLength={40}
              />
              {nameInputError && (
                <Text style={styles.nameInputErrorText}>Please enter a name</Text>
              )}

              <Text style={styles.radiusSectionTitle}>Detection Radius</Text>
              <View style={styles.radiusOptionsInline}>
                {RADIUS_OPTIONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.radiusOptionSmall,
                      newLocationRadius === r && styles.radiusOptionSmallActive,
                    ]}
                    onPress={() => setNewLocationRadius(r)}
                  >
                    <Text
                      style={[
                        styles.radiusOptionSmallText,
                        newLocationRadius === r && styles.radiusOptionSmallTextActive,
                      ]}
                    >
                      {r}m
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.nameModalActions}>
                <TouchableOpacity
                  style={styles.nameModalCancel}
                  onPress={cancelAndClearPin}
                >
                  <Text style={styles.nameModalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.nameModalConfirm, isAdding && styles.nameModalConfirmDisabled]}
                  onPress={handleConfirmAddLocation}
                  disabled={isAdding}
                >
                  <Text style={styles.nameModalConfirmText}>
                    {isAdding ? 'Adding...' : 'Add Location'}
                  </Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* RADIUS ADJUSTMENT MODAL */}
      <Modal
        visible={showRadiusModal}
        transparent
        animationType="fade"
        onRequestClose={handleCloseRadiusModal}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleCloseRadiusModal}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.radiusModal}>
              <Text style={styles.radiusModalTitle}>📐 Adjust Radius</Text>
              <Text style={styles.radiusModalSubtitle}>
                {selectedLocation?.name || 'Location'}
              </Text>

              <View style={styles.radiusOptions}>
                {RADIUS_OPTIONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.radiusOption,
                      selectedLocation?.radius === r && styles.radiusOptionActive,
                    ]}
                    onPress={() => handleChangeRadius(r)}
                  >
                    <Text
                      style={[
                        styles.radiusOptionText,
                        selectedLocation?.radius === r && styles.radiusOptionTextActive,
                      ]}
                    >
                      {r}m
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.radiusDeleteButton}
                onPress={() => {
                  handleCloseRadiusModal();
                  if (selectedLocation) {
                    handleCircleLongPress(selectedLocation.id, selectedLocation.name);
                  }
                }}
              >
                <Text style={styles.radiusDeleteText}>🗑️ Remove Location</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
