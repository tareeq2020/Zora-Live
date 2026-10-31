// Auth entry for the one mobile app. Organizer login uses the Nest API; attendees
// enter the app and verify ticket ownership by phone OTP inside the ticket wallet.
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useSession, type Role } from '../session/store';
import ZoraLogo from '../components/ZoraLogo';
import ZoraButton from '../components/ZoraButton';
import ThemeToggle from '../components/ThemeToggle';
import { signInOrganizer } from '../lib/auth';
import { trackProductEvent } from '../lib/productAnalytics';
import { useZ } from '../theme';

export default function RolePickerScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const signInAs = useSession((s) => s.signInAs);
  const [accountType, setAccountType] = useState<'organizer' | 'attendee'>('organizer');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const ROLES: { role: Role; name: string; desc: string; glyph: string; tint: string }[] = [
    { role: 'consumer', name: 'Fan · Consumer', desc: 'Discover, book tables, split with crew', glyph: '◎', tint: z.silver },
    { role: 'organizer', name: 'Organizer', desc: 'Dashboard, wallet, live-edit, settings', glyph: '▤', tint: z.brand.mid },
    { role: 'staff', name: 'Gate agent · Staff', desc: 'Enter an access code → scanner only', glyph: '◲', tint: z.orangeSoft },
  ];

  const submit = async () => {
    if (accountType === 'organizer') {
      if (!email.trim()) return setErr('Enter your organizer email or handle.');
      if (pw.length < 8) return setErr('Password must be at least 8 characters.');
      setErr('');
      setBusy(true);
      try {
        await signInOrganizer(email, pw);
        trackProductEvent('mobile_organizer_login_succeeded', { role: 'organizer' });
      } catch (e: any) {
        trackProductEvent('mobile_organizer_login_failed', { role: 'organizer', errorType: 'auth_failed' });
        setErr(e?.message ?? 'Could not sign in. Check your organizer credentials.');
      } finally {
        setBusy(false);
      }
      return;
    }

    setErr('');
    trackProductEvent('mobile_attendee_entry_opened', { role: 'consumer', source: 'auth' });
    signInAs('consumer');
  };

  const onRole = (role: Role) => (role === 'staff' ? nav.navigate('AgentCode') : signInAs(role));

  const label = { color: z.mut2, fontSize: 11, fontWeight: '700' as const, letterSpacing: 1, marginBottom: 7, marginTop: 4 };
  const input = { backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 12, color: z.bone, fontSize: 15, padding: 14, marginBottom: 12 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 26, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <ZoraLogo variant="full" size={72} />
          <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 6, marginTop: 14 }}>ONE APP</Text>
        </View>
        <ThemeToggle />
      </View>

      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginTop: 24 }}>
        {accountType === 'organizer' ? 'Organizer sign in' : 'Attendee access'}
      </Text>
      <Text style={{ color: z.mut, marginTop: 6, marginBottom: 18 }}>
        {accountType === 'organizer' ? 'Manage events, scan tickets, and track sales from the ZoraPass API.' : 'Open your ticket wallet, then verify with the phone number used at checkout.'}
      </Text>

      <View style={{ flexDirection: 'row', backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, padding: 4 }}>
        {(['organizer', 'attendee'] as const).map((m) => {
          const on = accountType === m;
          return (
            <Pressable key={m} onPress={() => { setAccountType(m); setErr(''); }} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: on ? z.ultra : 'transparent' }}>
              <Text style={{ color: on ? '#fff' : z.mut, fontWeight: '700', fontSize: 13 }}>{m === 'organizer' ? 'Organizer' : 'Attendee'}</Text>
            </Pressable>
          );
        })}
      </View>

      {accountType === 'organizer' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: z.line }} />
            <Text style={{ color: z.mut2, fontSize: 12 }}>API LOGIN</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: z.line }} />
          </View>

          <Text style={label}>Email or handle</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="your-handle or you@email.com" placeholderTextColor={z.mut2} autoCapitalize="none" autoComplete="email" style={input} />
          <Text style={label}>Password</Text>
          <TextInput value={pw} onChangeText={setPw} placeholder="At least 8 characters" placeholderTextColor={z.mut2} secureTextEntry autoCapitalize="none" style={input} />
        </>
      ) : null}
      {err ? <Text style={{ color: '#ff8b84', fontSize: 12, marginTop: 4 }}>{err}</Text> : null}

      <ZoraButton variant="gradient" disabled={busy} label={busy ? 'Please wait...' : accountType === 'organizer' ? 'Open organizer dashboard' : 'Open ticket wallet'} onPress={submit} style={{ marginTop: 16 }} />

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 30, marginBottom: 10 }}>OR CONTINUE AS (DEMO)</Text>
      {ROLES.map((r) => (
        <Pressable key={r.role} onPress={() => onRole(r.role)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 10, opacity: pressed ? 0.8 : 1 })}>
          <View style={{ width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: r.tint + '22' }}>
            <Text style={{ color: r.tint, fontSize: 18 }}>{r.glyph}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: z.bone, fontWeight: '700', fontSize: 14 }}>{r.name}</Text>
            <Text style={{ color: z.mut2, fontSize: 12, marginTop: 3 }}>{r.desc}</Text>
          </View>
          <Text style={{ color: z.mut2 }}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
