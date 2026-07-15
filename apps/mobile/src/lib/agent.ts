// Scanning-agent client: redeem an access code for a scoped JWT (stored in
// SecureStore), then authorize each ticket scan with it.
import * as SecureStore from 'expo-secure-store';
import { GATE_URL } from '../api/gate';

const KEY = 'zora.agent.jwt';
const HEADERS = { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'zora' };

export const saveAgentToken = (t: string) => SecureStore.setItemAsync(KEY, t);
export const getAgentToken = () => SecureStore.getItemAsync(KEY);
export const clearAgentToken = () => SecureStore.deleteItemAsync(KEY);

export interface RedeemResult { token: string; event_id: string; scopes: string[]; expires_in: number }

export async function redeemCode(code: string, deviceId: string): Promise<RedeemResult> {
  const r = await fetch(`${GATE_URL}/agent/redeem`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ code, deviceId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `redeem_failed_${r.status}`);
  await saveAgentToken(j.token);
  return j as RedeemResult;
}

export async function verifyTicket(ticket: string): Promise<{ ok: boolean; result: string; ticket: string }> {
  const token = await getAgentToken();
  const r = await fetch(`${GATE_URL}/tickets/verify`, {
    method: 'POST',
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ticket }),
  });
  if (r.status === 401 || r.status === 403) { await clearAgentToken(); throw new Error('session_ended'); }
  return r.json();
}
