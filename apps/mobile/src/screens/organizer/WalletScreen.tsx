import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ZoraButton from '../../components/ZoraButton';
import { useSession } from '../../session/store';
import { getKycStatus } from '../../api/kyc';
import {
  getOrgPayouts,
  getPayoutMethods,
  requestOrgPayout,
  type PayoutBalance,
  type PayoutDestinationCatalog,
  type PayoutRecord,
  type PayoutsView,
} from '../../api/payouts';
import { trackProductEvent } from '../../lib/productAnalytics';
import type { WalletStackParams } from '../../navigation/OrganizerTabs';
import { useZ } from '../../theme';

export default function WalletScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState('MPESA');
  const [account, setAccount] = useState('');
  const [payouts, setPayouts] = useState<PayoutsView | null>(null);
  const [catalog, setCatalog] = useState<PayoutDestinationCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Payout gate — withdrawals stay locked until KYC identity verification passes.
  const nav = useNavigation<NativeStackNavigationProp<WalletStackParams>>();
  const verified = useSession((s) => s.verified);
  const kycPending = useSession((s) => s.kycPending);
  const kycRejection = useSession((s) => s.kycRejection);
  const applyKycStatus = useSession((s) => s.applyKycStatus);
  const hydrateKyc = useSession((s) => s.hydrateKyc);
  const setVerified = useSession((s) => s.setVerified);

  const loadWallet = useCallback(() => {
    let alive = true;
    setRefreshing(true);
    Promise.all([getOrgPayouts(), getPayoutMethods()])
      .then(([view, methods]) => {
        if (!alive) return;
        setPayouts(view);
        setCatalog(methods);
        setVerified(view.verified);
        setLoadError(null);
        setProvider((cur) => methods.mnos.some((m) => m.code === cur) ? cur : methods.mnos[0]?.code ?? cur);
      })
      .catch((e: any) => {
        if (alive) setLoadError(e?.message ?? 'Could not load wallet.');
      })
      .finally(() => {
        if (alive) setRefreshing(false);
      });
    return () => { alive = false; };
  }, [setVerified]);

  useEffect(() => {
    const cleanup = loadWallet();
    return cleanup;
  }, [loadWallet]);

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
        if (alive) loadWallet();
      })();
      return () => { alive = false; };
    }, [hydrateKyc, applyKycStatus, loadWallet]),
  );

  const startVerify = () => nav.navigate('KycVerify');

  const primaryBalance: PayoutBalance = payouts?.balances[0] ?? { currency: 'TZS', earned: 0, reserved: 0, paidOut: 0, available: 0, minimum: 0 };
  const apiVerified = payouts?.verified ?? verified;
  const providers = catalog?.mnos ?? [{ code: 'MPESA', name: 'Vodacom (M-Pesa)' }];
  const selectedProvider = providers.find((p) => p.code === provider) ?? providers[0];
  const amountNum = Math.min(primaryBalance.available, parseInt(amount.replace(/\D/g, '') || '0', 10));
  const fmt = (n: number) => `${primaryBalance.currency} ${n.toLocaleString()}`;
  const money = (currency: string, n: number) => `${currency} ${n.toLocaleString()}`;
  const statusLabel = (p: PayoutRecord) => p.status === 'approved' ? 'Completed' : p.status === 'rejected' ? 'Rejected' : 'Requested';
  const statusColor = (p: PayoutRecord) => p.status === 'approved' ? z.green : p.status === 'rejected' ? z.red : z.amber;
  const destinationLabel = (p: PayoutRecord) =>
    p.destination ? `${p.destination.providerName} · ${p.destination.account}` : 'Legacy payout destination';
  const payoutRows = useMemo(() => payouts?.payouts ?? [], [payouts]);

  // Cash out is only reachable when verified; otherwise route to verification.
  const openSheet = () => {
    if (!apiVerified) { startVerify(); return; }
    if (primaryBalance.available <= 0) {
      Alert.alert('No available balance', 'Paid orders will appear here once they settle into your withdrawable balance.');
      return;
    }
    setAmount(String(primaryBalance.available));
    setOpen(true);
  };

  const confirm = async () => {
    if (!apiVerified) return;                 // hard gate: no withdrawal without verification
    if (amountNum <= 0) return;
    if (!selectedProvider?.code) return;
    if (!account.trim()) {
      Alert.alert('Add receiving number', 'Enter the mobile-money number where Zora should send this payout.');
      return;
    }
    setBusy(true);
    try {
      await requestOrgPayout({
        amount: amountNum,
        currency: primaryBalance.currency,
        destination: { method: 'mobile_money', provider: selectedProvider.code, account: account.trim() },
      });
      trackProductEvent('mobile_organizer_payout_requested', {
        role: 'organizer',
        method: 'mobile_money',
        currency: primaryBalance.currency,
        status: 'requested',
      });
      setOpen(false);
      loadWallet();
      Alert.alert('Withdrawal requested', 'Zora ops will process this payout and update the ledger.');
    } catch (e: any) {
      trackProductEvent('mobile_organizer_payout_requested', {
        role: 'organizer',
        method: 'mobile_money',
        currency: primaryBalance.currency,
        status: 'failed',
        errorType: 'request_failed',
      });
      Alert.alert('Withdrawal not requested', e?.message ?? 'Check the amount and destination, then try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: z.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { loadWallet(); }} tintColor={z.ultraSoft} />}
    >
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginBottom: 16 }}>Wallet</Text>

      {loadError ? (
        <View style={{ borderColor: z.orange + '66', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14, backgroundColor: z.orange + '12' }}>
          <Text style={{ color: z.orangeSoft, fontSize: 12 }}>{loadError}</Text>
        </View>
      ) : null}

      {!apiVerified && (() => {
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
        <Text style={{ color: z.bone, fontSize: 46, fontFamily: z.disp, marginTop: 6 }}>{money(primaryBalance.currency, primaryBalance.available)}</Text>
        <ZoraButton
          variant={apiVerified ? 'gradient' : 'ghost'}
          disabled={!apiVerified || primaryBalance.available <= 0}
          label={apiVerified ? 'Cash out' : kycPending ? 'Cash out · under review' : 'Cash out · locked'}
          onPress={openSheet}
          style={{ marginTop: 14 }}
        />
        <Text style={{ color: z.mut, marginTop: 14, fontSize: 12 }}>
          Earned {money(primaryBalance.currency, primaryBalance.earned)} · reserved {money(primaryBalance.currency, primaryBalance.reserved)} · paid out {money(primaryBalance.currency, primaryBalance.paidOut)}
        </Text>
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>WITHDRAWAL HISTORY</Text>
      {payoutRows.length ? payoutRows.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomColor: z.line2, borderBottomWidth: 1 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: z.bone, fontWeight: '700' }}>{money(p.currency, p.amount)}</Text>
            <Text style={{ color: z.mut2, fontSize: 12, marginTop: 2 }}>{destinationLabel(p)}</Text>
          </View>
          <Text style={{ color: statusColor(p), fontWeight: '700', fontSize: 12 }}>{statusLabel(p)}</Text>
        </View>
      )) : (
        <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 16, padding: 16 }}>
          <Text style={{ color: z.mut, fontSize: 13 }}>No withdrawal requests yet.</Text>
        </View>
      )}

      {/* Cash-out sheet */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={{ backgroundColor: z.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: z.line, alignSelf: 'center', marginBottom: 14 }} />
            <Text style={{ color: z.bone, fontSize: 22, fontWeight: '900' }}>Cash out</Text>
            <Text style={{ color: z.mut, marginTop: 4, marginBottom: 14 }}>Available {money(primaryBalance.currency, primaryBalance.available)}</Text>

            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>AMOUNT ({primaryBalance.currency})</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <TextInput
                value={amountNum.toLocaleString()}
                onChangeText={setAmount}
                keyboardType="number-pad"
                style={{ flex: 1, backgroundColor: z.panel2, borderColor: z.line, borderWidth: 1, borderRadius: 12, color: z.bone, fontSize: 20, fontWeight: '800', padding: 14 }}
              />
              <Pressable onPress={() => setAmount(String(primaryBalance.available))} style={{ borderColor: z.line, borderWidth: 1, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Text style={{ color: z.ultraSoft, fontWeight: '700', fontSize: 12 }}>Max</Text>
              </Pressable>
            </View>

            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>SEND TO</Text>
            {providers.map((r) => {
              const on = provider === r.code;
              return (
                <Pressable key={r.code} onPress={() => setProvider(r.code)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: on ? z.ultra : z.line, backgroundColor: on ? 'rgba(61,90,254,0.1)' : z.panel2, marginBottom: 10 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: z.ultra + '28' }}>
                    <Text style={{ color: z.ultraSoft, fontWeight: '700', fontSize: 12 }}>{r.code.slice(0, 3)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: z.bone, fontWeight: '600' }}>{r.name}</Text>
                    <Text style={{ color: z.mut2, fontSize: 12, marginTop: 2 }}>Mobile money payout</Text>
                  </View>
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? z.ultra : z.line, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: z.ultra }} /> : null}
                  </View>
                </Pressable>
              );
            })}

            <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 4, marginBottom: 8 }}>RECEIVING NUMBER</Text>
            <TextInput
              value={account}
              onChangeText={setAccount}
              keyboardType="phone-pad"
              placeholder="+255 7XX XXX XXX"
              placeholderTextColor={z.mut2}
              style={{ backgroundColor: z.panel2, borderColor: z.line, borderWidth: 1, borderRadius: 12, color: z.bone, fontSize: 15, padding: 14, marginBottom: 14 }}
            />

            <ZoraButton variant="gradient" label={busy ? 'Requesting…' : `Withdraw ${fmt(amountNum)} to ${selectedProvider?.name ?? 'mobile money'}`} onPress={confirm} disabled={busy} style={{ marginTop: 6 }} />
            <Text style={{ color: z.mut2, textAlign: 'center', fontSize: 11, marginTop: 12 }}>Zora fee already deducted. No withdrawal charge.</Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
