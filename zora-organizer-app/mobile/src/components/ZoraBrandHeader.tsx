// ZoraBrandHeader — app-chrome header that embeds the brand mark and adapts to
// dark/light. Left: emblem + wordmark lockup. Right: optional slot (avatar,
// toggle, actions). Pass `mode` to flip ink for light surfaces.
import React from 'react';
import { View, Pressable } from 'react-native';
import ZoraLogo from './ZoraLogo';
import { useZ } from '../theme';

export default function ZoraBrandHeader({
  right, mode = 'dark', onLogoPress, compact,
}: {
  right?: React.ReactNode;
  mode?: 'dark' | 'light';
  onLogoPress?: () => void;
  compact?: boolean;
}) {
  const z = useZ();
  const ink = mode === 'dark' ? z.bone : z.bg;
  const emblem = compact ? 20 : 26;
  const word = compact ? 13 : 15;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
      <Pressable onPress={onLogoPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <ZoraLogo variant="emblem" size={emblem} />
        <ZoraLogo variant="wordmark" size={word} color={ink} />
      </Pressable>
      {right ?? null}
    </View>
  );
}
