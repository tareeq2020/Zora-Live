import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Anton_400Regular } from '@expo-google-fonts/anton';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { Michroma_400Regular } from '@expo-google-fonts/michroma';
import SplashGate from './src/components/SplashGate';
import RootNavigator from './src/navigation/RootNavigator';
import { useThemeStore, useZ } from './src/theme';
import { bindAuth } from './src/lib/auth';
import { supabaseReady } from './src/lib/supabase';

export default function App() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
    Michroma_400Regular,
  });
  const hydrate = useThemeStore((s) => s.hydrate);
  const mode = useThemeStore((s) => s.mode);
  const z = useZ();

  useEffect(() => { hydrate(); }, [hydrate]);

  // Mirror Supabase auth state → session store (role routing + KYC). Only when
  // keys are configured; without them the app stays in demo mode.
  useEffect(() => {
    if (!supabaseReady) return;
    const sub = bindAuth();
    return () => sub.unsubscribe();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: z.bg }}>
      <SafeAreaProvider>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        {fontsLoaded ? (
          <SplashGate>
            <RootNavigator />
          </SplashGate>
        ) : (
          <View style={{ flex: 1, backgroundColor: z.bg }} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
