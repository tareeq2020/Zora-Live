import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { tabScreenOptions } from './tabOptions';
import Icon from '../components/Icon';
import { useZ } from '../theme';
import DashboardScreen from '../screens/organizer/DashboardScreen';
import EditEventScreen from '../screens/organizer/EditEventScreen';
import WalletScreen from '../screens/organizer/WalletScreen';
import KycVerifyScreen from '../screens/organizer/KycVerifyScreen';
import PeopleScreen from '../screens/organizer/PeopleScreen';
import AuditScreen from '../screens/organizer/AuditScreen';
import SettingsScreen from '../screens/organizer/SettingsScreen';

const DashStack = createNativeStackNavigator();
function DashboardStackNavigator() {
  const z = useZ();
  return (
    <DashStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: z.bg } }}>
      <DashStack.Screen name="DashboardHome" component={DashboardScreen} />
      <DashStack.Screen name="EditEvent" component={EditEventScreen} options={{ animation: 'slide_from_bottom' }} />
    </DashStack.Navigator>
  );
}

// Wallet is a stack so the "Verify" CTA can push the KYC capture screen.
export type WalletStackParams = { WalletHome: undefined; KycVerify: undefined };
const WalletStack = createNativeStackNavigator<WalletStackParams>();
function WalletStackNavigator() {
  const z = useZ();
  return (
    <WalletStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: z.bg } }}>
      <WalletStack.Screen name="WalletHome" component={WalletScreen} />
      <WalletStack.Screen name="KycVerify" component={KycVerifyScreen} options={{ animation: 'slide_from_bottom' }} />
    </WalletStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();
export default function OrganizerTabs() {
  const z = useZ();
  return (
    <Tab.Navigator screenOptions={tabScreenOptions(z, z.ultra)}>
      <Tab.Screen name="Dashboard" component={DashboardStackNavigator} options={{ tabBarIcon: ({ color }) => <Icon name="grid" color={color} /> }} />
      <Tab.Screen name="Wallet" component={WalletStackNavigator} options={{ tabBarIcon: ({ color }) => <Icon name="wallet" color={color} /> }} />
      <Tab.Screen name="People" component={PeopleScreen} options={{ tabBarIcon: ({ color }) => <Icon name="people" color={color} /> }} />
      <Tab.Screen name="Audit" component={AuditScreen} options={{ tabBarIcon: ({ color }) => <Icon name="shield" color={color} /> }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: ({ color }) => <Icon name="gear" color={color} /> }} />
    </Tab.Navigator>
  );
}
