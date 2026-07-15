// KYC identity capture — photographs the organizer's ID with the camera and
// uploads it to the real Phase 1 pipeline (zora-site /api/kyc/*). No fake
// approval: the wallet stays locked until an admin approves in the web console.
import { useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Image, Modal, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import ZoraButton from '../../components/ZoraButton';
import SegmentedControl from '../../components/SegmentedControl';
import { useSession } from '../../session/store';
import { uploadDoc, submitKyc, type IdType, type KycDoc } from '../../api/kyc';
import type { WalletStackParams } from '../../navigation/OrganizerTabs';
import { useZ } from '../../theme';

const COUNTRIES = ['Tanzania', 'Kenya', 'Uganda', 'Ghana', 'Nigeria'];
const ID_OPTIONS = [
  { key: 'passport', label: 'Passport' },
  { key: 'drivers_license', label: 'License' },
  { key: 'national_id', label: 'National ID' },
];
const SIDES: Record<IdType, { k: string; label: string }[]> = {
  passport: [{ k: 'photo_page', label: 'Passport photo page' }],
  drivers_license: [{ k: 'front', label: 'Front of license' }, { k: 'back', label: 'Back of license' }],
  national_id: [{ k: 'front', label: 'Front of ID' }, { k: 'back', label: 'Back of ID' }],
};

interface Shot { uri: string; base64: string }

export default function KycVerifyScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<WalletStackParams>>();
  const beginKyc = useSession((s) => s.beginKyc);

  const [country, setCountry] = useState('Tanzania');
  const [idType, setIdType] = useState<IdType>('passport');
  const [fullName, setFullName] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [consent, setConsent] = useState(false);
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const [capturing, setCapturing] = useState<string | null>(null); // which side's camera is open
  const [submitting, setSubmitting] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);

  const sides = SIDES[idType];
  const allCaptured = sides.every((s) => shots[s.k]);
  const canSubmit = allCaptured && fullName.trim().length > 1 && !!country && consent && !submitting;

  const pickType = (k: string) => { setIdType(k as IdType); setShots({}); }; // sides differ per type

  const openCamera = async (side: string) => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { Alert.alert('Camera needed', 'Allow camera access to photograph your ID.'); return; }
    }
    setCapturing(side);
  };

  const capture = async () => {
    const side = capturing; if (!side) return;
    const photo = await camRef.current?.takePictureAsync({ base64: true, quality: 0.5 });
    if (photo?.base64) setShots((s) => ({ ...s, [side]: { uri: photo.uri, base64: photo.base64 as string } }));
    setCapturing(null);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const documents: KycDoc[] = [];
      for (const s of sides) documents.push(await uploadDoc(shots[s.k].base64, s.k)); // upload each → docId
      const res = await submitKyc({ idType, country, fullName: fullName.trim(), docNumber: docNumber.trim() || undefined, documents });
      beginKyc(res.ref); // wallet now polls this ref until an admin approves
      Alert.alert('Submitted for review', 'Your ID is under review — usually within 24 hours. Payouts unlock the moment it clears.');
      nav.goBack();
    } catch (e) {
      Alert.alert('Could not submit', (e as Error).message + '\n\nMake sure the Zora server is reachable (set EXPO_PUBLIC_KYC_URL to your PC on port 4100).');
    } finally {
      setSubmitting(false);
    }
  };

  const label = { color: z.mut2, fontSize: 11, fontWeight: '700' as const, letterSpacing: 1, marginTop: 20, marginBottom: 8 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: z.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 40 }}>
      <Text style={{ color: z.bone, fontSize: 26, fontFamily: z.disp }}>Verify your identity</Text>
      <Text style={{ color: z.mut, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
        A one-time check before we send you money. Your documents are encrypted and seen only by our verification team — never shown publicly.
      </Text>

      <Text style={label}>ISSUING COUNTRY</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {COUNTRIES.map((c) => {
          const on = c === country;
          return (
            <Pressable key={c} onPress={() => setCountry(c)} style={{ paddingHorizontal: 15, paddingVertical: 10, borderRadius: 100, borderWidth: 1, borderColor: on ? z.ultra : z.line, backgroundColor: on ? 'rgba(61,90,254,0.12)' : z.panel }}>
              <Text style={{ color: on ? z.ultraSoft : z.mut, fontWeight: '600', fontSize: 13 }}>{c}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={label}>DOCUMENT TYPE</Text>
      <SegmentedControl options={ID_OPTIONS} value={idType} onChange={pickType} />

      <Text style={label}>FULL NAME (AS ON THE DOCUMENT)</Text>
      <TextInput value={fullName} onChangeText={setFullName} placeholder="e.g. Amina Juma Hassan" placeholderTextColor={z.mut}
        style={{ backgroundColor: z.panel2, borderColor: z.line, borderWidth: 1, borderRadius: 12, color: z.bone, fontSize: 16, padding: 14 }} />

      <Text style={label}>DOCUMENT NUMBER (OPTIONAL)</Text>
      <TextInput value={docNumber} onChangeText={setDocNumber} placeholder="Speeds up review — stored masked" placeholderTextColor={z.mut} autoCapitalize="characters"
        style={{ backgroundColor: z.panel2, borderColor: z.line, borderWidth: 1, borderRadius: 12, color: z.bone, fontSize: 16, padding: 14 }} />

      <Text style={label}>PHOTOGRAPH YOUR DOCUMENT</Text>
      {sides.map((s) => {
        const shot = shots[s.k];
        return (
          <View key={s.k} style={{ backgroundColor: z.panel, borderColor: shot ? z.green : z.line, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {shot
                ? <Image source={{ uri: shot.uri }} style={{ width: 64, height: 44, borderRadius: 8, backgroundColor: '#000' }} />
                : <View style={{ width: 64, height: 44, borderRadius: 8, backgroundColor: z.panel2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: z.mut2, fontSize: 20 }}>+</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={{ color: z.bone, fontWeight: '600' }}>{s.label}</Text>
                <Text style={{ color: shot ? z.green : z.mut2, fontSize: 12, marginTop: 2 }}>{shot ? 'Captured' : 'Not captured yet'}</Text>
              </View>
              <Pressable onPress={() => openCamera(s.k)} style={{ borderColor: z.line, borderWidth: 1, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 9 }}>
                <Text style={{ color: z.ultraSoft, fontWeight: '700', fontSize: 12 }}>{shot ? 'Retake' : 'Capture'}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Pressable onPress={() => setConsent((c) => !c)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8 }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: consent ? z.ultra : z.line, backgroundColor: consent ? z.ultra : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
          {consent ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>✓</Text> : null}
        </View>
        <Text style={{ color: z.mut, flex: 1, fontSize: 12.5, lineHeight: 18 }}>
          I confirm this is my own valid government ID, and I agree to Zora verifying my identity using it.
        </Text>
      </Pressable>

      <ZoraButton variant="gradient" disabled={!canSubmit} label={submitting ? 'Submitting…' : 'Submit for verification'} onPress={submit} style={{ marginTop: 20 }} />
      <Text style={{ color: z.mut2, textAlign: 'center', fontSize: 11, marginTop: 12 }}>Encrypted in transit and at rest.</Text>

      {/* Full-screen camera */}
      <Modal visible={capturing !== null} animationType="slide" onRequestClose={() => setCapturing(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {permission?.granted ? (
            <CameraView ref={camRef} style={{ flex: 1 }} facing="back" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text style={{ color: '#fff', textAlign: 'center' }}>Camera access is needed to photograph your ID.</Text>
            </View>
          )}
          <View style={{ position: 'absolute', bottom: insets.bottom + 30, left: 0, right: 0, alignItems: 'center', gap: 18 }}>
            <Text style={{ color: '#fff', fontSize: 13, opacity: 0.85 }}>Fit the whole document in frame · avoid glare</Text>
            <Pressable onPress={capture} disabled={!permission?.granted} style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.25)' }} />
            <Pressable onPress={() => setCapturing(null)}><Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

      {submitting && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={z.ultraSoft} size="large" />
        </View>
      )}
    </ScrollView>
  );
}
