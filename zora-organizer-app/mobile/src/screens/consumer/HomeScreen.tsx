import { useState } from 'react';
import { View, Text, FlatList, Pressable, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { events as seedEvents, type ConsumerEvent } from '../../data/events';
import { useEvents, type RemoteEvent } from '../../api/events';
import { supabaseReady } from '../../lib/supabase';
import ZoraLogo from '../../components/ZoraLogo';
import { useZ } from '../../theme';

const CITIES = ['Dar es Salaam', 'Nairobi', 'Zanzibar', 'Accra', 'Lagos'];

// App city chips → the city CODES stored on events (dar | nairobi | …).
const CITY_CODE: Record<string, string> = {
  'Dar es Salaam': 'dar', Nairobi: 'nairobi', Zanzibar: 'zanzibar', Accra: 'accra', Lagos: 'lagos',
};
const CURRENCY: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };
const CAT_TINT: Record<string, string> = { Festivals: '#3D5AFE', Nightlife: '#C738C6', Daytime: '#E9A83B', Arts: '#17B368', Concerts: '#FF5A1F' };
const money = (code?: string | null, n?: number) => (n != null ? `${CURRENCY[code || 'dar'] || 'TZS'} ${n.toLocaleString()}` : '');

// Supabase row → marketplace card. The full event lives in `props`.
const toCard = (e: RemoteEvent): ConsumerEvent => {
  const p = e.props || ({} as RemoteEvent['props']);
  return {
    id: p.id || e.id,
    name: p.name || e.name,
    venue: p.venue || '',
    date: [p.dateLabel, p.time].filter(Boolean).join(' · '),
    from: money(e.city, p.priceFrom),
    cover: e.cover || CAT_TINT[p.category || ''] || '#3D5AFE',
  };
};

export default function HomeScreen() {
  const z = useZ();
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [city, setCity] = useState('Dar es Salaam');
  const [cityOpen, setCityOpen] = useState(false);

  // Live from the shared Supabase events table when configured; otherwise the
  // local seed keeps the demo populated. Website-created events appear here live.
  const { events: remote } = useEvents(CITY_CODE[city] || 'dar');
  const live = supabaseReady && remote.length > 0;
  const list: ConsumerEvent[] = live ? remote.map(toCard) : seedEvents;

  // Featured hero: the city's mega event (or its first), live from Supabase.
  const heroRemote = live ? remote.find((e) => e.props?.mega) || remote[0] : undefined;
  const hero = heroRemote
    ? {
        id: heroRemote.props.id || heroRemote.id,
        name: heroRemote.props.name || heroRemote.name,
        sub: [heroRemote.props.dateLabel, city, money(heroRemote.city, heroRemote.props.priceFrom) && 'from ' + money(heroRemote.city, heroRemote.props.priceFrom)]
          .filter(Boolean)
          .join(' · '),
      }
    : { id: 'offshore', name: 'OFFSHORE', sub: 'Sat 25 Jul · Dar es Salaam · from TZS 65,000' };

  const openBooking = (id: string) => nav.navigate('Booking', { eventId: id });

  return (
    <View style={{ flex: 1, backgroundColor: z.bg }}>
      <FlatList
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}
        data={list}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        keyExtractor={(e) => e.id}
        ListHeaderComponent={
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ZoraLogo variant="emblem" size={22} />
                <ZoraLogo variant="wordmark" size={15} />
              </View>
              <Pressable
                onPress={() => setCityOpen(true)}
                style={({ pressed }) => ({ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 100, paddingHorizontal: 12, paddingVertical: 7, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ color: z.bone, fontWeight: '600', fontSize: 12 }}>{city} ▾</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => openBooking(hero.id)} style={{ height: 190, borderRadius: 22, overflow: 'hidden', justifyContent: 'flex-end', padding: 16, backgroundColor: '#241a3a', marginBottom: 16 }}>
              <Text style={{ color: z.orangeSoft, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>MEGA EVENT</Text>
              <Text style={{ color: z.bone, fontSize: 26, fontWeight: '900', marginTop: 6 }}>{hero.name}</Text>
              <Text style={{ color: z.mut, fontSize: 12, marginTop: 4 }}>{hero.sub}</Text>
            </Pressable>
            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 12 }}>HAPPENING IN {city.toUpperCase()}</Text>
          </View>
        }
        renderItem={({ item }: { item: ConsumerEvent }) => (
          <Pressable onPress={() => openBooking(item.id)} style={{ flex: 1, marginBottom: 14 }}>
            <View style={{ height: 120, borderRadius: 16, backgroundColor: item.cover, justifyContent: 'flex-end', padding: 10, opacity: 0.92 }}>
              <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(10,10,11,0.55)', borderRadius: 100, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ color: z.bone, fontSize: 10, fontWeight: '700' }}>from {item.from}</Text>
              </View>
            </View>
            <Text style={{ color: z.bone, fontWeight: '700', fontSize: 13, marginTop: 8 }}>{item.name}</Text>
            <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{item.venue} · {item.date}</Text>
          </Pressable>
        )}
      />

      <Modal visible={cityOpen} transparent animationType="fade" onRequestClose={() => setCityOpen(false)}>
        <Pressable onPress={() => setCityOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 30 }}>
          <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 20, paddingVertical: 8 }}>
            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, paddingHorizontal: 18, paddingVertical: 10 }}>CHOOSE YOUR CITY</Text>
            {CITIES.map((c) => (
              <Pressable key={c} onPress={() => { setCity(c); setCityOpen(false); }} style={{ paddingHorizontal: 18, paddingVertical: 14 }}>
                <Text style={{ color: c === city ? z.ultraSoft : z.bone, fontWeight: c === city ? '800' : '500', fontSize: 16 }}>{c}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
