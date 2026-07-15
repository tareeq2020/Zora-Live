import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwitchModeButton from '../../components/SwitchModeButton';
import ThemeToggle from '../../components/ThemeToggle';
import { useSession } from '../../session/store';
import { useZ } from '../../theme';

export default function ProfileScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const signOut = useSession((s) => s.signOut);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp }}>Profile</Text>
        <ThemeToggle />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: z.ultra, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>T</Text>
        </View>
        <View>
          <Text style={{ color: z.bone, fontSize: 22, fontWeight: '800' }}>Tareeq</Text>
          <Text style={{ color: z.mut2, fontSize: 12, marginTop: 5 }}>+255 712 345 678 · member since 2025</Text>
        </View>
      </View>

      <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 10 }}>RUN EVENTS?</Text>
      <SwitchModeButton />

      <Pressable onPress={signOut} style={{ marginTop: 20, padding: 16, borderRadius: 14, borderColor: z.line, borderWidth: 1 }}>
        <Text style={{ color: z.red, fontWeight: '700', textAlign: 'center' }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
