import { useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useZ } from '../../theme';

interface Attendee { n: string; id: string; ph: string; ty: string; in: boolean }
const INITIAL: Attendee[] = [
  { n: 'Amina Kessy', id: 'Z001-0417', ph: '+255 712 400 417', ty: 'VIP', in: true },
  { n: 'Juma Ally', id: 'Z001-0031', ph: '+255 754 220 031', ty: 'Golden Circle', in: true },
  { n: 'Grace Mushi', id: 'Z001-0288', ph: '+255 713 900 288', ty: 'General', in: false },
  { n: 'Said Omar', id: 'Z001-0455', ph: '+255 778 110 455', ty: 'VIP', in: true },
  { n: 'Lucy Meena', id: 'Z001-0039', ph: '+255 765 330 039', ty: 'Golden Circle', in: false },
];

export default function PeopleScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Attendee[]>(INITIAL);

  const rows = useMemo(() => {
    const s = q.toLowerCase().replace(/\s/g, '');
    return people.filter((p) => !s || p.n.toLowerCase().includes(s) || p.id.toLowerCase().includes(s) || p.ph.replace(/\s/g, '').includes(s));
  }, [q, people]);

  const toggleCheckIn = (id: string) => setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, in: !p.in } : p)));

  const openAttendee = (p: Attendee) =>
    Alert.alert(p.n, `${p.ty}\n${p.ph}\nTicket ${p.id}\nStatus: ${p.in ? 'Checked in' : 'Not yet in'}`, [
      { text: p.in ? 'Undo check-in' : 'Check in', onPress: () => toggleCheckIn(p.id) },
      { text: 'Close', style: 'cancel' },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: z.bg, paddingTop: insets.top + 8, paddingHorizontal: 20 }}>
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginBottom: 12 }}>Attendees</Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search name, ticket ID or phone…"
        placeholderTextColor={z.mut2}
        style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, color: z.bone, padding: 13, marginBottom: 12 }}
      />
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: p }) => (
          <Pressable
            onPress={() => openAttendee(p)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomColor: z.line2, borderBottomWidth: 1, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: z.bone, fontWeight: '600' }}>{p.n}</Text>
              <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{p.id} · {p.ph}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: z.mut, fontSize: 10, fontWeight: '700' }}>{p.ty}</Text>
              <Text style={{ color: p.in ? z.green : z.mut2, fontSize: 11, fontWeight: '700', marginTop: 5 }}>{p.in ? 'Checked in' : 'Absent'}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
