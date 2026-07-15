import { Pressable, Text } from 'react-native';
import { useSession } from '../session/store';
import { useZ } from '../theme';

// The Airbnb-style role toggle. Never rendered for staff (they are hard-locked).
export default function SwitchModeButton() {
  const z = useZ();
  const role = useSession((s) => s.role);
  const activeMode = useSession((s) => s.activeMode);
  const toggleMode = useSession((s) => s.toggleMode);
  if (role === 'staff') return null;

  const toOrganizer = activeMode === 'consumer';
  return (
    <Pressable
      onPress={toggleMode}
      style={({ pressed }) => ({
        backgroundColor: z.panel2,
        borderColor: z.ultra + '55', borderWidth: 1, borderRadius: 20, padding: 18,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ color: z.ultraSoft, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>ROLE</Text>
      <Text style={{ color: z.bone, fontSize: 19, fontWeight: '800', marginTop: 8 }}>
        {toOrganizer ? 'Switch to Organizer mode' : 'Switch to Consumer mode'}
      </Text>
      <Text style={{ color: z.mut, marginTop: 6 }}>
        {toOrganizer ? 'Your dashboards, wallet & live-edit — one tap.' : 'Browse and book events as a fan.'}
      </Text>
    </Pressable>
  );
}
