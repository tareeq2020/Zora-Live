import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, Alert, TextInput, Modal, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import SwitchModeButton from '../../components/SwitchModeButton';
import ThemeToggle from '../../components/ThemeToggle';
import { useSession } from '../../session/store';
import { signOutNest } from '../../lib/auth';
import { useZ } from '../../theme';
import {
  createOrgScanner,
  getOrgEvents,
  getOrgScanners,
  revokeOrgScanner,
  rotateOrgScanner,
  type OrgEvent,
  type OrgScanner,
} from '../../api/organizer';

function InfoRow({ k, v, onPress, last }: { k: string; v: string; onPress?: () => void; last?: boolean }) {
  const z = useZ();
  const body = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomColor: z.line2, borderBottomWidth: last ? 0 : 1 }}>
      <Text style={{ color: z.bone, fontSize: 14 }}>{k}</Text>
      <Text style={{ color: onPress ? z.ultraSoft : z.mut2, fontSize: 12 }}>{v}{onPress ? '  ›' : ''}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

function ToggleRow({ k, value, onValueChange, last }: { k: string; value: boolean; onValueChange: (v: boolean) => void; last?: boolean }) {
  const z = useZ();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomColor: z.line2, borderBottomWidth: last ? 0 : 1 }}>
      <Text style={{ color: z.bone, fontSize: 14 }}>{k}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: z.panel2, true: z.ultra }} thumbColor="#fff" ios_backgroundColor={z.panel2} />
    </View>
  );
}

