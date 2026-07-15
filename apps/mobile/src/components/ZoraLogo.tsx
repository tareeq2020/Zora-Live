// ZoraLogo — the brand mark, drawn as vector so it's crisp at any size and needs
// no binary asset. Three variants:
//   emblem   → the gradient halo dot (mark only)
//   full     → gradient circle + "ZORA" wordmark inside (the primary logo)
//   wordmark → just "ZORA" in the brand face (for headers on dark surfaces)
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
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
      <Text style={{ fontFamily: z.brandFont, color, fontSize: size, letterSpacing: size * 0.06, includeFontPadding: false }}>
        ZORA
      </Text>
    );
  }

  const circle = (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {/* bottom-left magenta → top-right orange, matching the emblem */}
        <LinearGradient id="zoraGrad" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={z.brand.from} />
          <Stop offset="0.5" stopColor={z.brand.mid} />
          <Stop offset="1" stopColor={z.brand.to} />
        </LinearGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill="url(#zoraGrad)" />
    </Svg>
  );

  if (variant === 'emblem') return circle;

  // full lockup: wordmark centred in the emblem
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {circle}
      <Text
        style={{
          position: 'absolute',
          fontFamily: z.brandFont,
          color: '#FFFFFF',
          fontSize: size * 0.19,
          letterSpacing: size * 0.006,
          includeFontPadding: false,
        }}
      >
        ZORA
      </Text>
    </View>
  );
}
