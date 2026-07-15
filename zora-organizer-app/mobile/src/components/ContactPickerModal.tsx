// Robust, Expo-Go-friendly contact picker.
//  1. Requests permission with Contacts.requestPermissionsAsync().
//  2. If granted → loads device contacts with phone numbers (searchable list).
//  3. If denied, errors, or the environment has no contacts (common on emulators
//     / Expo Go) → falls back to a sample list + a manual "enter a number" form.
import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, TextInput, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import * as Contacts from 'expo-contacts';
import { useZ } from '../theme';

export interface PickedContact { id: string; name: string; phone: string }

const MOCK: PickedContact[] = [
  { id: 'm1', name: 'Zawadi Kessy', phone: '+255713220101' },
  { id: 'm2', name: 'John Peter', phone: '+255754900233' },
  { id: 'm3', name: 'Neema Said', phone: '+255719110878' },
  { id: 'm4', name: 'Baraka Lyimo', phone: '+255786540611' },
  { id: 'm5', name: 'Fatma Hassan', phone: '+255744210733' },
];

const norm = (p: string) => p.replace(/\s/g, '');
const initials = (n: string) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export default function ContactPickerModal({
  visible, onClose, onAdd, takenPhones,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (c: PickedContact) => void;
  takenPhones: string[];
}) {
  const z = useZ();
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [contacts, setContacts] = useState<PickedContact[]>([]);
  const [q, setQ] = useState('');
  const [manual, setManual] = useState(false);
  const [mName, setMName] = useState('');
  const [mPhone, setMPhone] = useState('');

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true); setUsingMock(false); setManual(false); setQ('');
    (async () => {
      try {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') { if (alive) { setUsingMock(true); setContacts(MOCK); } return; }
        const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers] });
        const list: PickedContact[] = (data ?? [])
          .filter((c) => c.phoneNumbers && c.phoneNumbers.length > 0)
          .map((c) => ({
            id: c.id ?? Math.random().toString(36),
            name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed',
            phone: norm(c.phoneNumbers![0].number ?? ''),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (alive) {
          if (list.length) setContacts(list);
          else { setUsingMock(true); setContacts(MOCK); }
        }
      } catch {
        if (alive) { setUsingMock(true); setContacts(MOCK); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [visible]);

  const filtered = contacts.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || norm(c.phone).includes(norm(q)));

  const addManual = () => {
    const phone = norm(mPhone);
    if (!mName.trim() || phone.length < 6) return;
    onAdd({ id: 'man-' + phone, name: mName.trim(), phone });
    setMName(''); setMPhone(''); setManual(false);
  };

  const styles = StyleSheet.create({
    input: { backgroundColor: z.panel2, borderColor: z.line, borderWidth: 1, borderRadius: 12, color: z.bone, padding: 13, marginBottom: 10 },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: z.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 26, maxHeight: '86%' }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: z.line, alignSelf: 'center', marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: z.bone, fontSize: 20, fontWeight: '900' }}>Invite crew</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={{ color: z.mut, fontWeight: '700' }}>Close</Text></Pressable>
          </View>

          {usingMock && (
            <View style={{ backgroundColor: 'rgba(233,168,59,0.14)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <Text style={{ color: z.amber, fontSize: 12, fontWeight: '600' }}>
                Showing sample contacts — allow contacts access, or add a number manually, to invite real friends.
              </Text>
            </View>
          )}

          {manual ? (
            <View>
              <TextInput value={mName} onChangeText={setMName} placeholder="Friend’s name" placeholderTextColor={z.mut2} style={styles.input} />
              <TextInput value={mPhone} onChangeText={setMPhone} placeholder="Phone (+255…)" placeholderTextColor={z.mut2} keyboardType="phone-pad" style={styles.input} />
              <Pressable onPress={addManual} style={{ backgroundColor: z.ultra, borderRadius: 12, padding: 14, marginTop: 4 }}>
                <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>Add to crew</Text>
              </Pressable>
              <Pressable onPress={() => setManual(false)} style={{ padding: 12 }}>
                <Text style={{ color: z.mut, textAlign: 'center' }}>Back to contacts</Text>
              </Pressable>
            </View>
          ) : loading ? (
            <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={z.ultra} /></View>
          ) : (
            <View>
              <TextInput value={q} onChangeText={setQ} placeholder="Search contacts…" placeholderTextColor={z.mut2} style={styles.input} />
              <FlatList
                data={filtered}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 340 }}
                ListEmptyComponent={<Text style={{ color: z.mut2, textAlign: 'center', padding: 20 }}>No contacts found.</Text>}
                renderItem={({ item: c }) => {
                  const taken = takenPhones.includes(norm(c.phone));
                  return (
                    <Pressable
                      disabled={taken}
                      onPress={() => onAdd(c)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: z.line2, borderBottomWidth: 1, opacity: taken ? 0.45 : 1 }}
                    >
                      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: z.panel2, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: z.bone, fontWeight: '700' }}>{initials(c.name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: z.bone, fontWeight: '600' }}>{c.name}</Text>
                        <Text style={{ color: z.mut2, fontSize: 12, marginTop: 2 }}>{c.phone}</Text>
                      </View>
                      <Text style={{ color: taken ? z.green : z.ultraSoft, fontWeight: '700' }}>{taken ? 'Added' : 'Add'}</Text>
                    </Pressable>
                  );
                }}
              />
              <Pressable onPress={() => setManual(true)} style={{ padding: 14, marginTop: 4 }}>
                <Text style={{ color: z.ultraSoft, textAlign: 'center', fontWeight: '700' }}>＋ Enter a number manually</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
