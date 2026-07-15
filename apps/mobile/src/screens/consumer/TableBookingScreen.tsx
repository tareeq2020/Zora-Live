// Booking flow with the interactive seat map — now event-aware. Reads the event
// id from route params and loads that event's own floor plan, name and currency.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import SeatMap from '../../seatmap/SeatMap';
import type { FloorPlan, Seat, SeatStatus } from '../../seatmap/types';
import { getBooking } from '../../data/floorPlans';
import { useRealtime } from '../../realtime/useRealtime';
import { useZ } from '../../theme';

function Legend({ color, label }: { color: string; label: string }) {
  const z = useZ();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: z.mut, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export default function TableBookingScreen() {
  const z = useZ();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const booking = getBooking(route.params?.eventId);
  const money = (minor: number) => `${booking.currency} ${Math.round(minor / 100).toLocaleString()}`;

  const [plan, setPlan] = useState<FloorPlan>(booking.plan);
  const [selected, setSelected] = useState<Seat | null>(null);

  // Live availability for this specific event.
  useRealtime(`wss://gate.zora.app/events/${booking.id}/seats`, (m: { id: string; status: SeatStatus }) =>
    setPlan((p) => ({ ...p, seats: p.seats.map((s) => (s.id === m.id ? { ...s, status: m.status } : s)) })),
  );

  const onSelect = (seat: Seat) => {
    if (seat.status !== 'available') return;
    setSelected(seat);
    setPlan((p) => ({
      ...p,
      seats: p.seats.map((s) => (s.id === seat.id ? { ...s, status: 'selected' } : s.status === 'selected' ? { ...s, status: 'available' } : s)),
    }));
  };

  return (
    <View style={{ flex: 1, backgroundColor: z.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 120 }}>
        <Pressable onPress={() => nav.goBack()} hitSlop={12}>
          <Text style={{ color: z.mut, fontSize: 14, fontWeight: '600', paddingVertical: 8 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>BOOKING · TABLES / VIP</Text>
        <Text style={{ color: z.bone, fontSize: 28, fontFamily: z.disp, marginTop: 4 }}>{booking.name}</Text>
        <Text style={{ color: z.mut, fontSize: 12, marginTop: 4, marginBottom: 12 }}>{booking.venue} · {booking.date}</Text>

        <SeatMap plan={plan} viewport={{ width: width - 40, height: 360 }} onSelect={onSelect} />

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 }}>
          <Legend color={z.ultra} label="Available" />
          <Legend color={z.orange} label="Selected" />
          <Legend color="#2a2a30" label="Sold" />
        </View>
        <Text style={{ color: z.mut2, textAlign: 'center', fontSize: 11, marginTop: 10 }}>
          Pinch to zoom · double-tap to fit · tap a table to select
        </Text>
      </ScrollView>

      {selected && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16, backgroundColor: z.panel2, borderColor: z.ultra, borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: z.bone, fontWeight: '700' }}>Table {selected.label}</Text>
            <Text style={{ color: z.mut, fontSize: 12, marginTop: 3 }}>{selected.capacity} seats · {money(selected.price)}</Text>
          </View>
          <Pressable
            onPress={() => nav.navigate('Checkout', {
              table: { id: selected.id, label: selected.label, price: selected.price, capacity: selected.capacity },
              eventName: booking.name,
              currency: booking.currency,
            })}
            style={{ backgroundColor: z.ultra, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Get this table</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
