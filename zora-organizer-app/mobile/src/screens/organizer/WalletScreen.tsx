import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ZoraButton from '../../components/ZoraButton';
import { useSession } from '../../session/store';
import { getKycStatus } from '../../api/kyc';
import type { WalletStackParams } from '../../navigation/OrganizerTabs';
import { useZ } from '../../theme';

interface Withdrawal { a: string; s: string; tag: string; c: string }
const BALANCE = 64_200_000;

export default function WalletScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const INITIAL: Withdrawal[] = [
    { a: 'TZS 30,000,000', s: 'Completed to M-Pesa', tag: 'Completed', c: z.green },
    { a: 'TZS 12,500,000', s: 'Processing · Airtel Money', tag: 'Processing', c: z.amber },
    { a: 'TZS 8,000,000', s: 'Failed · wrong Tigo number', tag: 'Failed', c: z.red },
  ];
  const ROUTES = [
    { r: 'M-Pesa', sub: '•••• 4471 · instant', badge: 'M-P', tint: z.green },
    { r: 'Tigo Pesa', sub: 'Mixx by Yas · instant', badge: 'TIG', tint: z.ultra },
    { r: 'Airtel Money', sub: '•••• 8820 · instant', badge: 'AIR', tint: z.red },
    { r: 'Bank transfer', sub: 'CRDB / NMB · 1–2 days', badge: 'BNK', tint: z.mut },
  ];
  const [history, setHistory] = useState<Withdrawal[]>(INITIAL);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(BALANCE));
  const [route, setRoute] = useState(ROUTES[0].r);

  // Payout gate — withdrawals stay locked until KYC identity verification passes.
  const nav = useNavigation<NativeStackNavigationProp<WalletStackParams>>();
  const verified = useSession((s) => s.verified);
  const kycPending = useSession((s) => s.kycPending);
  const kycRejection = useSession((s) => s.kycRejection);
  const applyKycStatus = useSession((s) => s.applyKycStatus);
  const hydrateKyc = useSession((s) => s.hydrateKyc);

  // On focus: restore any saved ref and poll the real pipeline, so the wallet
  // unlocks the moment an admin approves — no client-side self-approval.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await hydrateKyc();
        const ref = useSession.getState().kycRef;
        if (!ref || useSession.getState().verified) return;
        try { const s = await getKycStatus(ref); if (alive) applyKycStatus(s.status, s.reason); }
        catch { /* server unreachable — leave state as-is */ }
      })();
      return () => { alive = false; };
    }, [hydrateKyc, applyKycStatus]),
  );

  const startVerify = () => nav.navigate('KycVerify');

  const amountNum = Math.min(BALANCE, parseInt(amount.replace(/\D/g, '') || '0', 10));
  const fmt = (n: number) => 'TZS ' + n.toLocaleString();

  // Cash out is only reachable when verified; otherwise route to verification.
  const openSheet = () => {
    if (!verified) { startVerify(); return; }
    setAmount(String(BALANCE));
    setOpen(true);
  };

  const confirm = () => {
    if (!verified) return;                 // hard gate: no withdrawal without verification
    if (amountNum <= 0) return;
    setHistory((h) => [{ a: fmt(amountNum), s: 'Processing · ' + route, tag: 'Processing', c: z.amber }, ...h]);
    setOpen(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}>
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginBottom: 16 }}>Wallet</Text>

      {!verified && (() => {
        const accent = kycRejection ? z.red : z.amber;
        const title = kycPending ? 'Identity under review' : kycRejection ? 'Verification unsuccessful' : 'Verify your identity to cash out';
        const body = kycPending
          ? 'Usually approved within 24 hours. Payouts unlock the moment it clears.'
          : kycRejection
            ? kycRejection
            : 'Payouts stay locked until your ID is approved — it protects your money and your buyers.';
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: accent + '1A', borderColor: accent + '55', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: accent, fontWeight: '700', fontSize: 14 }}>{title}</Text>
              <Text style={{ color: z.mut, fontSize: 12, marginTop: 3, lineHeight: 17 }}>{body}</Text>
            </View>
            {!kycPending && (
              <Pressable onPress={startVerify} style={{ backgroundColor: accent, borderRadius: 10, paddingHorizontal: 15, paddingVertical: 11 }}>
                <Text style={{ color: z.bg, fontWeight: '700', fontSize: 13 }}>{kycRejection ? 'Resubmit' : 'Verify'}</Text>
              </Pressable>
            )}
          </View>
        );
      })()}

      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 22, padding: 22 }}>
        <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>AVAILABLE BALANCE</Text>
        <Text style={{ color: z.bone, fontSize: 46, fontFamily: z.disp, marginTop: 6 }}>TZS 64.2M</Text>
        <ZoraButton
          variant={verified ? 'gradient' : 'ghost'}
          disabled={!verified}
          label={verified ? 'Cash out' : kycPending ? 'Cash out · under review' : 'Cash out · locked'}
          onPress={openSheet}
          style={{ marginTop: 14 }}
        />
        <Text style={{ color: z.mut, marginTop: 14, fontSize: 12 }}>Pending settlement · TZS 27.2M · clears 24h post-event</Text>
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>WITHDRAWAL HISTORY</Text>
      {history.map((h, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomColor: z.line2, borderBottomWidth: 1 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: z.bone, fontWeight: '700' }}>{h.a}</Text>
            <Text style={{ color: z.mut2, fontSize: 12, marginTop: 2 }}>{h.s}</Text>
          </View>
          <Text style={{ color: h.c, fontWeight: '700', fontSize: 12 }}>{h.tag}</Text>
        </View>
      ))}

      {/* Cash-out sheet */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={{ backgroundColor: z.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: z.line, alignSelf: 'center', marginBottom: 14 }} />
            <Text style={{ color: z.bone, fontSize: 22, fontWeight: '900' }}>Cash out</Text>
            <Text style={{ color: z.mut, marginTop: 4, marginBottom: 14 }}>Available {fmt(BALANCE)}</Text>

            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>AMOUNT (TZS)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <TextInput
                value={amountNum.toLocaleString()}
                onChangeText={setAmount}
                keyboardType="number-pad"
                style={{ flex: 1, backgroundColor: z.panel2, borderColor: z.line, borderWidth: 1, borderRadius: 12, color: z.bone, fontSize: 20, fontWeight: '800', padding: 14 }}
              />
              <Pressable onPress={() => setAmount(String(BALANCE))} style={{ borderColor: z.line, borderWidth: 1, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Text style={{ color: z.ultraSoft, fontWeight: '700', fontSize: 12 }}>Max</Text>
              </Pressable>
            </View>

            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>SEND TO</Text>
            {ROUTES.map((r) => {
              const on = route === r.r;
              return (
                <Pressable key={r.r} onPress={() => setRoute(r.r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: on ? z.ultra : z.line, backgroundColor: on ? 'rgba(61,90,254,0.1)' : z.panel2, marginBottom: 10 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: r.tint + '28' }}>
                    <Text style={{ color: r.tint, fontWeight: '700', fontSize: 12 }}>{r.badge}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: z.bone, fontWeight: '600' }}>{r.r}</Text>
                    <Text style={{ color: z.mut2, fontSize: 12, marginTop: 2 }}>{r.sub}</Text>
                  </View>
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? z.ultra : z.line, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: z.ultra }} /> : null}
                  </View>
                </Pressable>
              );
            })}

            <ZoraButton variant="gradient" label={`Withdraw ${fmt(amountNum)} to ${route}`} onPress={confirm} style={{ marginTop: 6 }} />
            <Text style={{ color: z.mut2, textAlign: 'center', fontSize: 11, marginTop: 12 }}>Zora fee already deducted. No withdrawal charge.</Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
