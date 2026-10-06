import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, RefreshControl, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useEventStore, soldOf, grossOf, mTZS, kTZS } from '../../store/eventStore';
import { getOrgEvents, getOrgSummary, type OrgEvent, type OrgSummary } from '../../api/organizer';
import Sparkline from '../../components/Sparkline';
import { useZ } from '../../theme';

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
  const selectedEventId = useEventStore((s) => s.selectedEventId);
  const setFromApi = useEventStore((s) => s.setFromApi);
  const selectEvent = useEventStore((s) => s.selectEvent);
  const [apiSummary, setApiSummary] = useState<OrgSummary | null>(null);
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const sold = soldOf(event);
  const eventSummary = apiSummary?.events.find((e) => e.id === event.id);
  const gross = eventSummary?.revenue ?? apiSummary?.totals.revenue ?? grossOf(event);
  const net = eventSummary?.netRevenue ?? apiSummary?.totals.netRevenue ?? Math.round(gross * 0.95);
  const pct = Math.min(100, Math.round((sold / event.cap) * 100));
  const checkPct = sold ? Math.round((event.checked / sold) * 100) : 0;
  const avg = sold ? Math.round(gross / sold) : 0;

  const loadOrganizerData = useCallback(() => {
    let alive = true;
    setRefreshing(true);
    Promise.all([getOrgEvents(), getOrgSummary()])
      .then(([events, summary]) => {
        if (!alive) return;
        setEvents(events);
        const selected = selectedEventId ? events.find((e) => e.id === selectedEventId) : null;
        const nextEvent = selected || events.find((e) => e.status !== 'archived') || events[0];
        if (nextEvent) setFromApi(nextEvent);
        setApiSummary(summary);
        setLoadError(null);
      })
      .catch((e: any) => {
        if (alive) setLoadError(e?.message ?? 'Could not load organizer data.');
      })
      .finally(() => {
        if (alive) setRefreshing(false);
      });
    return () => { alive = false; };
  }, [selectedEventId, setFromApi]);

  useEffect(() => {
    const cleanup = loadOrganizerData();
    return cleanup;
  }, [loadOrganizerData]);

  useFocusEffect(
    useCallback(() => {
      const cleanup = loadOrganizerData();
      return cleanup;
    }, [loadOrganizerData]),
  );

  const switchEvent = () => {
    if (!events.length) {
      Alert.alert('Your events', 'Pull to refresh and try again.');
      return;
    }
    setPickerOpen(true);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: z.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 28 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { loadOrganizerData(); }} tintColor={z.ultraSoft} />}
    >
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

      {loadError ? (
        <View style={{ borderColor: z.orange + '66', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14, backgroundColor: z.orange + '12' }}>
          <Text style={{ color: z.orangeSoft, fontSize: 12 }}>{loadError} Showing last loaded data.</Text>
        </View>
      ) : null}

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
        <Text style={{ color: z.mut2, fontSize: 13, paddingVertical: 6 }}>
          Pull to refresh for the latest sales. Real-time sale events will be wired once the mobile API exposes an organizer activity stream.
        </Text>
      </View>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: z.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderColor: z.line, borderWidth: 1, paddingTop: 18, paddingHorizontal: 20, paddingBottom: insets.bottom + 18, maxHeight: '78%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <View>
                <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>SWITCH EVENT</Text>
                <Text style={{ color: z.bone, fontSize: 20, fontWeight: '800', marginTop: 4 }}>Your events</Text>
              </View>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={12}>
                <Text style={{ color: z.mut, fontSize: 15, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </View>
            <ScrollView>
              {events.map((ev) => {
                const on = ev.id === event.id;
                return (
                  <Pressable
                    key={ev.id}
                    onPress={() => {
                      selectEvent(ev);
                      setPickerOpen(false);
                    }}
                    style={({ pressed }) => ({
                      borderColor: on ? z.ultra + '99' : z.line,
                      borderWidth: 1,
                      borderRadius: 16,
                      padding: 14,
                      backgroundColor: on ? z.ultra + '16' : z.panel2,
                      marginTop: 10,
                      opacity: pressed ? 0.72 : 1,
                    })}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: z.bone, fontSize: 15, fontWeight: '800' }}>{ev.name}</Text>
                        <Text style={{ color: z.mut2, fontSize: 12, marginTop: 4 }}>{ev.dateLabel || ev.date || 'Date TBA'} · {ev.city || 'City TBA'}</Text>
                      </View>
                      <Text style={{ color: on ? z.ultraSoft : z.mut2, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>{on ? 'ACTIVE' : ev.status.toUpperCase()}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
