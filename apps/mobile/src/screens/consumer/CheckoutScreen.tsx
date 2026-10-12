// Checkout / payment overview. Segmented toggle: Pay in full vs Split with crew.
// The "You pay" summary updates live with the chosen option and crew size.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import SegmentedControl from '../../components/SegmentedControl';
import ContactPickerModal, { type PickedContact } from '../../components/ContactPickerModal';
import ZoraButton from '../../components/ZoraButton';
import { createCheckout, getCheckoutStatus, startCheckoutPayment } from '../../api/checkout';
import { trackProductEvent } from '../../lib/productAnalytics';
import { useZ } from '../../theme';

interface CrewMember { id: string; name: string; phone: string; host?: boolean }
interface TableParam { id: string; label: string; price: number; capacity: number }
type CheckoutDone = null | 'pending' | 'paid' | 'locked' | 'failed' | 'expired' | 'short' | 'unseatable' | 'slow';

const initials = (n: string) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const PAYMENT_POLL_INTERVAL_MS = 3000;
const PAYMENT_POLL_ATTEMPTS = 40;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CheckoutScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const table = (route.params?.table ?? { id: 'T?', label: 'T?', price: 0, capacity: 6 }) as TableParam;
  const eventId = (route.params?.eventId as string | undefined) ?? 'unknown';
  const eventName = (route.params?.eventName as string) ?? 'OFFSHORE';
  const currency = (route.params?.currency as string) ?? 'TZS';
  const tierId = route.params?.tierId as string | undefined;
  const money = (amount: number) => `${currency} ${Math.round(amount).toLocaleString()}`;

  const [mode, setMode] = useState<'full' | 'split'>('full');
  const [crew, setCrew] = useState<CrewMember[]>([{ id: 'you', name: 'You', phone: 'host', host: true }]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [done, setDone] = useState<CheckoutDone>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [orderTotal, setOrderTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  const perPerson = useMemo(() => Math.round(table.price / Math.max(1, crew.length)), [table.price, crew.length]);
  const youPay = mode === 'full' ? table.price : perPerson;

  useEffect(() => () => { mountedRef.current = false; }, []);

  const addContact = (c: PickedContact) => {
    if (crew.length >= table.capacity) { Alert.alert('Table is full', `Table ${table.label} seats ${table.capacity}.`); return; }
    if (crew.some((m) => m.phone === c.phone)) { setPickerOpen(false); return; }
    setCrew((cur) => [...cur, { id: c.id, name: c.name, phone: c.phone }]);
    setPickerOpen(false);
  };
  const remove = (id: string) => setCrew((c) => c.filter((m) => m.host || m.id !== id));

  const pollPayment = async (orderId: string, total: number) => {
    for (let attempt = 0; attempt < PAYMENT_POLL_ATTEMPTS; attempt += 1) {
      try {
        const next = await getCheckoutStatus(orderId);
        if (next.status === 'paid') {
          trackProductEvent('mobile_attendee_payment_confirmed', { role: 'consumer', eventId, eventName, method: 'mobile', amount: total, currency, count: 1 });
          if (mountedRef.current) setDone('paid');
          return;
        }
        if (next.status === 'payment_short') {
          if (mountedRef.current) setDone('short');
          return;
        }
        if (next.status === 'paid_unseatable') {
          if (mountedRef.current) setDone('unseatable');
          return;
        }
        if (next.status === 'failed' || next.status === 'cancelled') {
          if (mountedRef.current) setDone('failed');
          return;
        }
        if (next.status === 'expired') {
          if (mountedRef.current) setDone('expired');
          return;
        }
      } catch {
        /* Keep polling through short network/API blips. */
      }
      await sleep(PAYMENT_POLL_INTERVAL_MS);
    }
    if (mountedRef.current) setDone('slow');
  };

  const payInFull = async () => {
    if (!tierId) {
      Alert.alert('Ticket tier missing', 'This table is not linked to a sellable ticket tier yet.');
      return;
    }
    if (!phone.trim() || !email.trim()) {
      Alert.alert('Add your details', 'Enter your phone and email to send the payment request.');
      return;
    }
    setBusy(true);
    try {
      trackProductEvent('mobile_attendee_checkout_started', { role: 'consumer', eventId, eventName, method: 'mobile', amount: table.price, currency, count: 1 });
      const order = await createCheckout({ phone: phone.trim(), email: email.trim(), tierId, quantity: 1 });
      setOrderTotal(order.total);
      trackProductEvent('mobile_attendee_payment_started', { role: 'consumer', eventId, eventName, method: 'mobile', amount: order.total, currency, count: 1 });
      await startCheckoutPayment(order.orderId, { method: 'mobile', phone: phone.trim() });
      if (!mountedRef.current) return;
      setDone('pending');
      void pollPayment(order.orderId, order.total);
    } catch (e: any) {
      Alert.alert('Payment could not start', e?.message ?? 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const lockAndSend = () => {
    Alert.alert(
      'Split checkout is next',
      'Pay-in-full is connected to the ZoraPass API now. Crew split links and exact table holds are part of the attendee phase.',
    );
  };

  if (done) {
    const splitFriends = crew.length - 1;
    const doneCopy: Record<Exclude<CheckoutDone, null>, { title: string; body: string; mark: string; tone: string; canRetry?: boolean }> = {
      pending: {
        title: 'Approve on your phone',
        body: `We sent a mobile-money prompt to ${phone.trim()}. Your pass appears in Tickets once payment confirms.`,
        mark: '…',
        tone: z.ultra,
      },
      paid: {
        title: 'You’re in',
        body: `Table ${table.label} is yours. ${money(orderTotal ?? table.price)} confirmed — your pass is in Tickets.`,
        mark: '✓',
        tone: z.green,
      },
      locked: {
        title: 'Table locked · links sent',
        body: `${splitFriends} friend${splitFriends === 1 ? '' : 's'} previewed at ${money(perPerson)} each. Split payment links are part of the attendee phase.`,
        mark: '✓',
        tone: z.green,
      },
      failed: {
        title: 'Payment was not completed',
        body: 'No pass has been issued yet. You can try the payment request again.',
        mark: '!',
        tone: z.orange,
        canRetry: true,
      },
      expired: {
        title: 'Payment window expired',
        body: 'The payment request expired before confirmation. Start again to reserve this table.',
        mark: '!',
        tone: z.orange,
        canRetry: true,
      },
      short: {
        title: 'Payment needs review',
        body: 'The payment received does not match the order total yet. Support can reconcile this before issuing the pass.',
        mark: '!',
        tone: z.orange,
      },
      unseatable: {
        title: 'Payment received · table issue',
        body: 'Payment was received, but the table could not be assigned automatically. Support needs to resolve this order.',
        mark: '!',
        tone: z.orange,
      },
      slow: {
        title: 'Still checking payment',
        body: 'This can take a minute. Open Tickets after the confirmation SMS arrives, or try again if the prompt was cancelled.',
        mark: '…',
        tone: z.ultra,
      },
    };
    const copy = doneCopy[done];
    return (
      <View style={{ flex: 1, backgroundColor: z.bg, paddingTop: insets.top + 44, paddingHorizontal: 24 }}>
        <View style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: copy.tone, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 34, color: '#04140c', fontWeight: '900' }}>{copy.mark}</Text>
        </View>
        <Text style={{ color: z.bone, fontSize: 26, fontWeight: '900', marginTop: 20 }}>
          {copy.title}
        </Text>
        <Text style={{ color: z.mut, marginTop: 8, fontSize: 14, lineHeight: 20 }}>
          {copy.body}
        </Text>
        <ZoraButton
          variant="gradient"
          label={copy.canRetry ? 'Try again' : 'Done'}
          onPress={() => (copy.canRetry ? setDone(null) : nav.navigate('Home'))}
          style={{ marginTop: 28 }}
        />
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

        {mode === 'full' && (
          <View>
            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>PAYMENT DETAILS</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+255 712 345 678"
              placeholderTextColor={z.mut2}
              keyboardType="phone-pad"
              style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, color: z.bone, padding: 14, marginBottom: 10 }}
            />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              placeholderTextColor={z.mut2}
              keyboardType="email-address"
              autoCapitalize="none"
              style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, color: z.bone, padding: 14 }}
            />
          </View>
        )}

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
          disabled={busy}
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
