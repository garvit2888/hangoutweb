import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
  createContext,
  useContext,
} from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';

export const PROVIDER_APPLE = 'apple';
export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = 'default';

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapPressEvent {
  nativeEvent: {
    coordinate: {
      latitude: number;
      longitude: number;
    };
  };
}

interface MapContextValue {
  map: any | null;
  isReady: boolean;
  projectCoordinate: (lat: number, lng: number) => { x: number; y: number } | null;
  zoom: number;
}

const MapContext = createContext<MapContextValue>({
  map: null,
  isReady: false,
  projectCoordinate: () => null,
  zoom: 14,
});

// Converts latitudeDelta to Google Maps zoom level
const deltaToZoom = (delta: number) => {
  if (!delta || delta <= 0) return 14;
  const zoom = Math.round(Math.log(360 / delta) / Math.LN2);
  return Math.min(Math.max(zoom, 1), 20);
};

// Converts Google Maps zoom level to latitudeDelta
const zoomToDelta = (zoom: number) => {
  return 360 / Math.pow(2, zoom);
};

// Sleek dark-mode Google Maps style matching app's theme
const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  {
    featureType: 'administrative.country',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#4b6878' }]
  },
  {
    featureType: 'administrative.province',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#4b6878' }]
  },
  {
    featureType: 'landscape.man_made',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#334e68' }]
  },
  {
    featureType: 'landscape.natural',
    elementType: 'geometry',
    stylers: [{ color: '#021019' }]
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#283d6a' }]
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6f9ba5' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#304a7d' }]
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#98a5be' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#2c6675' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#255e63' }]
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#2f3948' }]
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#d59563' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0e1626' }]
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4e6d70' }]
  }
];

let googleMapsScriptPromise: Promise<void> | null = null;

export function loadGoogleMapsScript(apiKey?: string): Promise<void> {
  const key = apiKey || process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || 'AIzaSyBzT2XnCZqhhBUFsQP293T2Hc22bTQgyj0';
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).google && (window as any).google.maps) {
    return Promise.resolve();
  }
  if (googleMapsScriptPromise) return googleMapsScriptPromise;

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('google-maps-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (err) => reject(err));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (err) => {
      console.warn('⚠️ Google Maps script failed to load, falling back to tile view.', err);
      reject(err);
    };
    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

export interface MapViewProps {
  initialRegion?: Region;
  region?: Region;
  onRegionChangeComplete?: (region: Region) => void;
  onPress?: (event: MapPressEvent) => void;
  showsUserLocation?: boolean;
  style?: any;
  children?: React.ReactNode;
  provider?: string;
  mapType?: string;
  userInterfaceStyle?: string;
  [key: string]: any;
}

