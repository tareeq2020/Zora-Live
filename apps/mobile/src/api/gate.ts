import { apiFetch } from './client';

export interface PublishResult { ok: boolean; version: number; clients: number }

export async function publishEvent(
  id: string,
  patch: { cap?: number; tiers?: { name: string; price: number }[] },
): Promise<PublishResult> {
  await apiFetch(`/api/events/${encodeURIComponent(id)}`, { method: 'PUT', body: patch, timeoutMs: 9000 });
  return { ok: true, version: Date.now(), clients: 0 };
}
