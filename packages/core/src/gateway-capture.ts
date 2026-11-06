/* BS157: keep what x-bridge tells us (0036).

   x-bridge's status read carries only `status`; a callback may carry more (an
   account we connected ourselves passes the provider's own body through). We
   store both, sanitized, so an admin can see "What x-bridge sent" and the cart
   outcome can name a reason when one is given.

   Every write here is best-effort, like logOrderEvent: it never throws, and
   inside a transaction it runs under a SAVEPOINT so a failed write (say, the
   column is missing) rolls back only itself. */

type Sql = any; // postgres.js Sql | tx handle

/** Stored bodies are capped at about this many characters of JSON. */
export const CAPTURE_MAX_CHARS = 8192;

const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|key[_-]?id|authorization|auth|signature|sig|hmac|pin|otp|cvv|cvc|card[_-]?number|pan|cookie)$/i;
const PHONE_KEY = /(phone|msisdn|mobile|payer[_-]?number|account[_-]?number)/i;

function maskDigits(m: string): string {
  return '*'.repeat(Math.max(0, m.length - 3)) + m.slice(-3);
}

/** Scrub one string: bearer tokens, JWTs, long hex, phone-like digit runs. */
function scrubString(s: string, max = 1000): string {
  let out = s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+)?/g, '[jwt]')
    .replace(/("?(?:token|secret|password|apiKey|api_key|keyId|authorization|signature)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, '$1"[redacted]"')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hex]')
    .replace(/\+?\d{9,15}/g, maskDigits);
  if (out.length > max) out = out.slice(0, max - 3) + '...';
  return out;
}

function scrub(v: unknown, key: string, depth: number): unknown {
  if (v == null) return v;
  if (key && SECRET_KEY.test(key)) return '[redacted]';
  if (typeof v === 'string') return PHONE_KEY.test(key) ? maskDigits(v.replace(/\s+/g, '')) : scrubString(v);
  if (typeof v === 'number') return PHONE_KEY.test(key) ? maskDigits(String(v)) : v;
  if (typeof v === 'boolean') return v;
  if (depth >= 6) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, key, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 100)) out[k] = scrub(x, k, depth + 1);
    return out;
  }
  return String(v);
}

/** A gateway body made safe to store and show: secrets redacted, phone numbers
    masked, at most ~8 KB of JSON. Accepts an object or a raw string. */
export function sanitizeGatewayPayload(body: unknown): Record<string, unknown> {
  let v: unknown = body;
  if (typeof v === 'string' || Buffer.isBuffer(v)) {
    const raw = String(v);
    try { v = JSON.parse(raw); } catch { return { raw: scrubString(raw, 2000) }; }
  }
  const clean = scrub(v, '', 0);
  const obj: Record<string, unknown> =
    clean && typeof clean === 'object' && !Array.isArray(clean) ? (clean as Record<string, unknown>) : { value: clean };
  const json = JSON.stringify(obj);
  if (json.length <= CAPTURE_MAX_CHARS) return obj;
  return { truncated: true, size: json.length, preview: json.slice(0, CAPTURE_MAX_CHARS - 200) };
}

/** Fields a gateway may put a reason in, most specific first. */
export const REASON_FIELDS = [
  'failure_reason', 'reason', 'statusReason', 'status_reason',
  'statusDescription', 'status_description', 'resultDesc', 'result_desc', 'resultDescription',
  'responseDescription', 'response_description', 'errorMessage', 'error_message', 'errorDescription',
  'fspStatus', 'fsp_status', 'message', 'description', 'error', 'gatewayResponse', 'gateway_response',
] as const;

/** Values that are a status word, not a reason. */
const NOT_A_REASON = new Set([
  'ok', 'success', 'successful', 'succeeded', 'completed', 'complete', 'pending', 'processing', 'accepted',
  'failed', 'failure', 'fail', 'error', 'expired', 'partial', 'true', 'false', 'null', 'undefined', '0', '200',
  'collection.updated', 'request processed successfully', 'transaction successful',
]);

