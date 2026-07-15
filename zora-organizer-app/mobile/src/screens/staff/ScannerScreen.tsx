// The staff-locked gate scanner — real QR camera via expo-camera's CameraView.
// Scanning any QR admits it (green); scanning the SAME code again is caught as a
// duplicate (red) — the offline dedupe idea, live. If camera permission is
// denied/unavailable, the view still works via the Simulate scan button.
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Vibration } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../session/store';
import { verifyTicket, clearAgentToken } from '../../lib/agent';
import { z } from '../../theme';

type Result = { ok: boolean; title: string; sub: string } | null;
const shorten = (s: string) => (s.length > 22 ? s.slice(0, 22) + '…' : s);
const SIM_SEQ = ['valid', 'valid', 'used', 'invalid'] as const;

export default function ScannerScreen() {
  const insets = useSafeAreaInsets();
  const signOut = useSession((s) => s.signOut);
  const [permission, requestPermission] = useCameraPermissions();

  const [result, setResult] = useState<Result>(null);
  const [head, setHead] = useState(842);
  const busy = useRef(false);
  const simIdx = useRef(0);

  // Ask for the camera once, the first time in.
  useEffect(() => {
    if (permission?.status === 'undetermined') requestPermission();
  }, [permission?.status]);

  const flash = (r: Result, ok: boolean) => {
    setResult(r);
    Vibration.vibrate(ok ? 30 : [0, 20, 40, 20]);
    setTimeout(() => { setResult(null); busy.current = false; }, 1700);
  };

  const onScan = async ({ data }: { data: string }) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await verifyTicket(data); // verified against the Gate with the scoped agent token
      if (r.ok) { setHead((h) => h + 1); flash({ ok: true, title: 'Valid', sub: shorten(r.ticket) }, true); }
      else flash({ ok: false, title: 'Already in', sub: shorten(r.ticket) + ' · scanned earlier' }, false);
    } catch (e: any) {
      if (e?.message === 'session_ended') { await clearAgentToken(); signOut(); return; } // token expired/revoked → back to code entry
      flash({ ok: false, title: 'Not valid', sub: 'Verification failed' }, false);
    }
  };

  const simulate = () => {
    if (busy.current) return;
    busy.current = true;
    const k = SIM_SEQ[simIdx.current++ % SIM_SEQ.length];
    if (k === 'valid') { setHead((h) => h + 1); flash({ ok: true, title: 'Valid', sub: 'Z001-' + (300 + Math.floor(Math.random() * 600)) }, true); }
    else if (k === 'used') flash({ ok: false, title: 'Already in', sub: 'Scanned 13:52 · Gate B' }, false);
    else flash({ ok: false, title: 'Not valid', sub: 'Signature failed' }, false);
  };

  const granted = !!permission?.granted;

  return (
    <View style={{ flex: 1, backgroundColor: z.bg, paddingTop: insets.top + 14, paddingHorizontal: 20, paddingBottom: insets.bottom + 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <View>
          <Text style={{ color: z.orangeSoft, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>GATE AGENT</Text>
          <Text style={{ color: z.mut, fontSize: 12, marginTop: 4 }}>GATE A · OFFSHORE</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,90,31,0.18)', borderRadius: 100, paddingHorizontal: 11, paddingVertical: 6 }}>
          <Text style={{ color: z.orangeSoft, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>LOCKED VIEW</Text>
        </View>
      </View>

      <View style={{ aspectRatio: 1, borderRadius: 26, borderColor: z.line, borderWidth: 1, backgroundColor: '#0d0803', overflow: 'hidden' }}>
        {granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={result ? undefined : onScan}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: z.bone, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>Camera access needed to scan tickets</Text>
            <Text style={{ color: z.mut2, fontSize: 12, textAlign: 'center', marginTop: 8 }}>Grant the camera, or use Simulate scan below to test the flow.</Text>
            <Pressable onPress={requestPermission} style={{ backgroundColor: z.orange, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 18 }}>
              <Text style={{ color: '#0A0A0B', fontWeight: '800' }}>Enable camera</Text>
            </Pressable>
          </View>
        )}

        {/* corner brackets */}
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <View
            key={c}
            style={{
              position: 'absolute', width: 46, height: 46, borderColor: z.orange, borderWidth: 3,
              ...(c[0] === 't' ? { top: 20, borderBottomWidth: 0 } : { bottom: 20, borderTopWidth: 0 }),
              ...(c[1] === 'l' ? { left: 20, borderRightWidth: 0, borderTopLeftRadius: c[0] === 't' ? 14 : 0, borderBottomLeftRadius: c[0] === 'b' ? 14 : 0 }
                              : { right: 20, borderLeftWidth: 0, borderTopRightRadius: c[0] === 't' ? 14 : 0, borderBottomRightRadius: c[0] === 'b' ? 14 : 0 }),
            }}
          />
        ))}

        {result && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: result.ok ? 'rgba(23,179,104,0.22)' : 'rgba(255,59,48,0.2)' }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 14, backgroundColor: result.ok ? z.green : z.red }}>
              <Text style={{ fontSize: 34, color: '#0A0A0B', fontWeight: '900' }}>{result.ok ? '✓' : '✕'}</Text>
            </View>
            <Text style={{ color: z.bone, fontSize: 26, fontWeight: '900' }}>{result.title}</Text>
            <Text style={{ color: z.bone, opacity: 0.85, marginTop: 6 }}>{result.sub}</Text>
          </View>
        )}
      </View>

      <View style={{ marginTop: 'auto' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingVertical: 14, borderTopColor: z.line, borderTopWidth: 1 }}>
          <Text style={{ color: z.mut2, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>THROUGH YOUR GATE</Text>
          <Text style={{ color: z.bone, fontSize: 38, fontWeight: '900' }}>{head.toLocaleString()}</Text>
        </View>
        <Pressable onPress={simulate} style={({ pressed }) => ({ backgroundColor: z.orange, borderRadius: 15, padding: 16, opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ color: '#0A0A0B', fontWeight: '800', textAlign: 'center', letterSpacing: 0.5 }}>SIMULATE SCAN</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <Text style={{ color: z.mut2, fontSize: 11 }}>Staff account — marketplace & dashboard locked</Text>
          <Pressable onPress={() => { clearAgentToken(); signOut(); }}><Text style={{ color: z.ultraSoft, fontWeight: '700', fontSize: 13 }}>Sign out</Text></Pressable>
        </View>
      </View>
    </View>
  );
}
