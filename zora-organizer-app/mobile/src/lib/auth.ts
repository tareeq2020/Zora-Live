// Auth service — Google OAuth + email/password on top of Supabase Auth, kept in
// sync with the local session store (role → routing).
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from './supabase';
import { useSession, type Role } from '../session/store';

WebBrowser.maybeCompleteAuthSession();

export const signUpEmail = (email: string, password: string) =>
  supabase.auth.signUp({ email: email.trim(), password }); // GoTrue bcrypts server-side

export const signInEmail = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email: email.trim(), password });

export async function signInGoogle() {
  const redirectTo = makeRedirectUri({ scheme: 'zora' }); // matches app.json "scheme"
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw error ?? new Error('No OAuth URL returned');

  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return false;

  const params = new URLSearchParams(res.url.split('#')[1] ?? '');
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) await supabase.auth.setSession({ access_token, refresh_token });
  return true;
}

export const signOut = () => supabase.auth.signOut();

// The user's role + KYC status live in their profile row (set at signup / by an
// admin / by the verification pipeline). One round-trip fetches both.
export async function resolveProfile(): Promise<{ role: Role; verified: boolean } | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase.from('profiles').select('role, kyc_verified').eq('id', session.user.id).single();
  return { role: (data?.role as Role) ?? 'consumer', verified: Boolean(data?.kyc_verified) };
}

// Back-compat: role only.
export async function resolveRole(): Promise<Role | null> {
  const p = await resolveProfile();
  return p ? p.role : null;
}

// Call once at app start: mirrors Supabase auth state into the session store, so
// the RootNavigator routes by the real role and the wallet gates on real KYC.
// Returns the subscription to clean up.
export function bindAuth() {
  const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session) { useSession.getState().signOut(); return; }
    const p = await resolveProfile();
    if (p) {
      useSession.getState().signInAs(p.role);       // organizer → dashboard (bug already fixed)
      useSession.getState().setVerified(p.verified); // payouts unlock only when the profile is verified
    }
  });
  return data.subscription;
}
