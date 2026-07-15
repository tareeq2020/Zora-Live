// ThemeToggle — mirrors the website's moon/sun switch. Flips + persists mode.
import { Pressable } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useThemeStore, useZ } from '../theme';

export default function ThemeToggle({ size = 40 }: { size?: number }) {
  const z = useZ();
  const mode = useThemeStore((s) => s.mode);
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityLabel="Toggle dark or light mode"
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: z.line, backgroundColor: z.panel, alignItems: 'center', justifyContent: 'center' }}
    >
      {mode === 'dark' ? (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={z.bone} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </Svg>
      ) : (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={z.bone} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={12} cy={12} r={4.2} />
          <Path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
        </Svg>
      )}
    </Pressable>
  );
}
