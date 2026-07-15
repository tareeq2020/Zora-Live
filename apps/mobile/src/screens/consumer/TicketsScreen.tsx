import { View, Text, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useZ } from '../../theme';

const passes = [
  { n: 'OFFSHORE', d: 'Sat 25 Jul · 14:00', tier: 'Cabana', seat: 'Table T3', holder: 'Tareeq', code: 'Z001-0417' },
  { n: 'KULTUR Nights', d: 'Fri 15 Aug · 21:00', tier: 'General', seat: 'GA', holder: 'Tareeq', code: 'Z002-0288' },
];

export default function TicketsScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20 }}>
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginBottom: 16 }}>My tickets</Text>
      {passes.map((p) => (
        <Pressable
          key={p.code}
          onPress={() => nav.navigate('TicketDetail', { pass: p })}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 12, opacity: pressed ? 0.8 : 1 })}
        >
          <View style={{ width: 54, height: 54, borderRadius: 12, backgroundColor: '#fff' }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: z.bone, fontWeight: '700', fontSize: 15 }}>{p.n}</Text>
            <Text style={{ color: z.mut2, fontSize: 12, marginTop: 3 }}>{p.d} · {p.code}</Text>
          </View>
          <Text style={{ color: z.silver, fontWeight: '700', fontSize: 12 }}>View ›</Text>
        </Pressable>
      ))}
      <Text style={{ color: z.mut, textAlign: 'center', fontSize: 12, marginTop: 12 }}>Your passes live in the app — the app is the only door.</Text>
    </ScrollView>
  );
}
