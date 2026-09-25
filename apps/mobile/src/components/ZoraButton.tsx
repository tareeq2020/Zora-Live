// ZoraButton — ZoraPass CTA. `gradient` is kept as a compatibility variant for
// older screens, but it now renders as the flat primary button from the product
// system: Board Black on light surfaces, Signal Yellow on dark surfaces.
import React from 'react';
import { Pressable, Text, View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing } from 'react-native-reanimated';
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

  const textColor = variant === 'ghost' ? z.bone : z.bg;
  const surface: ViewStyle =
    variant === 'ghost'
      ? { borderColor: z.line, borderWidth: 2, backgroundColor: 'transparent' }
      : variant === 'solid'
        ? { backgroundColor: z.bone }
        : { backgroundColor: z.bone };

  const styles = StyleSheet.create({
    btn: { borderRadius: z.r, minHeight: 56, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    halo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: z.r + 4, borderWidth: 2, borderColor: z.brand.signal },
  });

  return (
    <View style={[{ position: 'relative' }, style]}>
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      <Animated.View style={btnStyle}>
        <Pressable onPress={handle} disabled={disabled} style={[styles.btn, surface, { opacity: disabled ? 0.4 : 1 }]}>
          <Text style={{ color: textColor, fontFamily: z.disp, fontSize: 14, letterSpacing: 0 }}>{label}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
