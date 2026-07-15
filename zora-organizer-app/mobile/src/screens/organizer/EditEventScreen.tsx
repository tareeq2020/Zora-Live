// Live-edit the active event: capacity + tier pricing. "Save & publish" writes
// to the shared event store, so the Dashboard reflects it immediately.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useEventStore, type Tier } from '../../store/eventStore';
import { publishEvent } from '../../api/gate';
import ZoraButton from '../../components/ZoraButton';
import { useZ } from '../../theme';

function StepButton({ label, onPress }: { label: string; onPress: () => void }) {
  const z = useZ();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, borderColor: z.line, borderWidth: 1, backgroundColor: z.panel2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: z.bone, fontSize: 20, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export default function EditEventScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const event = useEventStore((s) => s.event);
  const applyEdit = useEventStore((s) => s.applyEdit);

  const [cap, setCap] = useState(event.cap);
  const [tiers, setTiers] = useState<Tier[]>(event.tiers.map((t) => ({ ...t })));
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const bumpCap = (d: number) => { setCap((c) => Math.max(0, c + d)); setDirty(true); };
  const bumpPrice = (i: number, d: number) => {
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, price: Math.max(0, t.price + d) } : t)));
    setDirty(true);
  };

  const publish = async () => {
    applyEdit({ cap, tiers }); // optimistic local update
    setDirty(false);
    setPublishing(true);
    try {
      const r = await publishEvent('offshore', { cap, tiers: tiers.map((t) => ({ name: t.name, price: t.price })) });
      Alert.alert('Published live', `On the Gate backend · v${r.version} · ${r.clients} device(s) notified.\nStorefront, apps and the door are updated.`, [
        { text: 'Done', onPress: () => nav.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Saved on this device', `Changes are applied locally and will sync when the Gate is reachable.\n\n(${e?.message ?? e})`, [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: z.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 120 }}>
        <Pressable onPress={() => nav.goBack()} hitSlop={12}>
          <Text style={{ color: z.mut, fontSize: 14, fontWeight: '600', paddingVertical: 8 }}>‹ Back to dashboard</Text>
        </Pressable>
        <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>LIVE EDIT</Text>
        <Text style={{ color: z.bone, fontSize: 28, fontFamily: z.disp, marginTop: 4 }}>{event.name}</Text>
        <Text style={{ color: z.mut, marginTop: 6, marginBottom: 6 }}>Changes publish the instant you save — storefront, apps and the door.</Text>

        <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 18, marginBottom: 10 }}>DOOR CAPACITY</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 16, padding: 14 }}>
          <Text style={{ color: z.bone, fontSize: 30, fontWeight: '900' }}>{cap.toLocaleString()}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StepButton label="−" onPress={() => bumpCap(-100)} />
            <StepButton label="+" onPress={() => bumpCap(100)} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {[100, 250, 500].map((n) => (
            <Pressable key={n} onPress={() => bumpCap(n)} style={({ pressed }) => ({ flex: 1, paddingVertical: 11, borderRadius: 12, borderColor: z.line, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: z.ultraSoft, fontWeight: '700', fontSize: 13 }}>+{n}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: z.mut2, fontSize: 12, marginTop: 9 }}>Venue opened up more room? Bump it live — new tickets hit the storefront instantly.</Text>

        <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22, marginBottom: 10 }}>TIER PRICING</Text>
        <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 }}>
          {tiers.map((t, i) => {
            const changed = t.price !== event.tiers[i]?.price;
            return (
              <View key={t.name} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomColor: z.line2, borderBottomWidth: i < tiers.length - 1 ? 1 : 0 }}>
                <View>
                  <Text style={{ color: z.bone, fontWeight: '600', fontSize: 14 }}>{t.name}</Text>
                  {changed ? <Text style={{ color: z.amber, fontSize: 11, marginTop: 3 }}>was TZS {event.tiers[i].price.toLocaleString()}</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <StepButton label="−" onPress={() => bumpPrice(i, -5000)} />
                  <Text style={{ color: z.bone, fontWeight: '700', minWidth: 84, textAlign: 'right' }}>{t.price.toLocaleString()}</Text>
                  <StepButton label="+" onPress={() => bumpPrice(i, 5000)} />
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16 }}>
        {dirty ? <Text style={{ color: z.amber, textAlign: 'center', marginBottom: 10, fontSize: 12, fontWeight: '600' }}>Unsaved changes</Text> : null}
        <ZoraButton
          variant="gradient"
          onPress={publish}
          disabled={!dirty || publishing}
          label={publishing ? 'Publishing…' : 'Save & publish changes'}
        />
      </View>
    </View>
  );
}
