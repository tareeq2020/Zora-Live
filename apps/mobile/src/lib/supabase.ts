// Supabase client for the mobile app. Reads keys from EXPO_PUBLIC_* env (see
// mobile/.env.example). Import-safe even without keys (placeholders keep
// createClient from throwing) — calls simply fail until you set real values.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseReady = Boolean(url && anon);
if (!supabaseReady) {
  console.warn('[supabase] EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set — add them to mobile/.env (see .env.example).');
}

export const supabase = createClient(url || 'http://localhost', anon || 'public-anon-placeholder', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // RN has no URL to parse
  },
});
