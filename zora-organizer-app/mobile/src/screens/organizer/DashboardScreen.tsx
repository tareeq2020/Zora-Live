import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useEventStore, soldOf, grossOf, mTZS, kTZS } from '../../store/eventStore';
import Sparkline from '../../components/Sparkline';
import { useZ } from '../../theme';

const BUYERS = ['Amani M.', 'Zawadi K.', 'John P.', 'Neema S.', 'Baraka L.', 'Fatma H.', 'Deo R.', 'Upendo N.'];
const VELOCITY = [8, 11, 9, 14, 13, 18, 16, 22, 20, 27, 31, 40];

function StatTile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  const z = useZ();
  return (
    <View style={{ flex: 1, backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 16, padding: 15 }}>
      <Text style={{ color: z.mut2, fontSize: 10.5, fontWeight: '700', letterSpacing: 1 }}>{k}</Text>
      <Text style={{ color: z.bone, fontWeight: '800', fontSize: 22, marginTop: 8 }}>{v}</Text>
      {sub ? <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{sub}</Text> : null}
    </View>
  );
}

function Bar({ pct, color }: { pct: number; color?: string }) {
  const z = useZ();
  return (
    <View style={{ height: 8, borderRadius: 100, backgroundColor: z.panel2, overflow: 'hidden', marginTop: 8 }}>
      <View style={{ height: '100%', width: `${pct}%`, backgroundColor: color ?? z.ultra, borderRadius: 100 }} />
    </View>
  );
}