const PAID_WORDS = new Set(['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'SUCCEEDED', 'PAID', 'SETTLED']);

function pickReason(v: unknown, depth: number): string | null {
  if (v == null || depth > 3) return null;
  if (typeof v === 'string' || typeof v === 'number') {
    const s = String(v).replace(/\s+/g, ' ').trim();
    if (!s || NOT_A_REASON.has(s.toLowerCase())) return null;
    return s;
  }
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  for (const f of REASON_FIELDS) {
    if (!(f in o)) continue;
    const r = pickReason(o[f], depth + 1);
    if (r) return r;
  }
  return null;
}

export interface ExtractedReason {
  reason: string;
  /** true when it came from x-bridge's own `failureReason` field. */
  structured: boolean;
}

/** The reason in a callback or status body, or null. x-bridge's `failureReason`
    (next to `status`) is used as given, raw; when that key is present but null
    there is no reason. Only when the key is absent do we fall back to the
    generic reason-like fields. Paid bodies carry no failure reason. */
export function extractReason(body: unknown): ExtractedReason | null {
  let v: unknown = body;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const status = String(o.status ?? '').toUpperCase();
  if (PAID_WORDS.has(status)) return null;
  if (Object.prototype.hasOwnProperty.call(o, 'failureReason')) {
    const f = o.failureReason;
    if (f == null || (typeof f !== 'string' && typeof f !== 'number')) return null;
    const s = String(f).trim();
    return s ? { reason: scrubString(s, 200), structured: true } : null;
  }
  const r = pickReason(o, 0);
  return r ? { reason: scrubString(r, 200), structured: false } : null;
}

/** extractReason's text only. */
export function extractFailureReason(body: unknown): string | null {
  return extractReason(body)?.reason ?? null;
}

/* The first reason stored wins, except that x-bridge's own field replaces a
   fallback guess (anything not already one of its known values). */
const KNOWN = ['payer_no_response', 'payer_cancelled', 'insufficient_funds', 'wrong_pin', 'invalid_number', 'provider_error', 'unknown'];
function reasonSet(q: Sql, r: ExtractedReason | null) {
  if (!r) return q`failure_reason`;
  return r.structured
    ? q`case when failure_reason is null or not (lower(failure_reason) = any(${KNOWN})) then ${r.reason} else failure_reason end`
    : q`coalesce(failure_reason, ${r.reason})`;
}

async function bestEffort(sql: Sql, label: string, run: (q: Sql) => Promise<unknown>): Promise<void> {
  if (!sql) return;
  try {
    if (typeof sql.savepoint === 'function') await sql.savepoint((sp: Sql) => run(sp));
    else await run(sql);
  } catch (e) {
    // A window on the gateway, not the money path.
    console.error(`${label} capture skipped`, (e as Error)?.message);
  }
}

/** Store a callback body on its webhook_event row and, when it names a reason,
    on the attempt. Never throws. */
export async function captureCallback(
  sql: Sql, webhookEventId: string | null | undefined, transactionId: string | null | undefined, rawBody: unknown,
): Promise<void> {
  const payload = sanitizeGatewayPayload(rawBody);
  if (webhookEventId) {
    await bestEffort(sql, 'webhook_event.payload', (q) =>
      q`update webhook_event set payload = ${q.json(payload)} where id = ${webhookEventId}`);
  }
  const reason = extractReason(rawBody);
  if (transactionId && reason) {
    await bestEffort(sql, 'payment_transaction.failure_reason', (q) =>
      q`update payment_transaction set failure_reason = ${reasonSet(q, reason)} where transaction_id = ${transactionId}`);
  }
}

/** Store a status-read body on the attempt, only when its status differs from
    the one stored (a poll that says the same thing writes nothing). Never throws. */
export async function captureStatusRead(sql: Sql, transactionId: string | null | undefined, body: unknown): Promise<void> {
  if (!transactionId || !body || typeof body !== 'object') return;
  const payload = sanitizeGatewayPayload(body);
  const status = String((body as any).status ?? '');
  const reason = extractReason(body);
  // The reason is kept even when the body is not (same status as last time).
  if (reason) {
    await bestEffort(sql, 'payment_transaction.failure_reason', (q) =>
      q`update payment_transaction set failure_reason = ${reasonSet(q, reason)} where transaction_id = ${transactionId}`);
  }
  await bestEffort(sql, 'payment_transaction.gateway_status', (q) => q`
    update payment_transaction
       set gateway_status = ${q.json(payload)}, gateway_status_at = now()
     where transaction_id = ${transactionId}
       and (gateway_status is null or gateway_status->>'status' is distinct from ${status}::text)`);
}
