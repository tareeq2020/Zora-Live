/* PR-6: ticket credential signing.
   A credential's `code` is an opaque random id (no PII) carried in the QR; the
   `signature` is an HMAC over a stable claims tuple. The verifier accepts a LIST
   of trusted keys — the rotation / multi-minter seam (cloud key + venue-node key
   verify simultaneously; retiring a key needs no scanner change). Offline &
   constant-time. Does NOT check used/revoked state (that's a DB lookup). */
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

export const QR_SCHEME = 'zora';

// Ambiguity-free Crockford-ish base32 (no 0 1 I L O) for human-dictatable refs.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const REF_PREFIX = 'ZORA';

export interface CredentialClaims {
  code: string;
  tier: string;
  eventId: string;
  tableId?: string | null; // null for ungrouped GA/VIP tiers
}

/** Opaque, URL-safe QR code with no PII. */
export function generateCode(): string {
  return crypto.randomBytes(16).toString('base64url');
}

/** Human-dictatable reference, e.g. ZORA-7Q4M-2KX9. */
export function generatePublicRef(): string {
  const pick = () =>
    Array.from(crypto.randomBytes(4))
      .map((b) => REF_ALPHABET[b % REF_ALPHABET.length])
      .join('');
  return `${REF_PREFIX}-${pick()}-${pick()}`;
}

function claimString(c: CredentialClaims): string {
  return `${c.code}.${c.tier}.${c.tableId ?? ''}.${c.eventId}`;
}

/** HMAC-SHA256 hex signature over the claims tuple, under a chosen key. */
export function signCredential(claims: CredentialClaims, key: string): string {
  return crypto.createHmac('sha256', key).update(claimString(claims)).digest('hex');
}

/** Constant-time verify against a LIST of trusted keys (rotation-ready). */
export function verifyCredential(claims: CredentialClaims, signature: string, keys: string[]): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (sig.length === 0) return false;
  const msg = claimString(claims);
  return keys.some((k) => {
    const expect = crypto.createHmac('sha256', k).update(msg).digest();
    return expect.length === sig.length && crypto.timingSafeEqual(expect, sig);
  });
}

/** Compact QR payload: `zora:<code>:<signature>` — no personal data. */
export function qrPayload(code: string, signature: string): string {
  return `${QR_SCHEME}:${code}:${signature}`;
}

/** Render a QR payload to a PNG buffer (scannable at the gate).
    Error-correction 'M' tolerates print smudging; 320px suits both inline
    email display and PDF placement. Caller MUST isolate render failures —
    a missing QR never blocks delivery (the human public_ref is the fallback). */
export function renderQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    type: 'png',
  });
}

/** Resolve the signing key list from env (comma-separated allows rotation). */
export function ticketSigningKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.TICKET_SIGNING_KEY;
  if (!raw || !raw.trim()) throw new Error('TICKET_SIGNING_KEY is required for credential signing');
  return raw.split(',').map((k) => k.trim()).filter(Boolean);
}
