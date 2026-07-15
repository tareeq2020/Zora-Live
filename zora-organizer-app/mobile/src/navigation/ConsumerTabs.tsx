import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { tabScreenOptions } from './tabOptions';
import Icon from '../components/Icon';
import { useZ } from '../theme';
import HomeScreen from '../screens/consumer/HomeScreen';
import TableBookingScreen from '../screens/consumer/TableBookingScreen';
import CheckoutScreen from '../screens/consumer/CheckoutScreen';
import TicketsScreen from '../screens/consumer/TicketsScreen';
import TicketDetailScreen from '../screens/consumer/TicketDetailScreen';
import ProfileScreen from '../screens/consumer/ProfileScreen';

const HomeStack = createNativeStackNavigator();
function HomeStackNavigator() {
  const z = useZ();
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: z.bg } }}>
      <HomeStack.Screen name="Home" component={HomeScreen} />
      <HomeStack.Screen name="Booking" component={TableBookingScreen} options={{ animation: 'slide_from_right' }} />
      <HomeStack.Screen name="Checkout" component={CheckoutScreen} options={{ animation: 'slide_from_bottom' }} />
    </HomeStack.Navigator>
  );
}

const TicketsStack = createNativeStackNavigator();
function TicketsStackNavigator() {
  const z = useZ();
  return (
    <TicketsStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: z.bg } }}>
      <TicketsStack.Screen name="TicketsList" component={TicketsScreen} />
      <TicketsStack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ animation: 'slide_from_bottom' }} />
    </TicketsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();
export default function ConsumerTabs() {
  const z = useZ();
  return (
    <Tab.Navigator screenOptions={tabScreenOptions(z, z.ultra)}>
      <Tab.Screen
        name="HomeTab"
        component={HomeStackNavigator}
        options={{ title: 'Home', tabBarIcon: ({ color }) => <Icon name="home" color={color} /> }}
      />
      <Tab.Screen
        name="Tickets"
        component={TicketsStackNavigator}
        options={{ tabBarIcon: ({ color }) => <Icon name="ticket" color={color} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: ({ color }) => <Icon name="person" color={color} /> }}
      />
    </Tab.Navigator>
  );
}
