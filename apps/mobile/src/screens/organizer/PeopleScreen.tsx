import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getOrgOrders, type OrgOrderRow } from '../../api/organizer';
import { useZ } from '../../theme';

export default function PeopleScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState<OrgOrderRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadOrders = useCallback(() => {
    let alive = true;
    setRefreshing(true);
    getOrgOrders({ limit: 100 })
      .then((page) => {
        if (!alive) return;
        setOrders(page.rows);
        setLoadError(null);
      })
      .catch((e: any) => {
        if (alive) setLoadError(e?.message ?? 'Could not load attendees.');
      })
      .finally(() => {
        if (alive) setRefreshing(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const cleanup = loadOrders();
    return cleanup;
  }, [loadOrders]);

  useFocusEffect(
    useCallback(() => {
      const cleanup = loadOrders();
      return cleanup;
    }, [loadOrders]),
  );

  const rows = useMemo(() => {
    const s = q.toLowerCase().replace(/\s/g, '');
    return orders.filter((p) => {
      const refs = p.credentials.join(' ');
      const phone = p.buyer.phone ?? '';
      const email = p.buyer.email ?? '';
      return !s ||
        refs.toLowerCase().includes(s) ||
        phone.replace(/\s/g, '').includes(s) ||
        email.toLowerCase().includes(s) ||
        p.tier.toLowerCase().includes(s) ||
        (p.eventName ?? '').toLowerCase().includes(s);
    });
  }, [q, orders]);

  const openAttendee = (p: OrgOrderRow) => {
    const contact = [p.buyer.phone, p.buyer.email].filter(Boolean).join('\n') || 'No buyer contact';
    const refs = p.credentials.length ? p.credentials.join(', ') : 'No issued credentials yet';
    Alert.alert(p.eventName || 'Order', `${p.tier} × ${p.qty}\n${contact}\nTicket refs: ${refs}\nStatus: ${p.status}`, [
      { text: 'Close', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: z.bg, paddingTop: insets.top + 8, paddingHorizontal: 20 }}>
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginBottom: 12 }}>Attendees</Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search ticket ref, phone, email or tier…"
        placeholderTextColor={z.mut2}
        style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, color: z.bone, padding: 13, marginBottom: 12 }}
      />
      {loadError ? (
        <View style={{ borderColor: z.orange + '66', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12, backgroundColor: z.orange + '12' }}>
          <Text style={{ color: z.orangeSoft, fontSize: 12 }}>{loadError}</Text>
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(p) => p.orderId}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { loadOrders(); }} tintColor={z.ultraSoft} />}
        ListEmptyComponent={
          <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 8 }}>
            <Text style={{ color: z.mut, fontSize: 13 }}>{refreshing ? 'Loading attendees…' : 'No attendees found yet.'}</Text>
          </View>
        }
        renderItem={({ item: p }) => (
          <Pressable
            onPress={() => openAttendee(p)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomColor: z.line2, borderBottomWidth: 1, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: z.bone, fontWeight: '600' }}>{p.buyer.email || p.buyer.phone || 'Buyer'}</Text>
              <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{p.credentials[0] || p.orderId.slice(0, 8)} · {p.eventName || p.eventId}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: z.mut, fontSize: 10, fontWeight: '700' }}>{p.tier || 'Ticket'}</Text>
              <Text style={{ color: p.status === 'paid' ? z.green : z.mut2, fontSize: 11, fontWeight: '700', marginTop: 5 }}>{p.status}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
