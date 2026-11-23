import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, FlatList, Pressable, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { events as seedEvents, type ConsumerEvent } from '../../data/events';
import { useEvents, type RemoteEvent } from '../../api/events';
import { useCities } from '../../api/cities';
import ZoraLogo from '../../components/ZoraLogo';
import { useZ } from '../../theme';

// BS168: no city list here. Cities come from GET /api/cities (only those with
// upcoming events, busiest first); each event carries its city's currency.
const CAT_TINT: Record<string, string> = { Festivals: '#3D5AFE', Nightlife: '#C738C6', Daytime: '#E9A83B', Arts: '#17B368', Concerts: '#FF5A1F' };
const money = (currency?: string | null, n?: number) => (n != null ? `${currency || 'TZS'} ${n.toLocaleString()}` : '');

// Nest marketplace row -> mobile marketplace card. The full event lives in `props`.
const toCard = (e: RemoteEvent): ConsumerEvent => {
  const p = e.props || ({} as RemoteEvent['props']);
  return {
    id: p.id || e.id,
    name: p.name || e.name,
    venue: p.venue || '',
    date: [p.dateLabel, p.time].filter(Boolean).join(' · '),
    from: money(p.cityCurrency, p.priceFrom),
    cover: e.cover || CAT_TINT[p.category || ''] || '#3D5AFE',
  };
};

export default function HomeScreen() {
  const z = useZ();
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { cities, loading: citiesLoading } = useCities();
  const [picked, setPicked] = useState<string | null>(null);
  const [cityOpen, setCityOpen] = useState(false);
  // Remember the buyer's city between launches.
  useEffect(() => {
    AsyncStorage.getItem('zora-city').then((v) => { if (v) setPicked(v); }).catch(() => {});
  }, []);
  const pick = (id: string) => {
    setPicked(id);
    AsyncStorage.setItem('zora-city', id).catch(() => {});
  };
  // The buyer's pick, else the busiest city. No city yet (loading, or none
  // has events): every event, labelled as such.
  const cityId = picked && cities.some((c) => c.id === picked) ? picked : cities[0]?.id;
  const city = cities.find((c) => c.id === cityId)?.name ?? (citiesLoading ? '…' : 'All cities');
  const canSwitch = cities.length > 1;

  const { events: remote } = useEvents(cityId);
  const live = remote.length > 0;
  const list: ConsumerEvent[] = live ? remote.map(toCard) : seedEvents;

  // Featured hero: the city's mega event (or its first) from the Nest API.
  const heroRemote = live ? remote.find((e) => e.props?.mega) || remote[0] : undefined;
  const hero = heroRemote
    ? {
        id: heroRemote.props.id || heroRemote.id,
        name: heroRemote.props.name || heroRemote.name,
        sub: [heroRemote.props.dateLabel, city, money(heroRemote.props.cityCurrency, heroRemote.props.priceFrom) && 'from ' + money(heroRemote.props.cityCurrency, heroRemote.props.priceFrom)]
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
                onPress={() => canSwitch && setCityOpen(true)}
                disabled={!canSwitch}
                accessibilityRole={canSwitch ? 'button' : 'text'}
                accessibilityLabel={canSwitch ? `City: ${city}. Change city` : `City: ${city}`}
                style={({ pressed }) => ({ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 100, paddingHorizontal: 12, paddingVertical: 7, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ color: z.bone, fontWeight: '600', fontSize: 12 }}>{city}{canSwitch ? ' ▾' : ''}</Text>
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
            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, paddingHorizontal: 18, paddingVertical: 10 }}>CITIES WITH EVENTS</Text>
            {cities.map((c) => (
              <Pressable key={c.id} onPress={() => { pick(c.id); setCityOpen(false); }} style={{ paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.id === cityId ? z.ultraSoft : z.bone, fontWeight: c.id === cityId ? '800' : '500', fontSize: 16 }}>{c.name}</Text>
                <Text style={{ color: z.mut2, fontSize: 13 }}>{c.upcoming} event{c.upcoming === 1 ? '' : 's'}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
