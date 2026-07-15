// ZoraButton — primary CTA with a "halo" micro-interaction: on press a hollow
// ring (the emblem motif) blooms out from the button and fades, plus a subtle
// press-scale. Gradient variant fills with the brand emblem gradient.
import React from 'react';
import { Pressable, Text, View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useZ } from '../theme';

type Variant = 'gradient' | 'solid' | 'ghost';

export default function ZoraButton({
  label, onPress, variant = 'gradient', disabled, style,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const z = useZ();
  const scale = useSharedValue(1);
  const haloScale = useSharedValue(0.9);
  const haloOpacity = useSharedValue(0);

  const handle = () => {
    if (disabled) return;
    scale.value = withSequence(withTiming(0.97, { duration: 90 }), withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) }));
    haloScale.value = 0.9;
    haloOpacity.value = 0.55;
    haloScale.value = withTiming(1.45, { duration: 560, easing: Easing.out(Easing.cubic) });
    haloOpacity.value = withTiming(0, { duration: 560 });
    onPress?.();
  };

  const btnStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const haloStyle = useAnimatedStyle(() => ({ transform: [{ scale: haloScale.value }], opacity: haloOpacity.value }));

  const textColor = variant === 'gradient' ? '#FFFFFF' : variant === 'solid' ? z.bg : z.bone;
  const surface: ViewStyle =
    variant === 'solid' ? { backgroundColor: z.bone } : variant === 'ghost' ? { borderColor: z.line, borderWidth: 1 } : {};

  const styles = StyleSheet.create({
    btn: { borderRadius: z.r, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    halo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: z.r + 4, borderWidth: 1.5, borderColor: z.brand.mid },
  });

  return (
    <View style={[{ position: 'relative' }, style]}>
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      <Animated.View style={btnStyle}>
        <Pressable onPress={handle} disabled={disabled} style={[styles.btn, surface, { opacity: disabled ? 0.4 : 1 }]}>
          {variant === 'gradient' && (
            <Svg style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="zoraBtn" x1="0" y1="1" x2="1" y2="0">
                  <Stop offset="0" stopColor={z.brand.from} />
                  <Stop offset="0.5" stopColor={z.brand.mid} />
                  <Stop offset="1" stopColor={z.brand.to} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" rx={z.r} fill="url(#zoraBtn)" />
            </Svg>
          )}
          <Text style={{ color: textColor, fontWeight: '700', fontSize: 15, letterSpacing: 0.3 }}>{label}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
