import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import * as Location from 'expo-location';
import Colors from '@/constants/colors';
import { X, Search, MapPin, Navigation } from 'lucide-react-native';
import { useUserStore } from '@/store/userStore';
import { loadGoogleMapsScript } from '@/components/map';

interface LocationSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectLocation: (location: { latitude: number; longitude: number }, locationName: string) => void;
}

type SearchResult = {
  latitude?: number;
  longitude?: number;
  displayName: string;
  secondaryText?: string;
  distanceKm?: number;
  placeId?: string;
  source: 'google' | 'mapbox' | 'geocode';
};

// Calculate distance between two coordinates in kilometers (Haversine formula)
const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Check if error is due to intentional fetch cancellation/abort
const isAbortOrCancel = (error: any, controller?: AbortController | null): boolean => {
  if (controller?.signal?.aborted) return true;
  if (!error) return false;
  if (error.name === 'AbortError' || error.name === 'CanceledError') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('cancel') || msg.includes('abort');
};

export default function LocationSearchModal({ visible, onClose, onSelectLocation }: LocationSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Store user location from global store first for instant zero-latency availability
  const storeLocation = useUserStore(state => state.location);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(
    () => storeLocation || null
  );

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSearchIdRef = useRef(0);
  const mapboxAbortControllerRef = useRef<AbortController | null>(null);
  const googleAbortControllerRef = useRef<AbortController | null>(null);

  const rawMapboxToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const sanitizedMapboxToken = rawMapboxToken?.trim();
  const hasMapboxToken =
    !!sanitizedMapboxToken && sanitizedMapboxToken !== 'undefined' && sanitizedMapboxToken !== 'null';

  const rawGoogleApiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
  const sanitizedGoogleApiKey = rawGoogleApiKey?.trim();
  const hasGoogleApiKey =
    !!sanitizedGoogleApiKey && sanitizedGoogleApiKey !== 'undefined' && sanitizedGoogleApiKey !== 'null';

  const createAutocompleteSessionToken = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const autocompleteSessionTokenRef = useRef<string>(createAutocompleteSessionToken());

  // Keep userLocation updated from store or device GPS
  useEffect(() => {
    if (storeLocation) {
      setUserLocation(storeLocation);
    }
  }, [storeLocation]);

  // Preload fresh GPS location and Google Maps script when modal becomes visible
  useEffect(() => {
    if (!visible) return;

    let isMounted = true;
    autocompleteSessionTokenRef.current = createAutocompleteSessionToken();

    if (Platform.OS === 'web') {
      loadGoogleMapsScript().catch(err => console.log('Google Maps script preload note:', err));

      if (!userLocation && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (isMounted) {
              setUserLocation({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
            }
          },
          (err) => console.log('Geolocation preload note:', err.message),
          { timeout: 6000, maximumAge: 60000 }
        );
      }
    }

    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          // First try instant cached position
          const lastKnown = await Location.getLastKnownPositionAsync({});
          if (lastKnown && isMounted && !userLocation) {
            setUserLocation({
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            });
          }

          // Then refresh with current position
          const freshLoc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (isMounted) {
            setUserLocation({
              latitude: freshLoc.coords.latitude,
              longitude: freshLoc.coords.longitude,
            });
          }
        }
      } catch (locError) {
        console.log('Location preload error:', locError);
      }
    })();

    return () => {
      isMounted = false;
      if (mapboxAbortControllerRef.current) {
        mapboxAbortControllerRef.current.abort();
        mapboxAbortControllerRef.current = null;
      }
      if (googleAbortControllerRef.current) {
        googleAbortControllerRef.current.abort();
        googleAbortControllerRef.current = null;
      }
    };
  }, [visible]);

  // Snappy auto-search as user types (350ms debounce)
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        handleSearch();
      }, 350);
    } else if (trimmed.length === 0) {
      setSearchResults([]);
      setErrorMessage('');
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, userLocation]);

  const handleSearch = async () => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length < 2) return;

    const searchId = ++latestSearchIdRef.current;
    setIsSearching(true);
    setErrorMessage('');

    // 0. WEB ENGINE: Google Places JS AutocompleteService + Nominatim Fallback
    if (Platform.OS === 'web') {
      const google = typeof window !== 'undefined' ? (window as any).google : null;
      if (google?.maps?.places?.AutocompleteService) {
        try {
          const service = new google.maps.places.AutocompleteService();
          const request: any = {
            input: trimmedQuery,
          };
          if (userLocation) {
            request.location = new google.maps.LatLng(userLocation.latitude, userLocation.longitude);
            request.radius = 40000;
            request.origin = new google.maps.LatLng(userLocation.latitude, userLocation.longitude);
          }

          const predictions: any[] = await new Promise((resolve) => {
            service.getPlacePredictions(request, (preds: any, status: any) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && Array.isArray(preds)) {
                resolve(preds);
              } else {
                resolve([]);
              }
            });
          });

          if (latestSearchIdRef.current !== searchId) return;

          if (predictions.length > 0) {
            const webResults: SearchResult[] = predictions.map((pred: any) => {
              const distanceKm = pred.distance_meters ? pred.distance_meters / 1000 : undefined;
              return {
                displayName: pred?.structured_formatting?.main_text || pred.description?.split(',')[0] || trimmedQuery,
                secondaryText: pred?.structured_formatting?.secondary_text || (pred.description ? pred.description.split(',').slice(1).join(', ').trim() : ''),
                distanceKm,
                placeId: pred.place_id,
                source: 'google' as const,
              };
            });

            setSearchResults(webResults);
            setIsSearching(false);
            return;
          }
        } catch (webErr) {
          console.warn('Google JS Places Autocomplete note:', webErr);
        }
      }

      // Web Fallback: OpenStreetMap Nominatim API (fully CORS-enabled on all browsers)
      try {
        let nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmedQuery)}&addressdetails=1&limit=8`;
        if (userLocation) {
          const left = userLocation.longitude - 0.5;
          const right = userLocation.longitude + 0.5;
          const top = userLocation.latitude + 0.5;
          const bottom = userLocation.latitude - 0.5;
          nomUrl += `&viewbox=${left},${top},${right},${bottom}&bounded=0`;
        }

        const nomRes = await fetch(nomUrl, {
          headers: { 'Accept-Language': 'en' },
        });

        if (nomRes.ok) {
          const nomData = await nomRes.json();
          if (Array.isArray(nomData) && nomData.length > 0) {
            const nomResults: SearchResult[] = nomData.map((item: any) => {
              const lat = parseFloat(item.lat);
              const lon = parseFloat(item.lon);
              let distanceKm: number | undefined;
              if (userLocation && Number.isFinite(lat) && Number.isFinite(lon)) {
                distanceKm = calculateDistanceKm(userLocation.latitude, userLocation.longitude, lat, lon);
              }
              return {
                displayName: item.name || item.display_name?.split(',')[0] || trimmedQuery,
                secondaryText: item.display_name?.split(',').slice(1, 4).join(', ').trim(),
                latitude: lat,
                longitude: lon,
                distanceKm,
                placeId: String(item.place_id),
                source: 'google' as const,
              };
            });

            if (latestSearchIdRef.current === searchId) {
              setSearchResults(nomResults);
              setIsSearching(false);
              return;
            }
          }
        }
      } catch (nomErr) {
        console.warn('Nominatim fallback note:', nomErr);
      }
    }

    // 1. PRIMARY NATIVE ENGINE: Google Places API (with proximity bias & TextSearch fallback)
    if (hasGoogleApiKey) {
      if (googleAbortControllerRef.current) {
        googleAbortControllerRef.current.abort();
      }

      const controller = new AbortController();
      googleAbortControllerRef.current = controller;

      try {
        // Construct autocomplete params. NOTE: We deliberately DO NOT restrict to types="geocode"
        // so that establishments (cafes, restaurants, stores, gyms, hangout spots) are found!
        const autoParams = new URLSearchParams({
          input: trimmedQuery,
          key: sanitizedGoogleApiKey!,
          language: 'en',
          sessiontoken: autocompleteSessionTokenRef.current,
        });

        // Add user location & origin for distance calculations and local prioritization
        if (userLocation) {
          autoParams.append('location', `${userLocation.latitude},${userLocation.longitude}`);
          autoParams.append('radius', '40000'); // 40 km bias radius
          autoParams.append('origin', `${userLocation.latitude},${userLocation.longitude}`);
        }

        const autoResponse = await fetch(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?${autoParams.toString()}`,
          { signal: controller.signal }
        );

        const autoData = await autoResponse.json();

        if (latestSearchIdRef.current !== searchId) return;

        let results: SearchResult[] = [];

        if (autoData.status === 'OK' && Array.isArray(autoData.predictions) && autoData.predictions.length > 0) {
          const rawPredictions = autoData.predictions;

          // Process predictions
          results = rawPredictions.map((pred: any) => {
            const distanceKm = pred.distance_meters ? pred.distance_meters / 1000 : undefined;
            return {
              displayName:
                pred?.structured_formatting?.main_text ||
                pred.description?.split(',')[0] ||
                pred.description ||
                trimmedQuery,
              secondaryText:
                pred?.structured_formatting?.secondary_text ||
                (pred.description ? pred.description.split(',').slice(1).join(',').trim() : undefined),
              distanceKm,
              placeId: pred.place_id,
              source: 'google' as const,
            };
          });

          // If we have distance info, filter out results that are excessively far (e.g. > 150 km)
          // when nearby results exist, so users don't see random foreign countries
          if (userLocation) {
            const nearbyResults = results.filter(r => r.distanceKm !== undefined && r.distanceKm <= 100);
            if (nearbyResults.length > 0) {
              results = nearbyResults.sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
            }
          }
        }

        // 2. FALLBACK: If Autocomplete returned 0 results (e.g. colloquial cafe name or typo),
        // try Google Places TextSearch which excels at finding places by name/category
        if (results.length === 0) {
          const textParams = new URLSearchParams({
            query: trimmedQuery,
            key: sanitizedGoogleApiKey!,
            language: 'en',
          });

          if (userLocation) {
            textParams.append('location', `${userLocation.latitude},${userLocation.longitude}`);
            textParams.append('radius', '40000');
          }

          const textResponse = await fetch(
            `https://maps.googleapis.com/maps/api/place/textsearch/json?${textParams.toString()}`,
            { signal: controller.signal }
          );

          const textData = await textResponse.json();

          if (latestSearchIdRef.current !== searchId) return;

          if (textData.status === 'OK' && Array.isArray(textData.results) && textData.results.length > 0) {
            results = textData.results.slice(0, 8).map((place: any) => {
              const lat = place.geometry?.location?.lat;
              const lng = place.geometry?.location?.lng;
              let distanceKm: number | undefined;

              if (userLocation && lat && lng) {
                distanceKm = calculateDistanceKm(
                  userLocation.latitude,
                  userLocation.longitude,
                  lat,
                  lng
                );
              }

              return {
                displayName: place.name || trimmedQuery,
                secondaryText: place.formatted_address || '',
                latitude: lat,
                longitude: lng,
                distanceKm,
                placeId: place.place_id,
                source: 'google' as const,
              };
            });

            // Filter out places farther than 100km if closer places exist
            if (userLocation) {
              const nearby = results.filter(r => r.distanceKm !== undefined && r.distanceKm <= 100);
              if (nearby.length > 0) {
                results = nearby.sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
              }
            }
          }
        }

        if (latestSearchIdRef.current !== searchId) return;

        setSearchResults(results);
        if (results.length === 0) {
          setErrorMessage('No places found nearby. Try searching with a different name or area.');
        }
      } catch (error: any) {
        if (isAbortOrCancel(error, controller)) return;
        console.error('Google Places search error:', error);
        if (latestSearchIdRef.current !== searchId) return;
        setErrorMessage('Unable to fetch suggestions. Please check your connection.');
        setSearchResults([]);
      } finally {
        if (latestSearchIdRef.current === searchId) {
          setIsSearching(false);
        }
        if (googleAbortControllerRef.current === controller) {
          googleAbortControllerRef.current = null;
        }
      }
      return;
    }

    // 3. SECONDARY ENGINE: Mapbox Places API (with proximity)
    if (hasMapboxToken) {
      if (mapboxAbortControllerRef.current) {
        mapboxAbortControllerRef.current.abort();
      }

      const controller = new AbortController();
      mapboxAbortControllerRef.current = controller;

      try {
        const params = new URLSearchParams({
          access_token: sanitizedMapboxToken!,
          autocomplete: 'true',
          limit: '8',
          language: 'en',
          types: 'poi,address,neighborhood,place,locality',
        });

        if (userLocation) {
          params.append('proximity', `${userLocation.longitude},${userLocation.latitude}`);
        }

        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmedQuery)}.json?${params.toString()}`,
          { signal: controller.signal }
        );

        const data = await response.json();
        const features = Array.isArray(data?.features) ? data.features : [];

        if (latestSearchIdRef.current !== searchId) return;

        const formattedResults: SearchResult[] = features
          .map((feature: any) => {
            const [lng, lat] = feature?.center || [];
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

            let distanceKm: number | undefined;
            if (userLocation) {
              distanceKm = calculateDistanceKm(userLocation.latitude, userLocation.longitude, lat, lng);
            }

            return {
              latitude: lat,
              longitude: lng,
              displayName: feature?.text || feature?.place_name?.split(',')[0] || trimmedQuery,
              secondaryText: feature?.place_name?.split(',').slice(1).join(',').trim(),
              distanceKm,
              placeId: feature?.id,
              source: 'mapbox' as const,
            };
          })
          .filter((res: SearchResult | null): res is SearchResult => res !== null);

        // Filter out results in other countries if within 100km
        const nearby = userLocation
          ? formattedResults.filter(r => r.distanceKm !== undefined && r.distanceKm <= 100)
          : formattedResults;

        const finalResults = nearby.length > 0 ? nearby : formattedResults;
        setSearchResults(finalResults);

        if (finalResults.length === 0) {
          setErrorMessage('No places found nearby. Try a different search term.');
        }
      } catch (error: any) {
        if (isAbortOrCancel(error, controller)) return;
        console.error('Mapbox search error:', error);
        if (latestSearchIdRef.current !== searchId) return;
        setErrorMessage('Unable to fetch suggestions. Please try again.');
        setSearchResults([]);
      } finally {
        if (latestSearchIdRef.current === searchId) {
          setIsSearching(false);
        }
        if (mapboxAbortControllerRef.current === controller) {
          mapboxAbortControllerRef.current = null;
        }
      }
      return;
    }

    // 4. TERTIARY ENGINE: Expo Native Geocoding with Distance Filtering
    try {
      const searchVariations = [trimmedQuery, `${trimmedQuery}, nearby`];
      let allResults: Location.LocationGeocodedLocation[] = [];

      for (const variation of searchVariations) {
        if (latestSearchIdRef.current !== searchId) return;
        try {
          const results = await Location.geocodeAsync(variation);
          if (results && results.length > 0) {
            allResults = [...allResults, ...results];
          }
        } catch {
          // Ignore and continue
        }
      }

      if (latestSearchIdRef.current !== searchId) return;

      if (allResults.length === 0) {
        setErrorMessage('No places found. Try a different search term.');
        setSearchResults([]);
        return;
      }

      // Filter duplicates
      const uniqueResults: Location.LocationGeocodedLocation[] = [];
      for (const res of allResults) {
        const isDup = uniqueResults.some(
          u => calculateDistanceKm(res.latitude, res.longitude, u.latitude, u.longitude) < 0.1
        );
        if (!isDup) uniqueResults.push(res);
      }

      // Filter by proximity (within 50 km) if userLocation is known
      let filtered = uniqueResults;
      if (userLocation) {
        filtered = uniqueResults.filter(
          r => calculateDistanceKm(userLocation.latitude, userLocation.longitude, r.latitude, r.longitude) <= 60
        );
        if (filtered.length === 0) {
          filtered = uniqueResults;
        }
      }

      const topResults = filtered.slice(0, 8);
      const formattedResults: SearchResult[] = await Promise.all(
        topResults.map(async (res, idx) => {
          let distKm: number | undefined;
          if (userLocation) {
            distKm = calculateDistanceKm(userLocation.latitude, userLocation.longitude, res.latitude, res.longitude);
          }

          try {
            const rev = await Location.reverseGeocodeAsync({
              latitude: res.latitude,
              longitude: res.longitude,
            });
            if (rev && rev.length > 0) {
              const p = rev[0];
              const title = p.name || p.street || trimmedQuery;
              const subtitle = [p.subregion, p.city, p.region].filter(Boolean).join(', ');
              return {
                latitude: res.latitude,
                longitude: res.longitude,
                displayName: title,
                secondaryText: subtitle,
                distanceKm: distKm,
                source: 'geocode' as const,
              };
            }
          } catch {
            // Reverse geocode failed
          }

          return {
            latitude: res.latitude,
            longitude: res.longitude,
            displayName: `${trimmedQuery} (Option ${idx + 1})`,
            distanceKm: distKm,
            source: 'geocode' as const,
          };
        })
      );

      if (latestSearchIdRef.current !== searchId) return;
      setSearchResults(formattedResults);
    } catch (error) {
      console.error('Native geocode error:', error);
      if (latestSearchIdRef.current === searchId) {
        setErrorMessage('Could not search for location. Please check your internet connection.');
        setSearchResults([]);
      }
    } finally {
      if (latestSearchIdRef.current === searchId) {
        setIsSearching(false);
      }
    }
  };

  // Fetch coordinates for Google Autocomplete prediction
  const fetchGooglePlaceDetails = async (placeId: string) => {
    if (!hasGoogleApiKey) return null;

    try {
      const params = new URLSearchParams({
        place_id: placeId,
        key: sanitizedGoogleApiKey!,
        language: 'en',
        fields: 'geometry/location,formatted_address,name',
        sessiontoken: autocompleteSessionTokenRef.current,
      });

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (data.status !== 'OK') return null;

      const loc = data.result?.geometry?.location;
      if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;

      const displayName = data.result?.name || data.result?.formatted_address || 'Selected location';

      return {
        latitude: loc.lat as number,
        longitude: loc.lng as number,
        displayName,
      };
    } catch (error: any) {
      if (isAbortOrCancel(error)) return null;
      console.error('Google Place details error:', error);
      return null;
    }
  };

  const handleSelectResult = async (result: SearchResult) => {
    // Clear pending debounce search timer immediately so no new search fires
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    // Cancel in-flight background search
    if (googleAbortControllerRef.current) {
      googleAbortControllerRef.current.abort();
      googleAbortControllerRef.current = null;
    }

    let latitude = result.latitude;
    let longitude = result.longitude;
    let displayName = result.displayName;

    if (
      Platform.OS === 'web' &&
      result.placeId &&
      (latitude === undefined || longitude === undefined) &&
      typeof window !== 'undefined' &&
      (window as any).google?.maps?.places?.PlacesService
    ) {
      setIsSearching(true);
      try {
        const dummyDiv = document.createElement('div');
        const placesService = new (window as any).google.maps.places.PlacesService(dummyDiv);

        const details: any = await new Promise((resolve) => {
          placesService.getDetails(
            { placeId: result.placeId, fields: ['geometry', 'name', 'formatted_address'] },
            (place: any, status: any) => {
              if (status === (window as any).google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                resolve({
                  latitude: place.geometry.location.lat(),
                  longitude: place.geometry.location.lng(),
                  displayName: place.name || result.displayName,
                });
              } else {
                resolve(null);
              }
            }
          );
        });

        if (details) {
          latitude = details.latitude;
          longitude = details.longitude;
          displayName = details.displayName;
        }
      } catch (err) {
        console.warn('Web place details error:', err);
      } finally {
        setIsSearching(false);
      }
    }

    if (
      Platform.OS !== 'web' &&
      result.source === 'google' &&
      result.placeId &&
      hasGoogleApiKey &&
      (latitude === undefined || longitude === undefined)
    ) {
      setIsSearching(true);
      try {
        const details = await fetchGooglePlaceDetails(result.placeId);
        if (!details) {
          Alert.alert(
            'Location unavailable',
            'Could not load coordinates for this place. Please try another search.'
          );
          return;
        }
        latitude = details.latitude;
        longitude = details.longitude;
        displayName = details.displayName;
      } finally {
        setIsSearching(false);
      }
    }

    if (latitude === undefined || longitude === undefined) {
      Alert.alert(
        'Location unavailable',
        'Could not load coordinates for this place. Please try another search.'
      );
      return;
    }

    autocompleteSessionTokenRef.current = createAutocompleteSessionToken();

    const coordinate = {
      latitude,
      longitude,
    };

    onSelectLocation(coordinate, displayName);
    setSearchQuery('');
    setSearchResults([]);
    setErrorMessage('');
  };

  const handleClose = () => {
    if (mapboxAbortControllerRef.current) {
      mapboxAbortControllerRef.current.abort();
      mapboxAbortControllerRef.current = null;
    }
    if (googleAbortControllerRef.current) {
      googleAbortControllerRef.current.abort();
      googleAbortControllerRef.current = null;
    }
    setSearchQuery('');
    setSearchResults([]);
    setErrorMessage('');
    setIsSearching(false);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      transparent={false}
      statusBarTranslucent={false}
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.container}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <X size={26} color={Colors.primary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Meeting Location</Text>
            <View style={{ width: 26 }} />
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <View style={styles.searchBar}>
              <Search size={20} color={Colors.primary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search cafes, restaurants, places..."
                placeholderTextColor={Colors.darkGray}
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
                onSubmitEditing={handleSearch}
                autoFocus
                autoCorrect={false}
              />
              {searchQuery.length > 0 && !isSearching && (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <X size={18} color={Colors.gray} />
                </TouchableOpacity>
              )}
              {isSearching && (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 6 }} />
              )}
            </View>
          </View>

          {/* Search Results */}
          <ScrollView style={styles.resultsContainer} keyboardShouldPersistTaps="handled">
            {errorMessage ? (
              <View style={styles.errorState}>
                <Search size={44} color={Colors.gray} />
                <Text style={styles.errorTitle}>No places found</Text>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : searchResults.length > 0 ? (
              <View style={styles.resultsList}>
                <Text style={styles.resultsTitle}>Nearby Locations</Text>
                {searchResults.map((result, index) => (
                  <TouchableOpacity
                    key={result.placeId ?? `${result.latitude}-${result.longitude}-${index}`}
                    style={styles.resultItem}
                    onPress={() => handleSelectResult(result)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.resultIconContainer}>
                      <MapPin size={20} color={Colors.primary} />
                    </View>
                    <View style={styles.resultTextContainer}>
                      <Text style={styles.resultName} numberOfLines={1}>
                        {result.displayName}
                      </Text>
                      <View style={styles.subtitleRow}>
                        {result.distanceKm !== undefined && (
                          <View style={styles.distanceBadge}>
                            <Navigation size={10} color={Colors.primary} style={{ transform: [{ rotate: '45deg' }] }} />
                            <Text style={styles.distanceText}>
                              {result.distanceKm < 1
                                ? `${Math.round(result.distanceKm * 1000)} m`
                                : `${result.distanceKm.toFixed(1)} km`}
                            </Text>
                          </View>
                        )}
                        {result.secondaryText ? (
                          <Text style={styles.resultSecondary} numberOfLines={1}>
                            {result.secondaryText}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconCircle}>
                  <MapPin size={36} color={Colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>Find a Place to Meet</Text>
                <Text style={styles.emptySubtitle}>
                  Search for nearby cafes, restaurants, coffee shops, malls, or landmarks.
                </Text>

                <View style={styles.quickSuggestions}>
                  <Text style={styles.suggestionsHeader}>Popular Searches:</Text>
                  <View style={styles.tagsContainer}>
                    {['Cafe', 'Coffee Shop', 'Starbucks', 'Restaurant', 'Metro Station', 'Mall'].map(tag => (
                      <TouchableOpacity
                        key={tag}
                        style={styles.tagButton}
                        onPress={() => setSearchQuery(tag)}
                      >
                        <Text style={styles.tagText}>{tag}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.white, alignItems: 'center' },
  container: { flex: 1, backgroundColor: Colors.white, width: '100%', maxWidth: 580, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: Colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  closeButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.black,
    padding: 0,
  },
  resultsContainer: { flex: 1 },
  resultsList: {
    paddingBottom: 30,
  },
  resultsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
    backgroundColor: Colors.white,
  },
  resultIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  resultTextContainer: {
    flex: 1,
  },
  resultName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 8,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  distanceText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  resultSecondary: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 30,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  quickSuggestions: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  suggestionsHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagButton: {
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  errorState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginTop: 14,
    marginBottom: 6,
  },
  errorText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
