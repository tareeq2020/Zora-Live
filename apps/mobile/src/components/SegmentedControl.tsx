import { View, Text, Pressable } from 'react-native';
import { useZ } from '../theme';

export interface SegOption { key: string; label: string }

// Reusable iOS-style segmented control (works fully in Expo Go — pure RN).
export default function SegmentedControl({
  options, value, onChange,
}: {
  options: SegOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  const z = useZ();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, padding: 4 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={{ flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: on ? z.ultra : 'transparent' }}
          >
            <Text style={{ color: on ? '#fff' : z.mut, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
