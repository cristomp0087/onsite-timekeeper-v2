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
 * UPDATED: Added permission banner for foreground service warnings
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
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
import { MapPermissionBanner } from '../../src/components/PermissionBanner';

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
            {/* Label with location name - tappable to open options */}
            <Marker
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => handleCirclePress(location.id)}
            >
              <View style={styles.locationLabel}>
                <View style={[styles.locationLabelDot, { backgroundColor: location.color }]} />
                <Text style={styles.locationLabelText} numberOfLines={1}>
                  {location.name}
                </Text>
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
            <Marker 
              coordinate={{ latitude: tempPin.lat, longitude: tempPin.lng }}
              tracksViewChanges={false}
            >
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

      {/* PERMISSION BANNER - Shows when foreground service killed or location not "Always" */}
      <MapPermissionBanner />

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

      {/* LOCATION OPTIONS MODAL */}
      <Modal
        visible={showRadiusModal && selectedLocation !== null}
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
            <View style={styles.optionsModal}>
              {/* Header */}
              <View style={styles.optionsModalHeader}>
                <View style={[styles.optionsModalIcon, { backgroundColor: selectedLocation?.color || colors.primary }]}>
                  <Ionicons name="location" size={20} color={colors.white} />
                </View>
                <View style={styles.optionsModalHeaderInfo}>
                  <Text style={styles.optionsModalTitle}>{selectedLocation?.name || 'Location'}</Text>
                  <Text style={styles.optionsModalSubtitle}>
                    {selectedLocation?.latitude?.toFixed(4) || '0'}, {selectedLocation?.longitude?.toFixed(4) || '0'}
                  </Text>
                </View>
              </View>

              <View style={styles.optionsModalDivider} />

              {/* Radius Section */}
              <Text style={styles.optionsSectionLabel}>Detection Radius</Text>
              <View style={styles.radiusOptionsRow}>
                {RADIUS_OPTIONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.radiusChip,
                      selectedLocation?.radius === r && styles.radiusChipActive,
                    ]}
                    onPress={() => handleChangeRadius(r)}
                  >
                    <Text
                      style={[
                        styles.radiusChipText,
                        selectedLocation?.radius === r && styles.radiusChipTextActive,
                      ]}
                    >
                      {r}m
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.optionsModalDivider} />

              {/* Actions List */}
              <View style={styles.optionsActionsList}>
                {/* Edit Name */}
                <TouchableOpacity 
                  style={styles.optionsActionItem}
                  onPress={() => {
                    handleCloseRadiusModal();
                    // TODO: Open edit name modal
                  }}
                >
                  <Ionicons name="pencil-outline" size={20} color={colors.text} />
                  <Text style={styles.optionsActionText}>Edit Name</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                {/* Change Color */}
                <TouchableOpacity 
                  style={styles.optionsActionItem}
                  onPress={() => {
                    handleCloseRadiusModal();
                    // TODO: Open color picker
                  }}
                >
                  <Ionicons name="color-palette-outline" size={20} color={colors.text} />
                  <Text style={styles.optionsActionText}>Change Color</Text>
                  <View style={[styles.colorPreview, { backgroundColor: selectedLocation?.color || colors.primary }]} />
                </TouchableOpacity>

                {/* Pause Tracking */}
                <TouchableOpacity 
                  style={styles.optionsActionItem}
                  onPress={() => {
                    handleCloseRadiusModal();
                    // TODO: Toggle pause state
                  }}
                >
                  <Ionicons name="pause-circle-outline" size={20} color={colors.text} />
                  <Text style={styles.optionsActionText}>Pause Tracking</Text>
                  <Text style={styles.optionsActionHint}>For vacations</Text>
                </TouchableOpacity>

                {/* Open in Maps */}
                <TouchableOpacity 
                  style={styles.optionsActionItem}
                  onPress={() => {
                    if (selectedLocation) {
                      const url = `https://www.google.com/maps/search/?api=1&query=${selectedLocation.latitude},${selectedLocation.longitude}`;
                      import('react-native').then(({ Linking }) => Linking.openURL(url));
                    }
                  }}
                >
                  <Ionicons name="navigate-outline" size={20} color={colors.text} />
                  <Text style={styles.optionsActionText}>Open in Maps</Text>
                  <Ionicons name="open-outline" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.optionsModalDivider} />

              {/* Delete */}
              <TouchableOpacity
                style={styles.optionsDeleteBtn}
                onPress={() => {
                  handleCloseRadiusModal();
                  if (selectedLocation) {
                    handleCircleLongPress(selectedLocation.id, selectedLocation.name);
                  }
                }}
              >
                <Ionicons name="trash-outline" size={20} color={colors.error} />
                <Text style={styles.optionsDeleteText}>Delete Location</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
