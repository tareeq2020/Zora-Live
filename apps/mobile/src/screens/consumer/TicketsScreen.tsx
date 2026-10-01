import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { listMyTickets, type ConsumerTicket } from '../../api/consumer';
import { useZ } from '../../theme';

const toPass = (ticket: ConsumerTicket) => ({
  n: ticket.eventName,
  d: 'Live pass',
  tier: ticket.tier,
  seat: ticket.tableNo ? `Table ${ticket.tableNo}` : ticket.seatIndex != null ? `Seat ${ticket.seatIndex}` : 'GA',
  holder: 'You',
  code: ticket.publicRef || ticket.code,
  qr: ticket.qr,
});

export default function TicketsScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const [passes, setPasses] = useState<ReturnType<typeof toPass>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listMyTickets()
      .then((tickets) => { if (alive) setPasses(tickets.map(toPass)); })
      .catch(() => { if (alive) setPasses([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20 }}>
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginBottom: 16 }}>My tickets</Text>
      {loading ? (
        <View style={{ borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 12 }}>
          <Text style={{ color: z.mut, textAlign: 'center' }}>Loading tickets...</Text>
        </View>
      ) : null}
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
      {!loading && passes.length === 0 ? (
        <View style={{ borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 2 }}>
          <Text style={{ color: z.bone, fontWeight: '800', textAlign: 'center' }}>No tickets yet</Text>
          <Text style={{ color: z.mut, fontSize: 12, textAlign: 'center', marginTop: 6 }}>
            Buy a pass from an event and it will appear here after payment is confirmed.
          </Text>
        </View>
      ) : null}
      <Text style={{ color: z.mut, textAlign: 'center', fontSize: 12, marginTop: 12 }}>Your passes live in the app — the app is the only door.</Text>
    </ScrollView>
  );
}
