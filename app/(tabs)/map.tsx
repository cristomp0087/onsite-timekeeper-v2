/**
 * Map Screen - OnSite Timekeeper
 * 
 * Tela simplificada para gerenciar locais de trabalho
 * - Busca por endereço no topo
 * - Clique no mapa = pin temporário
 * - Botão +Add Local = confirma
 * - Long press no círculo = deletar
 * - Clique no círculo = ajustar raio
 */

import React, { useState, useRef, useEffect } from 'react';
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
} from 'react-native';
import MapView, { Marker, Circle, Region, PROVIDER_DEFAULT } from 'react-native-maps';
import { colors, withOpacity, getRandomGeofenceColor } from '../../src/constants/colors';
import { useLocationStore } from '../../src/stores/locationStore';
import { buscarEndereco, formatarEnderecoResumido } from '../../src/lib/geocoding';

const { width, height } = Dimensions.get('window');

// Região default (Ottawa, CA)
const DEFAULT_REGION: Region = {
  latitude: 45.4215,
  longitude: -75.6972,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

// Raio padrão em metros
const DEFAULT_RADIUS = 50;

// Opções de raio disponíveis
const RADIUS_OPTIONS = [30, 50, 75, 100, 150, 200];

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const searchInputRef = useRef<TextInput>(null);
  
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
  
  // Modal de nome do local (Android não suporta Alert.prompt)
  const [showNameModal, setShowNameModal] = useState(false);
  const [newLocalName, setNewLocalName] = useState('');

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
    setShowNameModal(true);
  };

  const handleSearch = async () => {
    if (searchQuery.length < 3) {
      Alert.alert('Busca', 'Digite pelo menos 3 caracteres');
      return;
    }
    
    setIsSearching(true);
    try {
      const results = await buscarEndereco(searchQuery);
      setSearchResults(results);
      setShowSearchResults(true);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível buscar o endereço');
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
      Alert.alert('GPS', 'Localização não disponível');
    }
  };

  const handleConfirmAddLocal = async () => {
    if (!newLocalName.trim()) {
      Alert.alert('Erro', 'Digite um nome para o local');
      return;
    }
    if (!tempPin) return;
    
    setIsAdding(true);
    try {
      await adicionarLocal({
        nome: newLocalName.trim(),
        latitude: tempPin.lat,
        longitude: tempPin.lng,
        raio: DEFAULT_RADIUS,
        cor: getRandomGeofenceColor(),
      });
      
      // Limpa
      setTempPin(null);
      setShowNameModal(false);
      setNewLocalName('');
      
      // Feedback
      Alert.alert('✅ Sucesso', `Local "${newLocalName}" adicionado!`);
    } catch (error: any) {
      Alert.alert('Erro', error.message || 'Não foi possível adicionar');
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
      '🗑️ Remover Local',
      `Deseja remover "${localNome}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            try {
              await removerLocal(localId);
            } catch (error: any) {
              Alert.alert('Erro', error.message || 'Não foi possível remover');
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
      Alert.alert('Erro', error.message || 'Não foi possível alterar o raio');
    }
  };

  const toggleMonitoramento = () => {
    if (isGeofencingAtivo) {
      pararMonitoramento();
    } else {
      if (locais.length === 0) {
        Alert.alert('Aviso', 'Adicione pelo menos um local primeiro');
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
              tappable={true}
              onPress={() => handleCirclePress(local.id)}
            />
            <Marker
              coordinate={{ latitude: local.latitude, longitude: local.longitude }}
              title={local.nome}
              description={`Raio: ${local.raio}m`}
              onPress={() => handleCirclePress(local.id)}
              onCalloutPress={() => handleCirclePress(local.id)}
            >
              <View style={[styles.marker, { backgroundColor: local.cor }]}>
                <Text style={styles.markerText}>📍</Text>
              </View>
            </Marker>
          </React.Fragment>
        ))}

        {/* Pin temporário */}
        {tempPin && (
          <>
            <Circle
              center={{ latitude: tempPin.lat, longitude: tempPin.lng }}
              radius={DEFAULT_RADIUS}
              fillColor={withOpacity(colors.primary, 0.2)}
              strokeColor={colors.primary}
              strokeWidth={2}
              lineDashPattern={[5, 5]}
            />
            <Marker
              coordinate={{ latitude: tempPin.lat, longitude: tempPin.lng }}
              draggable
              onDragEnd={(e) => {
                const { latitude, longitude } = e.nativeEvent.coordinate;
                setTempPin({ lat: latitude, lng: longitude });
              }}
            >
              <View style={[styles.marker, styles.tempMarker]}>
                <Text style={styles.markerText}>📌</Text>
              </View>
            </Marker>
          </>
        )}
      </MapView>

      {/* CAIXA DE BUSCA */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Buscar endereço..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            onFocus={() => setShowSearchResults(searchResults.length > 0)}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setShowSearchResults(false); }}>
              <Text style={styles.clearIcon}>✕</Text>
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
                  <Text style={styles.searchResultIcon}>📍</Text>
                  <Text style={styles.searchResultText} numberOfLines={2}>
                    {formatarEnderecoResumido(result.endereco)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* BOTÃO MINHA LOCALIZAÇÃO */}
      <TouchableOpacity style={styles.myLocationButton} onPress={handleGoToMyLocation}>
        <Text style={styles.buttonIcon}>🎯</Text>
      </TouchableOpacity>

      {/* BOTÃO MONITORAMENTO */}
      <TouchableOpacity
        style={[styles.monitorButton, isGeofencingAtivo && styles.monitorButtonActive]}
        onPress={toggleMonitoramento}
      >
        <Text style={[styles.monitorText, isGeofencingAtivo && styles.monitorTextActive]}>
          {isGeofencingAtivo ? '🟢 Monitorando' : '⚪ Monitoramento OFF'}
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
                <Text style={styles.localChipText} numberOfLines={1}>{local.nome}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* BOTÃO +ADD LOCAL (só aparece se tem pin mas fechou o popup) */}
      {tempPin && !showNameModal && (
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            setNewLocalName('');
            setShowNameModal(true);
          }}
          disabled={isAdding}
        >
          <Text style={styles.addButtonText}>
            {isAdding ? '⏳' : '+'} Add Local
          </Text>
        </TouchableOpacity>
      )}

      {/* DICA quando não tem pin */}
      {!tempPin && locais.length === 0 && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>
            👆 Pressione e segure no mapa ou busque um endereço para adicionar um local
          </Text>
        </View>
      )}

      {/* MODAL AJUSTAR RAIO */}
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
          <View style={styles.radiusModal}>
            <Text style={styles.radiusModalTitle}>
              📏 Ajustar Raio
            </Text>
            {selectedLocal && (
              <Text style={styles.radiusModalSubtitle}>
                {selectedLocal.nome} • Atual: {selectedLocal.raio}m
              </Text>
            )}
            
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
                  <Text style={[
                    styles.radiusOptionText,
                    selectedLocal?.raio === r && styles.radiusOptionTextActive,
                  ]}>
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
              <Text style={styles.radiusDeleteText}>🗑️ Remover Local</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL NOME DO LOCAL */}
      <Modal
        visible={showNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNameModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowNameModal(false)}
        >
          <View style={styles.nameModal}>
            <Text style={styles.nameModalTitle}>📍 Nome do Local</Text>
            <Text style={styles.nameModalSubtitle}>
              Digite um nome para identificar este local
            </Text>
            
            <TextInput
              style={styles.nameInput}
              placeholder="Ex: Escritório, Obra Centro..."
              placeholderTextColor={colors.textSecondary}
              value={newLocalName}
              onChangeText={setNewLocalName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleConfirmAddLocal}
            />
            
            <View style={styles.nameModalActions}>
              <TouchableOpacity
                style={styles.nameModalCancel}
                onPress={() => setShowNameModal(false)}
              >
                <Text style={styles.nameModalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.nameModalConfirm, isAdding && styles.nameModalConfirmDisabled]}
                onPress={handleConfirmAddLocal}
                disabled={isAdding}
              >
                <Text style={styles.nameModalConfirmText}>
                  {isAdding ? '⏳' : 'Adicionar'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  // Markers
  marker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.white,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  tempMarker: {
    backgroundColor: colors.primary,
    borderStyle: 'dashed',
  },
  markerText: {
    fontSize: 18,
  },

  // Search
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 16,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
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
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
  },
  clearIcon: {
    fontSize: 16,
    color: colors.textSecondary,
    padding: 4,
  },
  searchResults: {
    backgroundColor: colors.white,
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
    borderBottomColor: colors.border,
  },
  searchResultIcon: {
    fontSize: 14,
    marginRight: 10,
  },
  searchResultText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },

  // Buttons
  myLocationButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 86,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  buttonIcon: {
    fontSize: 22,
  },

  monitorButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 130 : 86,
    left: 16,
    backgroundColor: colors.white,
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
    backgroundColor: colors.white,
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

  // Add button
  addButton: {
    position: 'absolute',
    bottom: 90,
    right: 16,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 25,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.white,
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
    backgroundColor: colors.white,
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
    color: colors.white,
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
    backgroundColor: colors.white,
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
    backgroundColor: colors.backgroundSecondary,
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
    color: colors.white,
    fontWeight: '600',
  },
});
