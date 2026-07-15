import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RolePickerScreen from '../screens/RolePickerScreen';
import AgentCodeScreen from '../screens/AgentCodeScreen';
import { useZ } from '../theme';

const Stack = createNativeStackNavigator();

export default function AuthNavigator() {
  const z = useZ();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: z.bg } }}>
      <Stack.Screen name="Auth" component={RolePickerScreen} />
      <Stack.Screen name="AgentCode" component={AgentCodeScreen} options={{ animation: 'slide_from_right' }} />
    </Stack.Navigator>
  );
}
