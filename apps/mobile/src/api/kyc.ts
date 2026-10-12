import { apiFetch } from './client';

export type KycStatus = 'submitted' | 'in_review' | 'approved' | 'rejected' | 'expired';
export type IdType = 'passport' | 'drivers_license' | 'national_id';
export interface KycDoc { docId: string; side: string; contentType: string }

// Upload one document (base64 image) to private, encrypted storage -> opaque docId.
// `base64` is the raw string from expo-camera; we wrap it into a data URL the
// server's uploader expects. Images can be large, so this call gets more time.
export function uploadDoc(base64: string, side: string): Promise<KycDoc> {
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  return apiFetch<{ docId: string; contentType: string }>('/api/kyc/upload', {
    method: 'POST',
    timeoutMs: 30000,
    body: { dataUrl },
  }).then((r) => ({ docId: r.docId, side, contentType: r.contentType }));
}

// Create the verification record from already-uploaded docs.
export function submitKyc(payload: {
  idType: IdType; country: string; fullName: string; docNumber?: string; documents: KycDoc[];
}): Promise<{ ref: string; status: KycStatus }> {
  return apiFetch('/api/kyc/submit', { method: 'POST', body: payload });
}

// User-facing status poll (no PII). `reason` is set only when rejected.
export function getKycStatus(ref: string): Promise<{
  ref: string; status: KycStatus; idType: IdType; submittedAt: string; reviewedAt: string | null; reason: string | null;
}> {
  return apiFetch(`/api/kyc/status/${encodeURIComponent(ref)}`, { method: 'GET', auth: false });
}
