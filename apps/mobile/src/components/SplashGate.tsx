// SplashGate — a high-end launch animation played once over the app: obsidian
// backdrop with a soft brand glow, the emblem blooms in with an expanding halo
// ring, then the cover fades to reveal the app.
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, runOnJS } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import ZoraLogo from './ZoraLogo';
import { z } from '../theme';

export default function SplashGate({ children }: { children: React.ReactNode }) {
  const [done, setDone] = useState(false);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.82);
  const haloScale = useSharedValue(0.8);
  const haloOpacity = useSharedValue(0);
  const cover = useSharedValue(1);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    logoScale.value = withTiming(1, { duration: 640, easing: Easing.out(Easing.cubic) });
    haloOpacity.value = withDelay(220, withTiming(0.5, { duration: 220 }));
    haloScale.value = withDelay(220, withTiming(1.9, { duration: 980, easing: Easing.out(Easing.cubic) }));
    setTimeout(() => { haloOpacity.value = withTiming(0, { duration: 420 }); }, 1050);
    cover.value = withDelay(1550, withTiming(0, { duration: 460 }, (f) => { if (f) runOnJS(setDone)(true); }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logoStyle = useAnimatedStyle(() => ({ opacity: logoOpacity.value, transform: [{ scale: logoScale.value }] }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: haloOpacity.value, transform: [{ scale: haloScale.value }] }));
  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));

  return (
    <View style={{ flex: 1, backgroundColor: z.bg }}>
      {children}
      {!done && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: z.bg }, coverStyle]}>
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id="zoraGlow" cx="50%" cy="46%" r="62%">
                <Stop offset="0" stopColor={z.brand.mid} stopOpacity="0.20" />
                <Stop offset="1" stopColor={z.bg} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#zoraGlow)" />
          </Svg>
          <Animated.View style={[{ position: 'absolute', width: 168, height: 168, borderRadius: 84, borderWidth: 1.5, borderColor: z.brand.mid }, haloStyle]} />
          <Animated.View style={logoStyle}>
            <ZoraLogo variant="full" size={132} />
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}
