import { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useZ } from '../../theme';

interface Scan { id: string; gate: string; time: string; ok: boolean; res: string }
type Filter = 'all' | 'ok' | 'bad';
const GATES = ['GATE A · DEV 1', 'GATE A · DEV 2', 'GATE B · DEV 1', 'GATE C · DEV 1'];
const now = () => new Date().toTimeString().slice(0, 8);

function makeScan(): Scan {
  const bad = Math.random() < 0.16;
  return {
    id: 'Z001-' + (1000 + Math.floor(Math.random() * 8999)),
    gate: GATES[Math.floor(Math.random() * GATES.length)],
    time: now(), ok: !bad, res: bad ? (Math.random() < 0.6 ? 'DUPLICATE' : 'INVALID') : 'VALID',
  };
}

const CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All gates' },
  { key: 'ok', label: 'Valid' },
  { key: 'bad', label: 'Rejected' },
];

export default function AuditScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const [log, setLog] = useState<Scan[]>(() => Array.from({ length: 12 }, makeScan));
  const [stats, setStats] = useState({ valid: 1842, rej: 14 });
  const [filter, setFilter] = useState<Filter>('all');
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    // Real build subscribes to wss://gate.zora.app/events/:id/scans via useRealtime.
    timer.current = setInterval(() => {
      const s = makeScan();
      setLog((l) => [s, ...l].slice(0, 60));
      setStats((v) => ({ valid: v.valid + (s.ok ? 1 : 0), rej: v.rej + (s.ok ? 0 : 1) }));
    }, 1700);
    return () => clearInterval(timer.current);
  }, []);

  const shown = log.filter((e) => filter === 'all' || (filter === 'ok') === e.ok);

  return (
    <View style={{ flex: 1, backgroundColor: z.bg, paddingTop: insets.top + 8, paddingHorizontal: 20 }}>
      <Text style={{ color: z.bone, fontSize: 24, fontWeight: '900', marginBottom: 12 }}>Scan audit</Text>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <View style={{ flex: 1, backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, padding: 12 }}>
          <Text style={{ color: z.mut2, fontSize: 10, fontWeight: '700' }}>VALID</Text>
          <Text style={{ color: '#4fd699', fontSize: 24, fontWeight: '900', marginTop: 5 }}>{stats.valid.toLocaleString()}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, padding: 12 }}>
          <Text style={{ color: z.mut2, fontSize: 10, fontWeight: '700' }}>REJECTED</Text>
          <Text style={{ color: '#ff8b84', fontSize: 24, fontWeight: '900', marginTop: 5 }}>{stats.rej}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        {CHIPS.map((c) => {
          const on = filter === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => setFilter(c.key)}
              style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 100, borderColor: on ? z.bone : z.line, borderWidth: 1, backgroundColor: on ? z.bone : 'transparent' }}
            >
              <Text style={{ color: on ? z.bg : z.mut, fontWeight: '600', fontSize: 12 }}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(e, i) => e.id + i}
        renderItem={({ item: e }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: z.line2, borderBottomWidth: 1 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: e.ok ? z.green : z.red }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: z.bone, fontWeight: '700' }}>{e.id}</Text>
              <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{e.gate}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: e.ok ? '#4fd699' : '#ff8b84', fontSize: 10, fontWeight: '700' }}>{e.res}</Text>
              <Text style={{ color: z.mut2, fontSize: 10, marginTop: 3 }}>{e.time}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
