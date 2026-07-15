// Client for the Zora KYC identity pipeline (Phase 1) — this lives in the
// zora-site Express server (see zora-site/server.js, routes /api/kyc/*).
//
// The phone talks to it over the LAN like the Gate client does. Set
// EXPO_PUBLIC_KYC_URL in mobile/.env to your machine's LAN IP (or a tunnel),
// e.g. http://192.168.1.8:4100 — the fallback below matches the Gate's host.
// Native fetch is not subject to CORS, so no server CORS config is needed.
export const KYC_URL = process.env.EXPO_PUBLIC_KYC_URL ?? 'http://192.168.1.8:4100';

export type KycStatus = 'submitted' | 'in_review' | 'approved' | 'rejected' | 'expired';
export type IdType = 'passport' | 'drivers_license' | 'national_id';
export interface KycDoc { docId: string; side: string; contentType: string }

async function req<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${KYC_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `KYC service responded ${res.status}`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

// Upload one document (base64 image) to private, encrypted storage → opaque docId.
// `base64` is the raw string from expo-camera; we wrap it into a data URL the
// server's uploader expects. Images can be large, so this call gets more time.
export function uploadDoc(base64: string, side: string): Promise<KycDoc> {
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  return req<{ docId: string; contentType: string }>('/api/kyc/upload', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  }, 30000).then((r) => ({ docId: r.docId, side, contentType: r.contentType }));
}

// Create the verification record from already-uploaded docs.
export function submitKyc(payload: {
  idType: IdType; country: string; fullName: string; docNumber?: string; documents: KycDoc[];
}): Promise<{ ref: string; status: KycStatus }> {
  return req('/api/kyc/submit', { method: 'POST', body: JSON.stringify(payload) });
}

// User-facing status poll (no PII). `reason` is set only when rejected.
export function getKycStatus(ref: string): Promise<{
  ref: string; status: KycStatus; idType: IdType; submittedAt: string; reviewedAt: string | null; reason: string | null;
}> {
  return req(`/api/kyc/status/${encodeURIComponent(ref)}`, { method: 'GET' });
}
