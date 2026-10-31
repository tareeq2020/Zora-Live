import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ApiError } from '../../api/client';
import { listMyTickets, requestConsumerOtp, verifyConsumerOtp, type ConsumerTicket } from '../../api/consumer';
import ZoraButton from '../../components/ZoraButton';
import { trackProductEvent } from '../../lib/productAnalytics';
import { useZ } from '../../theme';

type Pass = {
  n: string;
  d: string;
  tier: string;
  seat: string;
  holder: string;
  code: string;
  qr: string;
  eventId?: string;
  venue?: string | null;
  state?: string;
  issuedAt?: string;
};

const toPass = (ticket: ConsumerTicket): Pass => ({
  n: ticket.eventName,
  d: [ticket.dateLabel, ticket.venue].filter(Boolean).join(' · ') || 'Live pass',
  tier: ticket.tier,
  seat: ticket.tableNo ? `Table ${ticket.tableNo}` : ticket.seatIndex != null ? `Seat ${ticket.seatIndex}` : 'GA',
  holder: 'You',
  code: ticket.publicRef || ticket.code,
  qr: ticket.qr,
  eventId: ticket.eventId,
  venue: ticket.venue,
  state: ticket.state,
  issuedAt: ticket.issuedAt,
});

export default function TicketsScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);

  const load = useCallback(async (kind: 'initial' | 'refresh' = 'initial') => {
    if (kind === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const tickets = await listMyTickets();
      const next = tickets.map(toPass);
      setPasses(next);
      setNeedsSignIn(false);
      trackProductEvent('mobile_attendee_ticket_wallet_loaded', {
        role: 'consumer',
        count: next.length,
        status: 'ok',
      });
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        setNeedsSignIn(true);
        setPasses([]);
        trackProductEvent('mobile_attendee_ticket_wallet_loaded', {
          role: 'consumer',
          count: 0,
          status: 'unauthorized',
        });
      } else {
        setError(e?.message ?? 'Could not load tickets.');
        trackProductEvent('mobile_attendee_ticket_wallet_loaded', {
          role: 'consumer',
          count: 0,
          status: 'error',
          errorType: 'load_failed',
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const requestOtp = async () => {
    if (!phone.trim()) {
      Alert.alert('Enter your phone', 'Use the same phone number you bought tickets with.');
      return;
    }
    setOtpBusy(true);
    setError('');
    try {
      const res = await requestConsumerOtp(phone.trim());
      setOtpSent(true);
      trackProductEvent('mobile_attendee_otp_requested', { role: 'consumer', status: 'ok' });
      if (res.code) setCode(res.code);
    } catch (e: any) {
      setError(e?.message ?? 'Could not send the code.');
      trackProductEvent('mobile_attendee_otp_requested', { role: 'consumer', status: 'error', errorType: 'otp_request_failed' });
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!phone.trim() || !code.trim()) {
      Alert.alert('Enter the code', 'Use the SMS code sent to your phone.');
      return;
    }
    setOtpBusy(true);
    setError('');
    try {
      await verifyConsumerOtp(phone.trim(), code.trim());
      setOtpSent(false);
      setCode('');
      setNeedsSignIn(false);
      trackProductEvent('mobile_attendee_otp_verified', { role: 'consumer', status: 'ok' });
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'That code did not work.');
      trackProductEvent('mobile_attendee_otp_verified', { role: 'consumer', status: 'error', errorType: 'otp_verify_failed' });
    } finally {
      setOtpBusy(false);
    }
  };

  const subtitle = useMemo(() => {
    if (needsSignIn) return 'Sign in by phone to sync your paid tickets.';
    if (passes.length === 1) return '1 live pass';
    return `${passes.length} live passes`;
  }, [needsSignIn, passes.length]);

  const openPass = (p: Pass) => {
    trackProductEvent('mobile_attendee_ticket_viewed', {
      role: 'consumer',
      eventId: p.eventId,
      eventName: p.n,
      status: p.state || 'issued',
    });
    nav.navigate('TicketDetail', { pass: p });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: z.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={z.ultra} />}
    >
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginBottom: 4 }}>My tickets</Text>
      <Text style={{ color: z.mut, fontSize: 13, marginBottom: 16 }}>{subtitle}</Text>

      {needsSignIn ? (
        <View style={{ borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 16, backgroundColor: z.panel }}>
          <Text style={{ color: z.bone, fontWeight: '800', fontSize: 17 }}>Find your tickets</Text>
          <Text style={{ color: z.mut, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
            Enter the phone number used at checkout. We will send a one-time code and unlock the tickets attached to that number.
          </Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+255 712 345 678"
            placeholderTextColor={z.mut2}
            keyboardType="phone-pad"
            style={{ backgroundColor: z.bg, borderColor: z.line, borderWidth: 1, borderRadius: 14, color: z.bone, padding: 14, marginTop: 16 }}
          />
          {otpSent ? (
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="SMS code"
              placeholderTextColor={z.mut2}
              keyboardType="number-pad"
              style={{ backgroundColor: z.bg, borderColor: z.line, borderWidth: 1, borderRadius: 14, color: z.bone, padding: 14, marginTop: 10 }}
            />
          ) : null}
          <ZoraButton
            variant="gradient"
            disabled={otpBusy}
            label={otpBusy ? 'Please wait...' : otpSent ? 'Verify code' : 'Send code'}
            onPress={otpSent ? verifyOtp : requestOtp}
            style={{ marginTop: 14 }}
          />
          {otpSent ? (
            <Pressable onPress={requestOtp} disabled={otpBusy} style={{ paddingVertical: 12 }}>
              <Text style={{ color: z.mut, textAlign: 'center', fontSize: 12 }}>Send a new code</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <View style={{ borderColor: z.red, borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 12 }}>
          <Text style={{ color: z.red, fontWeight: '700' }}>{error}</Text>
          <Pressable onPress={() => load()} style={{ marginTop: 10 }}>
            <Text style={{ color: z.ultraSoft, fontWeight: '800' }}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {loading && !needsSignIn ? (
        <View style={{ borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 12 }}>
          <Text style={{ color: z.mut, textAlign: 'center' }}>Loading tickets...</Text>
        </View>
      ) : null}

      {passes.map((p) => (
        <Pressable
          key={p.code}
          onPress={() => openPass(p)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 12, opacity: pressed ? 0.8 : 1 })}
        >
          <View style={{ width: 54, height: 54, borderRadius: 12, backgroundColor: z.bone, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: z.bg, fontSize: 18, fontWeight: '900' }}>QR</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: z.bone, fontWeight: '700', fontSize: 15 }}>{p.n}</Text>
            <Text style={{ color: z.mut2, fontSize: 12, marginTop: 3 }}>{p.d}</Text>
            <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{p.code} · {p.seat}</Text>
          </View>
          <Text style={{ color: z.silver, fontWeight: '700', fontSize: 12 }}>View ›</Text>
        </Pressable>
      ))}

      {!loading && !needsSignIn && passes.length === 0 ? (
        <View style={{ borderColor: z.line, borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 2 }}>
          <Text style={{ color: z.bone, fontWeight: '800', textAlign: 'center' }}>No tickets yet</Text>
          <Text style={{ color: z.mut, fontSize: 12, textAlign: 'center', marginTop: 6 }}>
            Buy a pass from an event and it will appear here after payment is confirmed.
          </Text>
        </View>
      ) : null}

      <Text style={{ color: z.mut, textAlign: 'center', fontSize: 12, marginTop: 12 }}>
        Pull to refresh after payment. Gate staff verifies the QR live.
      </Text>
    </ScrollView>
  );
}
