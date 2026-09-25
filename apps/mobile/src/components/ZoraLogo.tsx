// ZoraLogo — ZoraPass brand mark, drawn as vector so it's crisp at any size.
// Product UI uses the flat Signal Yellow / Board Black / Bone system.
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import { z } from '../theme';

type Variant = 'emblem' | 'full' | 'wordmark';

export default function ZoraLogo({
  size = 96,
  variant = 'full',
  color = '#FFFFFF',
}: {
  size?: number;
  variant?: Variant;
  color?: string;
}) {
  if (variant === 'wordmark') {
    return (
      <Text style={{ fontFamily: z.brandFont, color, fontSize: size, letterSpacing: -size * 0.035, includeFontPadding: false }}>
        ZoraPass
      </Text>
    );
  }

  const circle = (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x="0" y="0" width="100" height="100" rx="22" fill={z.brand.signal} />
      <Path
        d="M28 26H74L48 50H72V74H26L52 50H28V26Z"
        fill={z.brand.black}
        stroke={z.brand.black}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </Svg>
  );

  if (variant === 'emblem') return circle;

  // full lockup: wordmark centred in the icon block
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {circle}
      <Text
        style={{
          position: 'absolute',
          fontFamily: z.brandFont,
          color: z.brand.black,
          fontSize: size * 0.16,
          letterSpacing: -size * 0.004,
          includeFontPadding: false,
        }}
      >
        ZoraPass
      </Text>
    </View>
  );
}
