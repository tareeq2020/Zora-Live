import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwitchModeButton from '../../components/SwitchModeButton';
import ThemeToggle from '../../components/ThemeToggle';
import { useSession } from '../../session/store';
import { useZ } from '../../theme';

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
  const signOut = useSession((s) => s.signOut);
  const verified = useSession((s) => s.verified);
  const kycPending = useSession((s) => s.kycPending);
  const [twoFA, setTwoFA] = useState(true);
  const [push, setPush] = useState(true);
  const [resale, setResale] = useState(true);

  const editPayout = () => Alert.alert('Payout account', 'Change where payouts land (M-Pesa, Tigo, Airtel or bank) on the Zora web dashboard.', [{ text: 'OK' }]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp }}>Settings</Text>
        <ThemeToggle />
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 6 }}>ACCOUNT</Text>
      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 }}>
        <InfoRow k="Name" v="Tareeq Twaha" />
        <InfoRow k="Email" v="tareeqtwaha@gmail.com" />
        <InfoRow k="Identity (KYC)" v={verified ? 'Verified' : kycPending ? 'Under review' : 'Not verified'} />
        <ToggleRow k="Two-factor auth" value={twoFA} onValueChange={setTwoFA} />
        <ToggleRow k="Push notifications" value={push} onValueChange={setPush} last />
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 20, marginBottom: 6 }}>STORE SETTINGS</Text>
      <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 }}>
        <InfoRow k="Storefront" v="offshore.zora.app" />
        <InfoRow k="Default currency" v="TZS" />
        <InfoRow k="Payout account" v="M-Pesa •••• 4471" onPress={editPayout} />
        <ToggleRow k="Allow resale (face +10%)" value={resale} onValueChange={setResale} last />
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 20, marginBottom: 10 }}>MODE</Text>
      <SwitchModeButton />

      <Pressable onPress={signOut} style={({ pressed }) => ({ marginTop: 16, padding: 16, borderRadius: 14, borderColor: z.line, borderWidth: 1, opacity: pressed ? 0.8 : 1 })}>
        <Text style={{ color: z.red, fontWeight: '700', textAlign: 'center' }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