export default function DashboardScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const event = useEventStore((s) => s.event);

  const sold = soldOf(event);
  const gross = grossOf(event);
  const net = Math.round(gross * 0.95);
  const pct = Math.min(100, Math.round((sold / event.cap) * 100));
  const checkPct = sold ? Math.round((event.checked / sold) * 100) : 0;
  const avg = sold ? Math.round(gross / sold) : 0;

  // Live sales feed — runs only while the Dashboard is focused.
  const [feed, setFeed] = useState<{ id: number; label: string; buyer: string }[]>([]);
  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => {
        const ev = useEventStore.getState().event;
        const sellable = ev.tiers.map((t, i) => ({ t, i })).filter((x) => x.t.sold < x.t.cap);
        if (!sellable.length) return;
        const pick = sellable[Math.floor(Math.random() * sellable.length)];
        const qty = 1 + Math.floor(Math.random() * 2);
        useEventStore.getState().recordSale(pick.i, qty);
        setFeed((f) => [{ id: Date.now(), label: `${qty} × ${pick.t.name}`, buyer: BUYERS[Math.floor(Math.random() * BUYERS.length)] }, ...f].slice(0, 5));
      }, 3500);
      return () => clearInterval(id);
    }, []),
  );

  const switchEvent = () =>
    Alert.alert('Your events', `${event.name} — ${event.date}, ${event.city} (live).\n\nCreate or switch events from the Zora web dashboard.`, [{ text: 'OK' }]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 28 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <View>
          <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>NOW MANAGING</Text>
          <Pressable onPress={switchEvent} hitSlop={8}>
            <Text style={{ color: z.bone, fontSize: 24, fontFamily: z.disp, marginTop: 4, letterSpacing: 0.5 }}>{event.name} ▾</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(61,90,254,0.16)', borderRadius: 100, paddingHorizontal: 10, paddingVertical: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: z.ultraSoft }} />
          <Text style={{ color: z.ultraSoft, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 }}>ON SALE</Text>
        </View>
      </View>

      {/* Event summary → Edit */}
      <Pressable
        onPress={() => nav.navigate('EditEvent')}
        style={({ pressed }) => ({ backgroundColor: z.panel2, borderColor: z.ultra + '55', borderWidth: 1, borderRadius: 20, padding: 18, opacity: pressed ? 0.9 : 1 })}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text style={{ color: z.bone, fontFamily: undefined, fontSize: 18, fontWeight: '800' }}>{event.tag}</Text>
          <Text style={{ color: z.ultraSoft, fontSize: 12, fontWeight: '700' }}>Edit event ›</Text>
        </View>
        <Text style={{ color: z.mut, fontSize: 12, marginTop: 4 }}>{event.date} · {event.city}</Text>
        <Text style={{ color: z.bone, fontSize: 15, fontWeight: '700', marginTop: 14 }}>
          {sold.toLocaleString()} <Text style={{ color: z.mut2 }}>/ {event.cap.toLocaleString()} sold</Text>
        </Text>
        <Bar pct={pct} />
        <Text style={{ color: z.mut2, fontSize: 11, marginTop: 8 }}>{pct}% of capacity · {(event.cap - sold).toLocaleString()} left</Text>
      </Pressable>

      {/* How much */}
      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>HOW MUCH</Text>
      <View style={{ backgroundColor: z.panel2, borderColor: z.ultra + '55', borderWidth: 1, borderRadius: 18, padding: 16 }}>
        <Text style={{ color: z.mut2, fontSize: 10.5, fontWeight: '700', letterSpacing: 1 }}>GROSS REVENUE</Text>
        <Text style={{ color: z.bone, fontSize: 36, fontFamily: z.disp, marginTop: 6 }}>{mTZS(gross)}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 11, marginTop: 11 }}>
        <StatTile k="NET · AFTER 5%" v={mTZS(net)} />
        <StatTile k="PENDING" v={mTZS(event.pendingTZS)} sub="clears 24h post-event" />
      </View>

      {/* Insights */}
      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>INSIGHTS</Text>
      <View style={{ flexDirection: 'row', gap: 11, marginBottom: 11 }}>
        <StatTile k="CAPACITY SOLD" v={`${pct}%`} />
        <StatTile k="CHECKED IN" v={`${checkPct}%`} sub={`${event.checked.toLocaleString()} at the gate`} />
      </View>
      <View style={{ flexDirection: 'row', gap: 11 }}>
        <StatTile k="SALES / HOUR" v={`+${event.velo}`} />
        <StatTile k="AVG ORDER" v={kTZS(avg)} />
      </View>

      {/* Velocity */}
      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>REVENUE VELOCITY · LAST 12H</Text>
      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 16 }}>
        <Sparkline data={VELOCITY} />
      </View>

      {/* By tier */}
      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>BY TIER</Text>
      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 16 }}>
        {event.tiers.map((t, i) => {
          const tp = Math.round((t.sold / t.cap) * 100);
          const out = t.sold >= t.cap;
          return (
            <View key={t.name} style={{ paddingVertical: 12, borderBottomColor: z.line2, borderBottomWidth: i < event.tiers.length - 1 ? 1 : 0 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ color: z.bone, fontWeight: '600', fontSize: 14 }}>{t.name}</Text>
                  <Text style={{ color: z.mut2, fontSize: 12, marginTop: 2 }}>TZS {t.price.toLocaleString()}</Text>
                </View>
                <Text style={{ color: out ? z.orangeSoft : z.bone, fontWeight: '700', fontSize: 13 }}>{t.sold.toLocaleString()} / {t.cap.toLocaleString()}</Text>
              </View>
              <Bar pct={tp} color={out ? z.orange : z.ultra} />
            </View>
          );
        })}
      </View>

      {/* Live feed */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 10 }}>
        <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>LIVE FEED</Text>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: z.green }} />
      </View>
      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 16 }}>
        {feed.length === 0 ? (
          <Text style={{ color: z.mut2, fontSize: 13, paddingVertical: 6 }}>Watching for sales…</Text>
        ) : (
          feed.map((f, i) => (
            <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomColor: z.line2, borderBottomWidth: i < feed.length - 1 ? 1 : 0 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: z.green }} />
              <Text style={{ color: z.bone, fontSize: 13, flex: 1 }}><Text style={{ fontWeight: '700' }}>{f.label}</Text> · {f.buyer}</Text>
              <Text style={{ color: z.mut2, fontSize: 11 }}>{i === 0 ? 'just now' : `${i}m ago`}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}
