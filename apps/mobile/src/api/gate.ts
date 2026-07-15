// Client for the Zora Gate backend (see ../../gate/server.js).
// LAN-direct: phone and PC are on the same Wi-Fi, so we hit the Gate straight on
// its local IP — no tunnel, unaffected by localtunnel outages. If the PC's LAN IP
// changes, update this. For remote testing, swap to the localtunnel URL
// (https://zora-gate-tz.loca.lt — the Gate opens that stable subdomain too).
export const GATE_URL = 'http://192.168.1.8:4300';

export interface PublishResult { ok: boolean; version: number; clients: number }

export async function publishEvent(
  id: string,
  patch: { cap?: number; tiers?: { name: string; price: number }[] },
): Promise<PublishResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(`${GATE_URL}/events/${id}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'bypass-tunnel-reminder': 'zora', // skips localtunnel's browser interstitial
      },
      body: JSON.stringify(patch),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gate responded ${res.status}`);
    return (await res.json()) as PublishResult;
  } finally {
    clearTimeout(timeout);
  }
}
