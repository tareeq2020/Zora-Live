// Auth service for the mobile app's Nest-backed organizer session.
import { useSession } from '../session/store';
import { apiFetch, clearApiCookies } from '../api/client';

export type MeResponse = {
  role: 'admin' | 'organizer' | null;
  organizerHandle: string | null;
  email: string | null;
  name: string | null;
  memberships?: { organizerId: string; organizerHandle: string; role: string; kycStatus?: string | null }[];
};

function applyNestSession(me: MeResponse) {
  if (me.role !== 'organizer') return false;
  const kycStatus = me.memberships?.find((m) => m.organizerHandle === me.organizerHandle)?.kycStatus;
  useSession.getState().signInAs('organizer');
  useSession.getState().setAccount({
    name: me.name,
    email: me.email,
    organizerHandle: me.organizerHandle,
    verified: kycStatus === 'approved',
  });
  return true;
}

export async function signInOrganizer(identifier: string, password: string) {
  await apiFetch<{ ok: true }>('/api/org/login', {
    method: 'POST',
    auth: false,
    body: { identifier: identifier.trim(), password },
  });
  const me = await apiFetch<MeResponse>('/api/me');
  if (!applyNestSession(me)) throw new Error('This account is not an organizer.');
  return me;
}

export async function hydrateNestSession() {
  try {
    const me = await apiFetch<MeResponse>('/api/me');
    return applyNestSession(me);
  } catch {
    return false;
  }
}

export async function signOutNest() {
  try {
    await apiFetch<{ ok: true }>('/api/logout', { method: 'POST' });
  } catch {
    /* local sign-out still clears the app */
  }
  await clearApiCookies();
  useSession.getState().signOut();
}
