// Scanning-agent client: redeem an access code for a scoped JWT (stored in
// SecureStore), then authorize each ticket scan with it.
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../api/client';

const KEY = 'zora.agent.jwt';
const HEADERS = { 'Content-Type': 'application/json' };

export const saveAgentToken = (t: string) => SecureStore.setItemAsync(KEY, t);
export const getAgentToken = () => SecureStore.getItemAsync(KEY);
export const clearAgentToken = () => SecureStore.deleteItemAsync(KEY);

export interface RedeemResult {
  token: string;
  expiresAt: string;
  scanner: { id: string; name: string; role: 'agent' | 'supervisor'; eventScope: string | null; canSell?: boolean };
}

export interface VerifyTicketResult {
  ok: boolean;
  result: string;
  ticket: string;
  message?: string;
  priorActor?: string | null;
  priorAt?: string | null;
}

export async function redeemCode(code: string): Promise<RedeemResult> {
  const r = await fetch(`${API_URL}/api/scan/session`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ code }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.message || `redeem_failed_${r.status}`);
  await saveAgentToken(j.token);
  return j as RedeemResult;
}

export async function verifyTicket(ticket: string): Promise<VerifyTicketResult> {
  const token = await getAgentToken();
  const r = await fetch(`${API_URL}/api/scan/verify`, {
    method: 'POST',
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ qr: ticket }),
  });
  if (r.status === 401 || r.status === 403) { await clearAgentToken(); throw new Error('session_ended'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return {
      ok: false,
      result: String(j.outcome || j.error || 'invalid'),
      ticket: String(j.pass?.reference ?? j.pass?.id ?? ticket),
      message: typeof j.message === 'string' ? j.message : undefined,
      priorActor: typeof j.priorActor === 'string' ? j.priorActor : null,
      priorAt: typeof j.priorAt === 'string' ? j.priorAt : null,
    };
  }
  return {
    ok: true,
    result: String(j.outcome || 'valid'),
    ticket: String(j.pass?.reference ?? j.pass?.id ?? ticket),
    message: typeof j.message === 'string' ? j.message : undefined,
  };
}
