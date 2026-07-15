// Checkout / payment overview. Segmented toggle: Pay in full vs Split with crew.
// The "You pay" summary updates live with the chosen option and crew size.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import SegmentedControl from '../../components/SegmentedControl';
import ContactPickerModal, { type PickedContact } from '../../components/ContactPickerModal';
import ZoraButton from '../../components/ZoraButton';
import { useZ } from '../../theme';

interface CrewMember { id: string; name: string; phone: string; host?: boolean }
interface TableParam { id: string; label: string; price: number; capacity: number }

const initials = (n: string) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export default function CheckoutScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const table = (route.params?.table ?? { id: 'T?', label: 'T?', price: 0, capacity: 6 }) as TableParam;
  const eventName = (route.params?.eventName as string) ?? 'OFFSHORE';
  const currency = (route.params?.currency as string) ?? 'TZS';
  const money = (minor: number) => `${currency} ${Math.round(minor / 100).toLocaleString()}`;

  const [mode, setMode] = useState<'full' | 'split'>('full');
  const [crew, setCrew] = useState<CrewMember[]>([{ id: 'you', name: 'You', phone: 'host', host: true }]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [done, setDone] = useState<null | 'paid' | 'locked'>(null);

  const perPerson = useMemo(() => Math.round(table.price / Math.max(1, crew.length)), [table.price, crew.length]);
  const youPay = mode === 'full' ? table.price : perPerson;

  const addContact = (c: PickedContact) => {
    if (crew.length >= table.capacity) { Alert.alert('Table is full', `Table ${table.label} seats ${table.capacity}.`); return; }
    if (crew.some((m) => m.phone === c.phone)) { setPickerOpen(false); return; }
    setCrew((cur) => [...cur, { id: c.id, name: c.name, phone: c.phone }]);
    setPickerOpen(false);
  };
  const remove = (id: string) => setCrew((c) => c.filter((m) => m.host || m.id !== id));

  const payInFull = () =>
    Alert.alert('Pay in full', `Charge ${money(table.price)} to M-Pesa •••• 4471?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay', onPress: () => setDone('paid') },
    ]);

  const lockAndSend = () => {
    if (crew.length < 2) { Alert.alert('Add your crew', 'Invite at least one friend to split the table.'); return; }
    // TODO(gate): POST /events/:id/split → hold table 10 min, create per-member
    //   M-Pesa STK / card links, send push. Webhook marks each member paid.
    setDone('locked');
  };

  if (done) {
    const splitFriends = crew.length - 1;
    return (
      <View style={{ flex: 1, backgroundColor: z.bg, paddingTop: insets.top + 44, paddingHorizontal: 24 }}>
        <View style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: z.green, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 34, color: '#04140c', fontWeight: '900' }}>✓</Text>
        </View>
        <Text style={{ color: z.bone, fontSize: 26, fontWeight: '900', marginTop: 20 }}>
          {done === 'paid' ? 'You’re in' : 'Table locked · links sent'}
        </Text>
        <Text style={{ color: z.mut, marginTop: 8, fontSize: 14, lineHeight: 20 }}>
          {done === 'paid'
            ? `Table ${table.label} is yours. ${money(table.price)} charged — your pass is in Tickets.`
            : `${splitFriends} friend${splitFriends === 1 ? '' : 's'} got a push + M-Pesa / card link for ${money(perPerson)} each. The table holds for 10 minutes while they pay.`}
        </Text>
        <ZoraButton variant="gradient" label="Done" onPress={() => nav.navigate('Home')} style={{ marginTop: 28 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: z.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => nav.goBack()} hitSlop={12}>
          <Text style={{ color: z.mut, fontSize: 14, fontWeight: '600', paddingVertical: 8 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: z.bone, fontSize: 28, fontFamily: z.disp }}>Checkout</Text>

        <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: z.bone, fontWeight: '700' }}>{eventName} · Table {table.label}</Text>
            <Text style={{ color: z.bone, fontWeight: '700' }}>{money(table.price)}</Text>
          </View>
          <Text style={{ color: z.mut2, fontSize: 12, marginTop: 4 }}>{table.capacity} seats</Text>
        </View>

        <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>PAYMENT</Text>
        <SegmentedControl
          options={[{ key: 'full', label: 'Pay in full' }, { key: 'split', label: 'Split with crew' }]}
          value={mode}
          onChange={(k) => setMode(k as 'full' | 'split')}
        />

        <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: z.mut }}>You pay</Text>
            <Text style={{ color: z.bone, fontSize: 24, fontWeight: '900' }}>{money(youPay)}</Text>
          </View>
          <Text style={{ color: z.mut2, fontSize: 12, marginTop: 4 }}>
            {mode === 'full'
              ? 'The whole table, charged to you.'
              : `Split ${crew.length} ways · ${crew.length - 1} friend${crew.length - 1 === 1 ? '' : 's'} pay ${money(perPerson)} each.`}
          </Text>
        </View>

        {mode === 'split' && (
          <View>
            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 6 }}>
              YOUR CREW · {crew.length}/{table.capacity}
            </Text>
            {crew.map((m) => (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: z.line2, borderBottomWidth: 1 }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: z.panel2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: z.bone, fontWeight: '700' }}>{m.host ? '★' : initials(m.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: z.bone, fontWeight: '600' }}>{m.name}</Text>
                  <Text style={{ color: z.mut2, fontSize: 12, marginTop: 2 }}>{money(perPerson)}{m.phone !== 'host' ? ' · ' + m.phone : ''}</Text>
                </View>
                {m.host ? (
                  <Text style={{ color: z.ultraSoft, fontSize: 11, fontWeight: '700' }}>You</Text>
                ) : (
                  <Pressable onPress={() => remove(m.id)} hitSlop={10}><Text style={{ color: z.mut2, fontSize: 18 }}>✕</Text></Pressable>
                )}
              </View>
            ))}
            <Pressable onPress={() => setPickerOpen(true)} style={{ marginTop: 14, padding: 15, borderRadius: 14, borderColor: z.line, borderWidth: 1, borderStyle: 'dashed' }}>
              <Text style={{ color: z.ultraSoft, fontWeight: '700', textAlign: 'center' }}>＋ Add from contacts</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16 }}>
        <ZoraButton
          variant="gradient"
          onPress={mode === 'full' ? payInFull : lockAndSend}
          label={mode === 'full' ? `Pay ${money(table.price)}` : 'Lock table & send payment links'}
        />
      </View>

      <ContactPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={addContact}
        takenPhones={crew.map((m) => m.phone)}
      />
    </View>
  );
}