export default function SettingsScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const name = useSession((s) => s.name);
  const email = useSession((s) => s.email);
  const organizerHandle = useSession((s) => s.organizerHandle);
  const verified = useSession((s) => s.verified);
  const kycPending = useSession((s) => s.kycPending);
  const [twoFA, setTwoFA] = useState(true);
  const [push, setPush] = useState(true);
  const [resale, setResale] = useState(true);
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [scanners, setScanners] = useState<OrgScanner[]>([]);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addingStaff, setAddingStaff] = useState(false);
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffContact, setStaffContact] = useState('');
  const [staffEventId, setStaffEventId] = useState('');
  const [staffRole, setStaffRole] = useState<'agent' | 'supervisor'>('agent');
  const [staffCanSell, setStaffCanSell] = useState(false);

  const editPayout = () => Alert.alert('Payout account', 'Change where payouts land (M-Pesa, Tigo, Airtel or bank) on the Zora web dashboard.', [{ text: 'OK' }]);
  const eventName = useCallback((id: string | null) => events.find((e) => e.id === id)?.name || id || 'Event', [events]);

  const loadStaff = useCallback(() => {
    let alive = true;
    setRefreshing(true);
    Promise.all([getOrgEvents(), getOrgScanners()])
      .then(([nextEvents, nextScanners]) => {
        if (!alive) return;
        setEvents(nextEvents);
        setScanners(nextScanners);
        setStaffEventId((current) => current || nextEvents.find((e) => e.status !== 'archived')?.id || nextEvents[0]?.id || '');
        setStaffError(null);
      })
      .catch((e: any) => {
        if (alive) setStaffError(e?.message ?? 'Could not load door staff.');
      })
      .finally(() => {
        if (alive) setRefreshing(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const cleanup = loadStaff();
    return cleanup;
  }, [loadStaff]);

  useFocusEffect(
    useCallback(() => {
      const cleanup = loadStaff();
      return cleanup;
    }, [loadStaff]),
  );

  const resetStaffForm = () => {
    setStaffName('');
    setStaffContact('');
    setStaffRole('agent');
    setStaffCanSell(false);
    setStaffEventId(events.find((e) => e.status !== 'archived')?.id || events[0]?.id || '');
  };

  const openAddStaff = () => {
    resetStaffForm();
    setAddingStaff(true);
  };

  const createStaff = async () => {
    const name = staffName.trim();
    const contact = staffContact.trim();
    if (!name || !contact || !staffEventId) {
      Alert.alert('Missing details', 'Enter a name, contact, and event for this door person.');
      return;
    }
    setCreatingStaff(true);
    try {
      const created = await createOrgScanner({ name, contact, eventId: staffEventId, role: staffRole, canSell: staffCanSell });
      setScanners((list) => [...list, created]);
      setAddingStaff(false);
      resetStaffForm();
      Alert.alert('Door code created', `${created.name}\nCode: ${created.code}\nEvent: ${eventName(created.eventScope)}`);
    } catch (e: any) {
      Alert.alert('Could not create door staff', e?.message ?? 'Please try again.');
    } finally {
      setCreatingStaff(false);
    }
  };

  const rotateStaff = (s: OrgScanner) => {
    Alert.alert('Rotate access code?', `${s.name}'s current code will stop working.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rotate',
        onPress: async () => {
          try {
            const next = await rotateOrgScanner(s.id);
            setScanners((list) => list.map((x) => (x.id === s.id ? next : x)));
            Alert.alert('New door code', `${next.name}\nCode: ${next.code}`);
          } catch (e: any) {
            Alert.alert('Could not rotate code', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  };

  const revokeStaff = (s: OrgScanner) => {
    Alert.alert('Revoke door access?', `${s.name} will no longer be able to scan or sell at the gate.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            const next = await revokeOrgScanner(s.id);
            setScanners((list) => list.map((x) => (x.id === s.id ? next : x)));
          } catch (e: any) {
            Alert.alert('Could not revoke access', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: z.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { loadStaff(); }} tintColor={z.ultraSoft} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp }}>Settings</Text>
        <ThemeToggle />
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 6 }}>ACCOUNT</Text>
      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 }}>
        <InfoRow k="Name" v={name || organizerHandle || 'Organizer'} />
        <InfoRow k="Email" v={email || 'Not available'} />
        <InfoRow k="Identity (KYC)" v={verified ? 'Verified' : kycPending ? 'Under review' : 'Not verified'} />
        <ToggleRow k="Two-factor auth" value={twoFA} onValueChange={setTwoFA} />
        <ToggleRow k="Push notifications" value={push} onValueChange={setPush} last />
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 20, marginBottom: 6 }}>STORE SETTINGS</Text>
      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 }}>
        <InfoRow k="Storefront" v={organizerHandle ? `${organizerHandle}.zorapass.com` : 'ZoraPass storefront'} />
        <InfoRow k="Default currency" v="TZS" />
        <InfoRow k="Payout account" v="M-Pesa •••• 4471" onPress={editPayout} />
        <ToggleRow k="Allow resale (face +10%)" value={resale} onValueChange={setResale} last />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 6 }}>
        <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>DOOR STAFF</Text>
        <Pressable onPress={openAddStaff} hitSlop={10}>
          <Text style={{ color: z.ultraSoft, fontSize: 12, fontWeight: '800' }}>Add person</Text>
        </Pressable>
      </View>
      {staffError ? (
        <View style={{ borderColor: z.orange + '66', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10, backgroundColor: z.orange + '12' }}>
          <Text style={{ color: z.orangeSoft, fontSize: 12 }}>{staffError}</Text>
        </View>
      ) : null}
      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 }}>
        {scanners.length === 0 ? (
          <Text style={{ color: z.mut, fontSize: 13, paddingVertical: 16 }}>{refreshing ? 'Loading door staff…' : 'No door staff yet.'}</Text>
        ) : scanners.map((s, i) => {
          const active = s.status === 'active';
          return (
            <View key={s.id} style={{ paddingVertical: 14, borderBottomColor: z.line2, borderBottomWidth: i < scanners.length - 1 ? 1 : 0 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: z.bone, fontSize: 14, fontWeight: '800' }}>{s.name}</Text>
                  <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{eventName(s.eventScope)} · {s.role}{s.canSell ? ' · seller' : ''}</Text>
                  <Text style={{ color: active ? z.ultraSoft : z.red, fontSize: 13, fontWeight: '900', marginTop: 8 }}>Code {s.code}</Text>
                </View>
                <Text style={{ color: active ? z.green : z.red, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }}>{s.status.toUpperCase()}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Pressable onPress={() => rotateStaff(s)} disabled={!active} style={({ pressed }) => ({ flex: 1, borderColor: z.line, borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', opacity: !active ? 0.35 : pressed ? 0.7 : 1 })}>
                  <Text style={{ color: z.bone, fontSize: 12, fontWeight: '800' }}>Rotate code</Text>
                </Pressable>
                <Pressable onPress={() => revokeStaff(s)} disabled={!active} style={({ pressed }) => ({ flex: 1, borderColor: z.red + '66', borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', opacity: !active ? 0.35 : pressed ? 0.7 : 1 })}>
                  <Text style={{ color: z.red, fontSize: 12, fontWeight: '800' }}>Revoke</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 20, marginBottom: 10 }}>MODE</Text>
      <SwitchModeButton />

      <Pressable onPress={signOutNest} style={({ pressed }) => ({ marginTop: 16, padding: 16, borderRadius: 14, borderColor: z.line, borderWidth: 1, opacity: pressed ? 0.8 : 1 })}>
        <Text style={{ color: z.red, fontWeight: '700', textAlign: 'center' }}>Sign out</Text>
      </Pressable>

      <Modal visible={addingStaff} transparent animationType="fade" onRequestClose={() => setAddingStaff(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: z.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderColor: z.line, borderWidth: 1, paddingTop: 18, paddingHorizontal: 20, paddingBottom: insets.bottom + 18, maxHeight: '86%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <View>
                <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>NEW DOOR PERSON</Text>
                <Text style={{ color: z.bone, fontSize: 20, fontWeight: '800', marginTop: 4 }}>Create scanner code</Text>
              </View>
              <Pressable onPress={() => setAddingStaff(false)} hitSlop={12}>
                <Text style={{ color: z.mut, fontSize: 15, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput value={staffName} onChangeText={setStaffName} placeholder="Name" placeholderTextColor={z.mut2} style={{ backgroundColor: z.bg, borderColor: z.line, borderWidth: 1, borderRadius: 14, color: z.bone, padding: 13, marginBottom: 10 }} />
              <TextInput value={staffContact} onChangeText={setStaffContact} placeholder="Phone or email" placeholderTextColor={z.mut2} autoCapitalize="none" keyboardType="email-address" style={{ backgroundColor: z.bg, borderColor: z.line, borderWidth: 1, borderRadius: 14, color: z.bone, padding: 13, marginBottom: 14 }} />

              <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 }}>EVENT</Text>
              {events.map((ev) => {
                const on = staffEventId === ev.id;
                return (
                  <Pressable key={ev.id} onPress={() => setStaffEventId(ev.id)} style={({ pressed }) => ({ borderColor: on ? z.ultra + '99' : z.line, borderWidth: 1, borderRadius: 14, padding: 12, backgroundColor: on ? z.ultra + '16' : z.bg, marginBottom: 8, opacity: pressed ? 0.75 : 1 })}>
                    <Text style={{ color: z.bone, fontSize: 13, fontWeight: '800' }}>{ev.name}</Text>
                    <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{ev.dateLabel || ev.date || 'Date TBA'} · {ev.city || 'City TBA'}</Text>
                  </Pressable>
                );
              })}

              <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 8, marginBottom: 8 }}>ROLE</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                {(['agent', 'supervisor'] as const).map((role) => (
                  <Pressable key={role} onPress={() => setStaffRole(role)} style={({ pressed }) => ({ flex: 1, borderColor: staffRole === role ? z.ultra + '99' : z.line, borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center', backgroundColor: staffRole === role ? z.ultra + '16' : z.bg, opacity: pressed ? 0.75 : 1 })}>
                    <Text style={{ color: z.bone, fontSize: 12, fontWeight: '800' }}>{role === 'agent' ? 'Agent' : 'Supervisor'}</Text>
                  </Pressable>
                ))}
              </View>
              <ToggleRow k="Can sell at gate" value={staffCanSell} onValueChange={setStaffCanSell} last />
              <Pressable onPress={createStaff} disabled={creatingStaff} style={({ pressed }) => ({ marginTop: 16, backgroundColor: z.bone, borderRadius: 16, paddingVertical: 16, alignItems: 'center', opacity: creatingStaff ? 0.45 : pressed ? 0.75 : 1 })}>
                <Text style={{ color: z.bg, fontSize: 14, fontWeight: '900' }}>{creatingStaff ? 'Creating…' : 'Create door code'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
