import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

export interface InstagramDefaultAvatarProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Standard Instagram default profile picture:
 * Medium grey circle with a solid white human silhouette (head & curved shoulders).
 */
export function InstagramDefaultAvatar({ size = 50, style }: InstagramDefaultAvatarProps) {
  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }, style]}>
      <Svg width={size} height={size} viewBox="0 0 50 50">
        {/* Instagram signature grey circular background */}
        <Circle cx="25" cy="25" r="25" fill="#DBDBDB" />
        
        {/* Solid white head */}
        <Circle cx="25" cy="18.5" r="8" fill="#FFFFFF" />
        
        {/* Solid white curved torso / shoulders */}
        <Path
          d="M 11 44.5 C 11 34.5 17.2 29.5 25 29.5 C 32.8 29.5 39 34.5 39 44.5 Z"
          fill="#FFFFFF"
        />
      </Svg>
    </View>
  );
}

export default InstagramDefaultAvatar;

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