export const MapView = forwardRef<any, MapViewProps>((props, ref) => {
  const {
    initialRegion,
    region,
    onRegionChangeComplete,
    onPress,
    showsUserLocation,
    style,
    children,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(14);
  const [projectionVersion, setProjectionVersion] = useState(0);

  const initialLat = region?.latitude || initialRegion?.latitude || 26.9124;
  const initialLng = region?.longitude || initialRegion?.longitude || 75.7873;
  const initialDelta = region?.latitudeDelta || initialRegion?.latitudeDelta || 0.05;

  const apiKey =
    process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ||
    'AIzaSyBzT2XnCZqhhBUFsQP293T2Hc22bTQgyj0';

  // Expose imperative handle (e.g. animateToRegion)
  useImperativeHandle(ref, () => ({
    animateToRegion: (targetRegion: Region, duration?: number) => {
      if (mapInstanceRef.current && (window as any).google?.maps) {
        const center = new (window as any).google.maps.LatLng(
          targetRegion.latitude,
          targetRegion.longitude
        );
        mapInstanceRef.current.panTo(center);
        if (targetRegion.latitudeDelta) {
          const newZoom = deltaToZoom(targetRegion.latitudeDelta);
          mapInstanceRef.current.setZoom(newZoom);
        }
      }
    },
    fitToCoordinates: (coordinates: Array<{ latitude: number; longitude: number }>) => {
      if (mapInstanceRef.current && (window as any).google?.maps && coordinates.length > 0) {
        const bounds = new (window as any).google.maps.LatLngBounds();
        coordinates.forEach((coord) => {
          bounds.extend(new (window as any).google.maps.LatLng(coord.latitude, coord.longitude));
        });
        mapInstanceRef.current.fitBounds(bounds);
      }
    },
  }));

  // Initialize Google Maps instance
  useEffect(() => {
    let isMounted = true;

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (!isMounted || !containerRef.current) return;
        const google = (window as any).google;
        if (!google?.maps) return;

        const mapOptions = {
          center: { lat: initialLat, lng: initialLng },
          zoom: deltaToZoom(initialDelta),
          styles: darkMapStyle,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          scaleControl: false,
          streetViewControl: false,
          rotateControl: false,
          fullscreenControl: false,
        };

        const map = new google.maps.Map(containerRef.current, mapOptions);
        mapInstanceRef.current = map;

        // Overlay to project LatLng to Pixel coordinates
        const overlay = new google.maps.OverlayView();
        overlay.onAdd = function () {};
        overlay.onRemove = function () {};
        overlay.draw = function () {
          if (isMounted) {
            setProjectionVersion((v) => v + 1);
          }
        };
        overlay.setMap(map);
        overlayRef.current = overlay;

        // Map Click Listener
        map.addListener('click', (e: any) => {
          if (onPress && e.latLng) {
            onPress({
              nativeEvent: {
                coordinate: {
                  latitude: e.latLng.lat(),
                  longitude: e.latLng.lng(),
                },
              },
            });
          }
        });

        // Dynamic projection updates on bounds and zoom change
        map.addListener('bounds_changed', () => {
          if (isMounted) {
            setProjectionVersion((v) => v + 1);
          }
        });

        // Trigger map resize so projection calculates accurately inside modals and web views
        setTimeout(() => {
          if (isMounted && map) {
            google.maps.event.trigger(map, 'resize');
            setProjectionVersion((v) => v + 1);
          }
        }, 120);

        // Region / Zoom Change Listener
        map.addListener('idle', () => {
          if (!isMounted) return;
          const center = map.getCenter();
          const currentZoom = map.getZoom();
          setZoomLevel(currentZoom);
          setProjectionVersion((v) => v + 1);

          if (onRegionChangeComplete && center) {
            const currentDelta = zoomToDelta(currentZoom);
            onRegionChangeComplete({
              latitude: center.lat(),
              longitude: center.lng(),
              latitudeDelta: currentDelta,
              longitudeDelta: currentDelta,
            });
          }
        });

        // Current user location marker
        if (showsUserLocation && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (!isMounted) return;
              new google.maps.Marker({
                position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
                map,
                title: 'Your Location',
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: '#4285F4',
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 2,
                },
              });
              // Auto-pan if the initial coordinates were default placeholders
              if (Math.abs(initialLat - 37.7858) < 0.001 || Math.abs(initialLat - 26.9124) < 0.001) {
                map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
              }
            },
            (err) => console.log('Geolocation note:', err.message)
          );
        }

        setIsReady(true);
      })
      .catch((err) => {
        console.warn('Failed to initialize Google Maps on web:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Update map when region prop changes externally
  useEffect(() => {
    if (mapInstanceRef.current && region && (window as any).google?.maps) {
      const center = new (window as any).google.maps.LatLng(region.latitude, region.longitude);
      mapInstanceRef.current.setCenter(center);
      if (region.latitudeDelta) {
        mapInstanceRef.current.setZoom(deltaToZoom(region.latitudeDelta));
      }
      setTimeout(() => {
        setProjectionVersion((v) => v + 1);
      }, 50);
    }
  }, [region?.latitude, region?.longitude, region?.latitudeDelta, initialRegion?.latitude, initialRegion?.longitude]);

  // Coordinate-to-pixel projection helper
  const projectCoordinate = useCallback(
    (lat: number, lng: number) => {
      if (!overlayRef.current) return null;
      const projection = overlayRef.current.getProjection();
      if (!projection || !(window as any).google?.maps) return null;

      const latLng = new (window as any).google.maps.LatLng(lat, lng);
      // fromLatLngToContainerPixel computes exact pixels within containerRef (0, 0 at top-left)
      const point = projection.fromLatLngToContainerPixel
        ? projection.fromLatLngToContainerPixel(latLng)
        : projection.fromLatLngToDivPixel(latLng);
      if (!point) return null;

      return { x: point.x, y: point.y };
    },
    [projectionVersion]
  );

  return (
    <View style={[styles.container, style]}>
      {/* HTML Map Container */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#0e1626',
        }}
      />

      {/* Render Markers as Projected Overlays */}
      <MapContext.Provider
        value={{
          map: mapInstanceRef.current,
          isReady,
          projectCoordinate,
          zoom: zoomLevel,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </MapContext.Provider>
    </View>
  );
});

export interface MarkerProps {
  coordinate: {
    latitude: number;
    longitude: number;
  };
  onPress?: (e?: any) => void;
  draggable?: boolean;
  onDragEnd?: (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void;
  children?: React.ReactNode;
  pinColor?: string;
  tracksViewChanges?: boolean;
  [key: string]: any;
}

export const Marker: React.FC<MarkerProps> = ({
  coordinate,
  onPress,
  children,
  pinColor = '#FF3B30',
}) => {
  const { projectCoordinate, isReady } = useContext(MapContext);

  if (!isReady || !coordinate) return null;

  const pos = projectCoordinate(coordinate.latitude, coordinate.longitude);
  if (!pos) return null;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (onPress) onPress(e);
      }}
      style={{
        position: 'absolute',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto',
        cursor: 'pointer',
        zIndex: 10,
        userSelect: 'none',
      }}
    >
      {children ? (
        children
      ) : (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50% 50% 50% 0',
            backgroundColor: pinColor,
            transform: 'rotate(-45deg)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
          }}
        />
      )}
    </div>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
});

export default MapView;
