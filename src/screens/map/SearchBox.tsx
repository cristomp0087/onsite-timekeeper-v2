/**
 * SearchBox Component - OnSite Timekeeper
 * 
 * Memoized search component to prevent MapView re-renders
 * when user types in the search input.
 * 
 * IMPROVED:
 * - Shows distance from current location
 * - Better visual feedback
 * - Clearer result formatting
 */

import React, { memo, useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Text,
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { 
  buscarEnderecoAutocomplete, 
  formatarEnderecoResumido,
} from '../../lib/geocoding';
import { AUTOCOMPLETE_DELAY, type SearchResult } from './constants';
import { logger } from '../../lib/logger';

// ============================================
// TYPES
// ============================================

interface SearchBoxProps {
  currentLatitude?: number;
  currentLongitude?: number;
  onSelectResult: (result: SearchResult) => void;
}

// ============================================
// HELPERS
// ============================================

function formatDistance(distancia?: number): string {
  if (distancia === undefined) return '';
  if (distancia < 1) {
    return `${Math.round(distancia * 1000)}m`;
  }
  if (distancia < 10) {
    return `${distancia.toFixed(1)}km`;
  }
  return `${Math.round(distancia)}km`;
}

function getDistanceColor(distancia?: number): string {
  if (distancia === undefined) return colors.textMuted;
  if (distancia < 5) return '#22C55E';    // Green - very close
  if (distancia < 20) return '#3B82F6';   // Blue - nearby
  if (distancia < 100) return '#F59E0B';  // Orange - moderate
  return '#EF4444';                        // Red - far
}

// ============================================
// COMPONENT
// ============================================

export const SearchBox = memo(function SearchBox({
  currentLatitude,
  currentLongitude,
  onSelectResult,
}: SearchBoxProps) {
  const inputRef = useRef<TextInput>(null);
  const autocompleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autocompleteTimeout.current) {
        clearTimeout(autocompleteTimeout.current);
      }
    };
  }, []);

  // Handle search input change with debounce
  const handleSearchChange = useCallback((text: string) => {
    setQuery(text);

    // Cancel previous search
    if (autocompleteTimeout.current) {
      clearTimeout(autocompleteTimeout.current);
    }

    // If text too short, clear results
    if (text.length < 3) {
      setResults([]);
      setShowResults(false);
      return;
    }

    // Debounce: wait for user to stop typing
    setIsSearching(true);
    autocompleteTimeout.current = setTimeout(async () => {
      try {
        logger.debug('ui', `🔍 Searching: "${text}"`);
        const searchResults = await buscarEnderecoAutocomplete(
          text,
          currentLatitude,
          currentLongitude
        );
        setResults(searchResults);
        setShowResults(searchResults.length > 0);
        
        if (searchResults.length > 0) {
          logger.debug('ui', `✅ Found ${searchResults.length} results`, {
            closest: searchResults[0].distancia ? `${searchResults[0].distancia.toFixed(1)}km` : 'n/a',
          });
        }
      } catch (error) {
        logger.error('ui', 'Autocomplete error', { error: String(error) });
      } finally {
        setIsSearching(false);
      }
    }, AUTOCOMPLETE_DELAY);
  }, [currentLatitude, currentLongitude]);

  // Handle result selection
  const handleSelectResult = useCallback((result: SearchResult) => {
    logger.debug('ui', `📍 Selected: ${formatarEnderecoResumido(result.endereco)}`, {
      distance: result.distancia ? `${result.distancia.toFixed(1)}km` : 'n/a',
    });
    setShowResults(false);
    setQuery('');
    Keyboard.dismiss();
    onSelectResult(result);
  }, [onSelectResult]);

  // Clear search
  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setShowResults(false);
  }, []);

  // Handle submit (enter key)
  const handleSubmit = useCallback(async () => {
    if (query.length < 3) return;

    setIsSearching(true);
    try {
      const searchResults = await buscarEnderecoAutocomplete(
        query,
        currentLatitude,
        currentLongitude
      );
      setResults(searchResults);
      setShowResults(true);
    } catch (error) {
      logger.error('ui', 'Search error', { error: String(error) });
    } finally {
      setIsSearching(false);
    }
  }, [query, currentLatitude, currentLongitude]);

  // Handle blur (user taps outside) - close results with delay
  // Delay allows result selection to process first
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setShowResults(false);
    }, 200);
  }, []);

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color="#666666" style={styles.icon} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Search address or place..."
          placeholderTextColor="#999999"
          value={query}
          onChangeText={handleSearchChange}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          onFocus={() => setShowResults(results.length > 0)}
          onBlur={handleBlur}
        />
        {isSearching && (
          <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
        )}
        {query.length > 0 && !isSearching && (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-circle" size={20} color="#999999" />
          </TouchableOpacity>
        )}
      </View>

      {/* Results dropdown */}
      {showResults && results.length > 0 && (
        <View style={styles.results}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.resultsList}>
            {results.map((result, index) => (
              <TouchableOpacity
                key={`${result.latitude}-${result.longitude}-${index}`}
                style={styles.resultItem}
                onPress={() => handleSelectResult(result)}
              >
                <View style={styles.resultIconContainer}>
                  <Ionicons name="location" size={16} color={colors.primary} />
                </View>
                <View style={styles.resultContent}>
                  <Text style={styles.resultText} numberOfLines={2}>
                    {formatarEnderecoResumido(result.endereco)}
                  </Text>
                  {result.cidade && (
                    <Text style={styles.resultSubtext} numberOfLines={1}>
                      {[result.cidade, result.estado, result.pais].filter(Boolean).join(', ')}
                    </Text>
                  )}
                </View>
                {result.distancia !== undefined && (
                  <View style={styles.distanceBadge}>
                    <Text style={[styles.distanceText, { color: getDistanceColor(result.distancia) }]}>
                      {formatDistance(result.distancia)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
          
          {/* Hint at bottom */}
          {currentLatitude && (
            <View style={styles.resultsHint}>
              <Ionicons name="navigate" size={12} color={colors.textMuted} />
              <Text style={styles.resultsHintText}>
                Sorted by distance from you
              </Text>
            </View>
          )}
        </View>
      )}

      {/* No results message */}
      {showResults && results.length === 0 && !isSearching && query.length >= 3 && (
        <View style={styles.noResults}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <Text style={styles.noResultsText}>No addresses found</Text>
        </View>
      )}
    </View>
  );
});

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
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
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  icon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1A1A1A',
    paddingVertical: 0,
  },
  loader: {
    marginRight: 8,
  },
  results: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    overflow: 'hidden',
  },
  resultsList: {
    maxHeight: 280,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  resultIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: `${colors.primary}15`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  resultContent: {
    flex: 1,
  },
  resultText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1A1A1A',
    lineHeight: 18,
  },
  resultSubtext: {
    fontSize: 12,
    color: '#666666',
    marginTop: 2,
  },
  distanceBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F5F5F5',
    borderRadius: 6,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
  },
  resultsHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    backgroundColor: '#FAFAFA',
    gap: 4,
  },
  resultsHintText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  noResults: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 8,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    gap: 8,
  },
  noResultsText: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
