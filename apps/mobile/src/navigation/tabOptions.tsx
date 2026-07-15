import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import type { ZTheme } from '../theme';

export const tabScreenOptions = (z: ZTheme, activeTint: string): BottomTabNavigationOptions => ({
  headerShown: false,
  tabBarStyle: {
    backgroundColor: z.panel,
    borderTopColor: z.line,
    height: 82,
    paddingBottom: 16,
    paddingTop: 10,
  },
  tabBarActiveTintColor: activeTint,
  tabBarInactiveTintColor: z.mut2,
  tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
});
