// The root gate. One NavigationContainer; a native-stack whose screen set changes
// with (role, activeMode). Staff never gets consumer/organizer screens registered.
import { NavigationContainer, DefaultTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSession } from '../session/store';
import { useZ } from '../theme';
import ConsumerTabs from './ConsumerTabs';
import OrganizerTabs from './OrganizerTabs';
import AuthNavigator from './AuthNavigator';
import ScannerScreen from '../screens/staff/ScannerScreen';
import { trackProductEvent } from '../lib/productAnalytics';

const Root = createNativeStackNavigator();

export default function RootNavigator() {
  const z = useZ();
  const role = useSession((s) => s.role);
  const activeMode = useSession((s) => s.activeMode);

  const navTheme: Theme = {
    ...DefaultTheme,
    dark: z.bg === '#0A0A0B',
    colors: {
      ...DefaultTheme.colors,
      background: z.bg, card: z.bg, text: z.bone, border: z.line, primary: z.ultra, notification: z.orange,
    },
  };

  return (
    <NavigationContainer
      theme={navTheme}
      onStateChange={(state) => {
        const route = state?.routes[state.index || 0];
        if (route?.name) trackProductEvent('mobile_screen_viewed', { screen: route.name, role: role || 'anonymous' });
      }}
    >
      <Root.Navigator screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: z.bg } }}>
        {role == null ? (
          <Root.Screen name="Auth" component={AuthNavigator} />
        ) : role === 'staff' ? (
          <Root.Screen name="Scanner" component={ScannerScreen} />
        ) : activeMode === 'organizer' ? (
          <Root.Screen name="Organizer" component={OrganizerTabs} />
        ) : (
          <Root.Screen name="Consumer" component={ConsumerTabs} />
        )}
      </Root.Navigator>
    </NavigationContainer>
  );
}
