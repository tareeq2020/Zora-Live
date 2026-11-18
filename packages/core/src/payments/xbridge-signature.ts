/* BS166: x-bridge Payments webhook signature (shared by the business-event
   endpoint and the installment receivable endpoint).
   X-Bridge-Signature: v1=hex(HMAC_SHA256(secret, X-Bridge-Timestamp + "." + rawBody)). */
import { createHmac, timingSafeEqual } from 'node:crypto';

type Headers = Record<string, string | string[] | undefined>;

export const WEBHOOK_MAX_AGE_SECS = 300;
export const WEBHOOK_MAX_SKEW_SECS = 60;

function header(headers: Headers, name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** The X-Bridge-Signature value for a body at a timestamp. Test seam. */
export function signXbridgeWebhook(rawBody: string, secret: string, ts: number | string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${ts}.`, 'utf8').update(rawBody, 'utf8').digest('hex');
}

export type SignatureCheck = 'ok' | 'no_signature' | 'bad_timestamp' | 'stale' | 'bad_signature';

/** Verify an x-bridge Payments delivery. */
export function verifyXbridgeSignature(
  rawBody: string, headers: Headers, secret: string, nowMs: number = Date.now(),
): SignatureCheck {
  const sig = header(headers, 'x-bridge-signature');
  const ts = header(headers, 'x-bridge-timestamp');
  if (!sig) return 'no_signature';
  if (!ts || !/^\d{1,12}$/.test(ts)) return 'bad_timestamp';
  const age = nowMs / 1000 - Number(ts);
  if (age > WEBHOOK_MAX_AGE_SECS || age < -WEBHOOK_MAX_SKEW_SECS) return 'stale';
  const want = createHmac('sha256', secret).update(`${ts}.`, 'utf8').update(rawBody, 'utf8').digest();
  const ok = String(sig).split(',').map((p) => p.trim())
    .map((p) => /^v1=([0-9a-fA-F]{64})$/.exec(p)?.[1])
    .filter((h): h is string => !!h)
    .some((h) => {
      const got = Buffer.from(h, 'hex');
      return got.length === want.length && timingSafeEqual(got, want);
    });
  return ok ? 'ok' : 'bad_signature';
}

