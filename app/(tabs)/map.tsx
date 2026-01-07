/**
 * Map Screen - OnSite Timekeeper
 * 
 * Tela simplificada para gerenciar locais de trabalho
 * - Busca por endereço no topo
 * - Long press no mapa = pin + modal nome
 * - Long press no círculo = deletar
 * - Clique no círculo = ajustar raio
 * 
 * MODIFICADO:
 * - Caixa de busca branca com texto preto
 * - Ícone GPS formal (Ionicons)
 * - Autocomplete com debounce conforme digita
 * - Busca com bias de localização (prioriza resultados próximos)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
  Modal,
  Dimensions,
  Keyboard,
  Platform,
  Animated,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Circle, Region, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { colors, withOpacity, getRandomGeofenceColor } from '../../src/constants/colors';
import { useLocationStore } from '../../src/stores/locationStore';
import { buscarEnderecoAutocomplete, formatarEnderecoResumido } from '../../src/lib/geocoding';

const { width, height } = Dimensions.get('window');

// Região default (Ottawa, CA)
const DEFAULT_REGION: Region = {
  latitude: 45.4215,
  longitude: -75.6972,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

// Raio padrão em metros (mínimo 200)
const DEFAULT_RADIUS = 200;

// Opções de raio disponíveis (mínimo 200m)
const RADIUS_OPTIONS = [200, 250, 300, 400, 500];

// Debounce delay para autocomplete
const AUTOCOMPLETE_DELAY = 400;

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const searchInputRef = useRef<TextInput>(null);
  const nameInputRef = useRef<TextInput>(null);
  const autocompleteTimeout = useRef<NodeJS.Timeout | null>(null);
  
  const {
    locais,
    localizacaoAtual,
    isGeofencingAtivo,
    adicionarLocal,
    removerLocal,
    editarLocal,
    iniciarMonitoramento,
    pararMonitoramento,
    atualizarLocalizacao,
  } = useLocationStore();

  // Estados
  const [mapReady, setMapReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  
  // Pin temporário (antes de confirmar)
  const [tempPin, setTempPin] = useState<{ lat: number; lng: number } | null>(null);
  
  // Modal de ajuste de raio
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [showRadiusModal, setShowRadiusModal] = useState(false);
  
  // Loading
  const [isAdding, setIsAdding] = useState(false);
  
  // Modal de nome do local
  const [showNameModal, setShowNameModal] = useState(false);
  const [newLocalName, setNewLocalName] = useState('');
  const [newLocalRadius, setNewLocalRadius] = useState(DEFAULT_RADIUS);
  const [nameInputError, setNameInputError] = useState(false);
  
  // Animação para shake do input
  const shakeAnimation = useRef(new Animated.Value(0)).current;

  // Região inicial
  const getInitialRegion = (): Region => {
    if (localizacaoAtual?.latitude && localizacaoAtual?.longitude) {
      return {
        latitude: localizacaoAtual.latitude,
        longitude: localizacaoAtual.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }
    return DEFAULT_REGION;
  };

  const [region, setRegion] = useState<Region>(getInitialRegion());

  useEffect(() => {
    atualizarLocalizacao();
  }, []);

  // Atualiza região quando localização muda
  useEffect(() => {
    if (localizacaoAtual?.latitude && localizacaoAtual?.longitude && !mapReady) {
      setRegion({
        latitude: localizacaoAtual.latitude,
        longitude: localizacaoAtual.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  }, [localizacaoAtual]);

  // ============================================
  // AUTOCOMPLETE
  // ============================================

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    
    // Cancela busca anterior
    if (autocompleteTimeout.current) {
      clearTimeout(autocompleteTimeout.current);
    }

    // Se texto muito curto, limpa resultados
    if (text.length < 3) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    // Debounce: espera usuário parar de digitar
    setIsSearching(true);
    autocompleteTimeout.current = setTimeout(async () => {
      try {
        // Busca com bias de localização atual
        const results = await buscarEnderecoAutocomplete(
          text,
          localizacaoAtual?.latitude,
          localizacaoAtual?.longitude
        );
        setSearchResults(results);
        setShowSearchResults(results.length > 0);
      } catch (error) {
        console.error('Autocomplete error:', error);
      } finally {
        setIsSearching(false);
      }
    }, AUTOCOMPLETE_DELAY);
  }, [localizacaoAtual]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autocompleteTimeout.current) {
        clearTimeout(autocompleteTimeout.current);
      }
    };
  }, []);

  // ============================================
  // HELPERS
  // ============================================

  const shakeInput = () => {
    setNameInputError(true);
    Animated.sequence([
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
    
    // Focus no input
    nameInputRef.current?.focus();
    
    // Remove erro depois de 2s
    setTimeout(() => setNameInputError(false), 2000);
  };

  const cancelAndClearPin = () => {
    setShowNameModal(false);
    setTempPin(null);
    setNewLocalName('');
    setNewLocalRadius(DEFAULT_RADIUS);
    setNameInputError(false);
  };

  // ============================================
  // HANDLERS
  // ============================================

  const handleMapReady = () => {
    console.log('🗺️ Mapa carregado');
    setMapReady(true);
  };

  const handleMapPress = (e: any) => {
    // Toque simples só fecha a busca
    setShowSearchResults(false);
    Keyboard.dismiss();
    
    // NÃO cria pin com toque simples (evita toques acidentais)
  };

  const handleMapLongPress = (e: any) => {
    // Long press cria pin e já abre popup do nome
    Keyboard.dismiss();
    setShowSearchResults(false);
    
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setTempPin({ lat: latitude, lng: longitude });
    
    // Já abre o popup do nome automaticamente
    setNewLocalName('');
    setNewLocalRadius(DEFAULT_RADIUS);
    setNameInputError(false);
    setShowNameModal(true);
  };

  const handleSearch = async () => {
    if (searchQuery.length < 3) {
      Alert.alert('Search', 'Enter at least 3 characters');
      return;
    }
    
    setIsSearching(true);
    try {
      const results = await buscarEnderecoAutocomplete(
        searchQuery,
        localizacaoAtual?.latitude,
        localizacaoAtual?.longitude
      );
      setSearchResults(results);
      setShowSearchResults(true);
    } catch (error) {
      Alert.alert('Error', 'Could not search address');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: any) => {
    // Fecha busca
    setShowSearchResults(false);
    setSearchQuery('');
    Keyboard.dismiss();
    
    // Cria pin temporário
    setTempPin({ lat: result.latitude, lng: result.longitude });
    
    // Move mapa
    mapRef.current?.animateToRegion({
      latitude: result.latitude,
      longitude: result.longitude,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    }, 500);
    
    // Já abre o popup do nome automaticamente (com pequeno delay para ver o mapa)
    setTimeout(() => {
      setNewLocalName('');
      setNewLocalRadius(DEFAULT_RADIUS);
      setNameInputError(false);
      setShowNameModal(true);
    }, 600);
  };

  const handleGoToMyLocation = () => {
    if (localizacaoAtual) {
      mapRef.current?.animateToRegion({
        latitude: localizacaoAtual.latitude,
        longitude: localizacaoAtual.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    } else {
      Alert.alert('GPS', 'Location not available');
    }
  };

  const handleConfirmAddLocal = async () => {
    // Validação: se não tem nome, shake e não fecha
    if (!newLocalName.trim()) {
      shakeInput();
      return;
    }
    if (!tempPin) return;
    
    setIsAdding(true);
    try {
      await adicionarLocal({
        nome: newLocalName.trim(),
        latitude: tempPin.lat,
        longitude: tempPin.lng,
        raio: newLocalRadius,
        cor: getRandomGeofenceColor(),
      });
      
      // Limpa tudo
      setTempPin(null);
      setShowNameModal(false);
      setNewLocalName('');
      setNewLocalRadius(DEFAULT_RADIUS);
      setNameInputError(false);
      
      // Feedback
      Alert.alert('✅ Success', `Location "${newLocalName}" added!`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not add location');
    } finally {
      setIsAdding(false);
    }
  };

  const handleCirclePress = (localId: string) => {
    setSelectedLocalId(localId);
    setShowRadiusModal(true);
  };

  const handleCircleLongPress = (localId: string, localNome: string) => {
    Alert.alert(
      '🗑️ Remove Location',
      `Remove "${localNome}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removerLocal(localId);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Could not remove');
            }
          },
        },
      ]
    );
  };

  const handleChangeRadius = async (newRadius: number) => {
    if (!selectedLocalId) return;
    
    try {
      await editarLocal(selectedLocalId, { raio: newRadius });
      setShowRadiusModal(false);
      setSelectedLocalId(null);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not change radius');
    }
  };

  const toggleMonitoramento = () => {
    if (isGeofencingAtivo) {
      pararMonitoramento();
    } else {
      if (locais.length === 0) {
        Alert.alert('Warning', 'Add at least one location first');
        return;
      }
      iniciarMonitoramento();
    }
  };

  // Local selecionado para modal de raio
  const selectedLocal = locais.find(l => l.id === selectedLocalId);

  return (
    <View style={styles.container}>
      {/* MAPA */}
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
        {/* Círculos dos locais cadastrados */}
        {locais.map((local) => (
          <React.Fragment key={local.id}>
            <Circle
              center={{ latitude: local.latitude, longitude: local.longitude }}
              radius={local.raio}
              fillColor={withOpacity(local.cor, 0.25)}
              strokeColor={local.cor}
              strokeWidth={2}
            />
            <Marker
              coordinate={{ latitude: local.latitude, longitude: local.longitude }}
              title={local.nome}
              description={`Radius: ${local.raio}m`}
              onPress={() => handleCirclePress(local.id)}
              onCalloutPress={() => handleCirclePress(local.id)}
            >
              <View style={[styles.marker, { backgroundColor: local.cor }]}>
                <Text style={styles.markerText}>📍</Text>
              </View>
            </Marker>
          </React.Fragment>
        ))}

        {/* Pin temporário - só mostra se modal está aberto */}
        {tempPin && showNameModal && (
          <>
            <Circle
              center={{ latitude: tempPin.lat, longitude: tempPin.lng }}
              radius={newLocalRadius}
              fillColor={withOpacity(colors.primary, 0.2)}
              strokeColor={colors.primary}
              strokeWidth={2}
              lineDashPattern={[5, 5]}
            />
            <Marker
              coordinate={{ latitude: tempPin.lat, longitude: tempPin.lng }}
            >
              <View style={[styles.marker, styles.tempMarker]}>
                <Text style={styles.markerText}>📌</Text>
              </View>
            </Marker>
          </>
        )}
      </MapView>

      {/* CAIXA DE BUSCA - FUNDO BRANCO */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="#666666" style={styles.searchIcon} />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search address..."
            placeholderTextColor="#999999"
            value={searchQuery}
            onChangeText={handleSearchChange}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            onFocus={() => setShowSearchResults(searchResults.length > 0)}
          />
          {isSearching && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
          )}
          {searchQuery.length > 0 && !isSearching && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setShowSearchResults(false); }}>
              <Ionicons name="close-circle" size={20} color="#999999" />
            </TouchableOpacity>
          )}
        </View>

        {/* Resultados da busca */}
        {showSearchResults && searchResults.length > 0 && (
          <View style={styles.searchResults}>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
              {searchResults.map((result, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.searchResultItem}
                  onPress={() => handleSelectSearchResult(result)}
                >
                  <Ionicons name="location-outline" size={16} color="#666666" style={styles.searchResultIcon} />
                  <Text style={styles.searchResultText} numberOfLines={2}>
                    {formatarEnderecoResumido(result.endereco)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* BOTÃO MINHA LOCALIZAÇÃO - ÍCONE FORMAL */}
      <TouchableOpacity style={styles.myLocationButton} onPress={handleGoToMyLocation}>
        <Ionicons name="locate" size={24} color={colors.primary} />
      </TouchableOpacity>

      {/* BOTÃO MONITORAMENTO */}
      <TouchableOpacity
        style={[styles.monitorButton, isGeofencingAtivo && styles.monitorButtonActive]}
        onPress={toggleMonitoramento}
      >
        <Text style={[styles.monitorText, isGeofencingAtivo && styles.monitorTextActive]}>
          {isGeofencingAtivo ? '🟢 Monitoring' : '⚪ Monitoring OFF'}
        </Text>
      </TouchableOpacity>

      {/* LISTA DE LOCAIS (chips) */}
      {locais.length > 0 && (
        <View style={styles.localsList}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {locais.map((local) => (
              <TouchableOpacity
                key={local.id}
                style={[styles.localChip, { borderColor: local.cor }]}
                onPress={() => {
                  mapRef.current?.animateToRegion({
                    latitude: local.latitude,
                    longitude: local.longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                  }, 500);
                }}
                onLongPress={() => handleCircleLongPress(local.id, local.nome)}
              >
                <View style={[styles.localChipDot, { backgroundColor: local.cor }]} />
                <Text style={styles.localChipText} numberOfLines={1}>
                  {local.nome}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* DICA INICIAL */}
      {locais.length === 0 && !showNameModal && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>
            🗺️ Long press on the map to add a work location
          </Text>
        </View>
      )}

      {/* MODAL DE NOME DO LOCAL */}
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
                value={newLocalName}
                onChangeText={(text) => {
                  setNewLocalName(text);
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
                      newLocalRadius === r && styles.radiusOptionSmallActive,
                    ]}
                    onPress={() => setNewLocalRadius(r)}
                  >
                    <Text
                      style={[
                        styles.radiusOptionSmallText,
                        newLocalRadius === r && styles.radiusOptionSmallTextActive,
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
                  onPress={handleConfirmAddLocal}
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

      {/* MODAL DE AJUSTE DE RAIO */}
      <Modal
        visible={showRadiusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRadiusModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowRadiusModal(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.radiusModal}>
              <Text style={styles.radiusModalTitle}>📏 Adjust Radius</Text>
              <Text style={styles.radiusModalSubtitle}>
                {selectedLocal?.nome || 'Location'}
              </Text>

              <View style={styles.radiusOptions}>
                {RADIUS_OPTIONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.radiusOption,
                      selectedLocal?.raio === r && styles.radiusOptionActive,
                    ]}
                    onPress={() => handleChangeRadius(r)}
                  >
                    <Text
                      style={[
                        styles.radiusOptionText,
                        selectedLocal?.raio === r && styles.radiusOptionTextActive,
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
                  setShowRadiusModal(false);
                  if (selectedLocal) {
                    handleCircleLongPress(selectedLocal.id, selectedLocal.nome);
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  map: {
    flex: 1,
  },

  // Markers
  marker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.white,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  tempMarker: {
    backgroundColor: colors.primary,
  },
  markerText: {
    fontSize: 16,
  },

  // Search - FUNDO BRANCO
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1A1A1A',
    paddingVertical: 0,
  },
  searchResults: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 8,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  searchResultIcon: {
    marginRight: 10,
  },
  searchResultText: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A1A',
  },

  // Buttons
  myLocationButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 110,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  monitorButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 110,
    left: 16,
    backgroundColor: colors.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  monitorButtonActive: {
    backgroundColor: colors.success,
  },
  monitorText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  monitorTextActive: {
    color: colors.white,
  },

  // Locals list
  localsList: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
  },
  localChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginLeft: 12,
    borderWidth: 2,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  localChipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  localChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    maxWidth: 100,
  },

  // Hint
  hintContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: withOpacity(colors.black, 0.7),
    padding: 16,
    borderRadius: 12,
  },
  hintText: {
    color: colors.white,
    fontSize: 14,
    textAlign: 'center',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: withOpacity(colors.black, 0.5),
    justifyContent: 'center',
    alignItems: 'center',
  },
  radiusModal: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    width: width - 48,
    maxWidth: 340,
  },
  radiusModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  radiusModalSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  radiusOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  radiusOption: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    minWidth: 70,
    alignItems: 'center',
  },
  radiusOptionActive: {
    backgroundColor: colors.primary,
  },
  radiusOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  radiusOptionTextActive: {
    color: colors.black,
  },
  radiusDeleteButton: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  radiusDeleteText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '500',
  },

  // Name Modal
  nameModal: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    width: width - 48,
    maxWidth: 340,
  },
  nameModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  nameModalSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.backgroundTertiary,
  },
  nameInputError: {
    borderColor: colors.error,
    borderWidth: 2,
  },
  nameInputErrorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 6,
    textAlign: 'center',
  },
  radiusSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 10,
    textAlign: 'center',
  },
  radiusOptionsInline: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  radiusOptionSmall: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
    minWidth: 55,
    alignItems: 'center',
  },
  radiusOptionSmallActive: {
    backgroundColor: colors.primary,
  },
  radiusOptionSmallText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  radiusOptionSmallTextActive: {
    color: colors.black,
  },
  nameModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  nameModalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
  },
  nameModalCancelText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  nameModalConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  nameModalConfirmDisabled: {
    opacity: 0.6,
  },
  nameModalConfirmText: {
    fontSize: 15,
    color: colors.black,
    fontWeight: '600',
  },
});
