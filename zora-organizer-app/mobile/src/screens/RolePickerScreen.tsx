// Auth entry — Google + email/password (validation), a light/dark toggle, and the
// demo role selector. "Gate agent" routes to access-code entry (not a direct login).
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { useSession, type Role } from '../session/store';
import ZoraLogo from '../components/ZoraLogo';
import ZoraButton from '../components/ZoraButton';
import ThemeToggle from '../components/ThemeToggle';
import { signInEmail, signUpEmail, signInGoogle } from '../lib/auth';
import { supabaseReady } from '../lib/supabase';
import { useZ } from '../theme';

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

function GoogleG() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.2 17.7 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7C43.7 37.9 46.5 31.8 46.5 24.5z" />
      <Path fill="#FBBC05" d="M10.5 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.9-6.1C1 15.9 0 19.8 0 23.5s1 7.6 2.6 10.9l7.9-6.1z" />
      <Path fill="#34A853" d="M24 47c6.2 0 11.4-2 15.2-5.5l-7.3-5.7c-2 1.4-4.6 2.2-7.9 2.2-6.3 0-11.6-3.7-13.5-9.3l-7.9 6.1C6.5 42.6 14.6 47 24 47z" />
    </Svg>
  );
}

export default function RolePickerScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const signInAs = useSession((s) => s.signInAs);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const ROLES: { role: Role; name: string; desc: string; glyph: string; tint: string }[] = [
    { role: 'consumer', name: 'Fan · Consumer', desc: 'Discover, book tables, split with crew', glyph: '◎', tint: z.silver },
    { role: 'organizer', name: 'Organizer', desc: 'Dashboard, wallet, live-edit, settings', glyph: '▤', tint: z.brand.mid },
    { role: 'staff', name: 'Gate agent · Staff', desc: 'Enter an access code → scanner only', glyph: '◲', tint: z.orangeSoft },
  ];

  const submit = async () => {
    if (!emailOk(email)) return setErr('Enter a valid email address.');
    if (pw.length < 8) return setErr('Password must be at least 8 characters.');
    if (mode === 'signup' && pw !== pw2) return setErr('Passwords don’t match.');
    setErr('');

    // Demo fallback until Supabase keys are set — keeps the app usable offline.
    if (!supabaseReady) return signInAs('consumer');

    setBusy(true);
    try {
      const { data, error } = mode === 'signin' ? await signInEmail(email, pw) : await signUpEmail(email, pw);
      if (error) return setErr(error.message);
      // Sign-up with email confirmation on → no session yet.
      if (mode === 'signup' && !data.session) {
        setMode('signin');
        return setErr('Account created — check your email to confirm, then sign in.');
      }
      // Success: bindAuth()'s listener mirrors the profile role → RootNavigator routes.
    } catch (e: any) {
      setErr(e?.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setErr('');
    if (!supabaseReady) return signInAs('consumer'); // demo fallback
    setBusy(true);
    try {
      await signInGoogle(); // on success, onAuthStateChange routes via bindAuth()
    } catch (e: any) {
      setErr(e?.message ?? 'Google sign-in failed.');
    } finally {
      setBusy(false);
    }
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
        {mode === 'signin' ? 'Welcome back' : 'Create your account'}
      </Text>
      <Text style={{ color: z.mut, marginTop: 6, marginBottom: 18 }}>Your ticket is the product. The app is the only door.</Text>

      <View style={{ flexDirection: 'row', backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, padding: 4 }}>
        {(['signin', 'signup'] as const).map((m) => {
          const on = mode === m;
          return (
            <Pressable key={m} onPress={() => { setMode(m); setErr(''); }} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: on ? z.ultra : 'transparent' }}>
              <Text style={{ color: on ? '#fff' : z.mut, fontWeight: '700', fontSize: 13 }}>{m === 'signin' ? 'Sign in' : 'Sign up'}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={google} disabled={busy} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: z.bone, borderRadius: z.r, paddingVertical: 14, marginTop: 16, opacity: busy ? 0.5 : pressed ? 0.85 : 1 })}>
        <GoogleG />
        <Text style={{ color: z.bg, fontWeight: '700', fontSize: 14 }}>Continue with Google</Text>
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: z.line }} />
        <Text style={{ color: z.mut2, fontSize: 12 }}>or</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: z.line }} />
      </View>

      <Text style={label}>Email</Text>
      <TextInput value={email} onChangeText={setEmail} placeholder="you@email.com" placeholderTextColor={z.mut2} autoCapitalize="none" keyboardType="email-address" autoComplete="email" style={input} />
      <Text style={label}>Password</Text>
      <TextInput value={pw} onChangeText={setPw} placeholder="At least 8 characters" placeholderTextColor={z.mut2} secureTextEntry autoCapitalize="none" style={input} />
      {mode === 'signup' && (
        <>
          <Text style={label}>Confirm password</Text>
          <TextInput value={pw2} onChangeText={setPw2} placeholder="Re-enter password" placeholderTextColor={z.mut2} secureTextEntry autoCapitalize="none" style={input} />
        </>
      )}
      {err ? <Text style={{ color: '#ff8b84', fontSize: 12, marginTop: 4 }}>{err}</Text> : null}

      <ZoraButton variant="gradient" disabled={busy} label={busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} style={{ marginTop: 16 }} />

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
