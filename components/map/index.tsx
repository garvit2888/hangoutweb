import React, { forwardRef } from 'react';
import { Platform } from 'react-native';
import NativeMapView, {
  Marker as NativeMarker,
  PROVIDER_APPLE,
  PROVIDER_GOOGLE,
  PROVIDER_DEFAULT,
  Region,
  MapPressEvent,
} from 'react-native-maps';

export interface CrossPlatformMapViewProps extends React.ComponentProps<typeof NativeMapView> {
  // Pass-through standard react-native-maps props
}

/**
 * Native MapView wrapper.
 * Strictly enforces:
 * - On Android: Always uses Google Maps (PROVIDER_GOOGLE).
 * - On iOS: Uses Apple Maps (PROVIDER_APPLE / PROVIDER_DEFAULT).
 */
export const MapView = forwardRef<NativeMapView, any>((props, ref) => {
  // User Requirement: When opened on Android, Google Map is viewed.
  const provider = Platform.OS === 'android' ? PROVIDER_GOOGLE : (props.provider || PROVIDER_APPLE);

  return (
    <NativeMapView
      ref={ref}
      {...props}
      provider={provider}
    />
  );
});

export const Marker = NativeMarker;
export function loadGoogleMapsScript(): Promise<void> {
  return Promise.resolve();
}
export { PROVIDER_APPLE, PROVIDER_GOOGLE, PROVIDER_DEFAULT };
export type { Region, MapPressEvent };
export default MapView;
