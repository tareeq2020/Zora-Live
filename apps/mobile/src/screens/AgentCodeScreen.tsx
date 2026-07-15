// Gate-agent access-code entry. The agent types the short code the Admin issued;
// on success we store the scoped JWT and lock into the scanner (staff role).
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import ZoraLogo from '../components/ZoraLogo';
import ZoraButton from '../components/ZoraButton';
import { useSession } from '../session/store';
import { redeemCode } from '../lib/agent';
import { useZ } from '../theme';

const ERR: Record<string, string> = {
  invalid_code: 'That code isn’t valid.',
  expired: 'This code has expired.',
  revoked: 'This code was revoked by the organizer.',
  already_used: 'This code has already been used.',
  device_mismatch: 'This code is bound to another device.',
  rate_limited: 'Too many attempts — wait a minute and try again.',
};

export default function AgentCodeScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const signInAs = useSession((s) => s.signInAs);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const clean = code.replace(/[^A-Za-z0-9]/g, '');
    if (clean.length < 6) { setErr('Enter the full access code.'); return; }
    setErr('');
    setBusy(true);
    try {
      await redeemCode(code, 'ios-demo-device'); // prod: a stable per-install id
      signInAs('staff'); // RootNavigator locks to the scanner
    } catch (e: any) {
      setErr(ERR[e?.message] || 'Couldn’t verify the code. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 20, paddingHorizontal: 26, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => nav.goBack()} hitSlop={12}>
        <Text style={{ color: z.mut, fontSize: 14, fontWeight: '600', paddingVertical: 8 }}>‹ Back</Text>
      </Pressable>

      <View style={{ alignItems: 'center', marginTop: 20, marginBottom: 8 }}>
        <ZoraLogo variant="emblem" size={64} />
      </View>
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, textAlign: 'center', marginTop: 16 }}>Gate access</Text>
      <Text style={{ color: z.mut, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
        Enter the access code your event admin gave you. It signs you into the check-in scanner only.
      </Text>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 28, marginBottom: 8 }}>ACCESS CODE</Text>
      <TextInput
        value={code}
        onChangeText={(t) => { setCode(t.toUpperCase()); if (err) setErr(''); }}
        placeholder="XXXX-XXXX"
        placeholderTextColor={z.mut2}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={12}
        style={{ backgroundColor: z.panel, borderColor: err ? z.red : z.line, borderWidth: 1, borderRadius: 14, color: z.bone, fontSize: 26, fontFamily: z.monoBold, letterSpacing: 6, textAlign: 'center', paddingVertical: 18 }}
      />
      {err ? <Text style={{ color: '#ff8b84', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{err}</Text> : null}

      <ZoraButton variant="gradient" label={busy ? 'Verifying…' : 'Enter'} onPress={submit} disabled={busy} style={{ marginTop: 20 }} />

      <Text style={{ color: z.mut2, fontSize: 12, textAlign: 'center', marginTop: 22, lineHeight: 18 }}>
        Codes are issued only by the Zora admin — never shared publicly. They expire after the shift and can be revoked at any time.
      </Text>
    </ScrollView>
  );
}
