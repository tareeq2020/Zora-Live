// Digital ticket stub — a high-end pass with the emblem as a faint security
// watermark behind the QR, plus a perforated stub cut.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import ZoraLogo from '../../components/ZoraLogo';
import { useZ } from '../../theme';

interface Pass { n: string; d: string; tier: string; seat: string; holder: string; code: string }

function Field({ k, v }: { k: string; v: string }) {
  const z = useZ();
  return (
    <View>
      <Text style={{ color: z.mut2, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>{k}</Text>
      <Text style={{ color: z.bone, fontSize: 14, fontWeight: '600', marginTop: 4 }}>{v}</Text>
    </View>
  );
}

export default function TicketDetailScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const t: Pass = route.params?.pass ?? { n: 'OFFSHORE', d: 'Sat 25 Jul · 14:00', tier: 'Cabana', seat: 'Table T3', holder: 'Tareeq', code: 'Z001-0417' };
  const qrValue = `zora://t/${t.code}`;

  return (
    <View style={{ flex: 1, backgroundColor: z.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 40 }}>
        <Pressable onPress={() => nav.goBack()} hitSlop={12}>
          <Text style={{ color: z.mut, fontSize: 14, fontWeight: '600', paddingVertical: 8 }}>‹ Tickets</Text>
        </Pressable>

        <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: z.rLg, marginTop: 8, position: 'relative' }}>
          {/* emblem watermark, clipped to the card */}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: z.rLg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', opacity: 0.06 }}>
            <ZoraLogo variant="emblem" size={340} />
          </View>

          {/* header */}
          <View style={{ padding: 22 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>DIGITAL PASS</Text>
                <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp, marginTop: 6 }}>{t.n}</Text>
                <Text style={{ color: z.mut, fontSize: 13, marginTop: 4 }}>{t.d}</Text>
              </View>
              <ZoraLogo variant="emblem" size={34} />
            </View>
            <View style={{ flexDirection: 'row', gap: 26, marginTop: 20 }}>
              <Field k="TIER" v={t.tier} />
              <Field k="SEAT" v={t.seat} />
              <Field k="HOLDER" v={t.holder} />
            </View>
          </View>

          {/* perforation */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: z.bg, marginLeft: -12 }} />
            <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden', height: 1, marginHorizontal: 4 }}>
              {Array.from({ length: 40 }).map((_, i) => (
                <View key={i} style={{ width: 6, height: 1, backgroundColor: z.line, marginRight: 5 }} />
              ))}
            </View>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: z.bg, marginRight: -12 }} />
          </View>

          {/* QR */}
          <View style={{ alignItems: 'center', padding: 24 }}>
            <View style={{ backgroundColor: '#FFFFFF', padding: 16, borderRadius: 18 }}>
              <QRCode value={qrValue} size={184} color="#0A0A0B" backgroundColor="#FFFFFF" ecl="M" />
            </View>
            <Text style={{ color: z.silver, fontFamily: z.mono, fontSize: 13, marginTop: 16, letterSpacing: 1 }}>{t.code}</Text>
            <Text style={{ color: z.mut2, fontSize: 11, marginTop: 8, textAlign: 'center' }}>Scanned once at the gate · the app is the only door</Text>
          </View>
        </View>

        <Text style={{ color: z.mut2, fontSize: 12, textAlign: 'center', marginTop: 18 }}>Screenshotting won't work — the gate verifies this pass live.</Text>
      </ScrollView>
    </View>
  );
}
