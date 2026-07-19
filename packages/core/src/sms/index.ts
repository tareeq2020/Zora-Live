/* PR-10: provider-agnostic SMS delivery (pure @zora/core, no HTTP/Nest).
   One narrow contract — sendSms(to, message) — behind a driver switch so the
   payment-success path (PR-9) never learns which gateway is live.

   Two failure modes are kept DISTINCT on purpose:
     • MISCONFIG (a real driver selected but its creds are absent) → we do NOT
       throw. We warn LOUDLY ([sms:UNCONFIGURED]) and fall back to a dev-log,
       returning { delivered:false, dev:true }. A missing gateway key must never
       fail a paid checkout — the ticket is already valid; SMS is a courtesy.
     • REAL SEND FAILURE (creds present, gateway rejects) → throws, so the
       caller can retry / surface it. */

export type SmsDriver = 'at' | 'beem' | 'mock';

export interface SmsResult {
  /** true only when a real gateway accepted the message. */
  delivered: boolean;
  /** true when the message went to the dev-log instead of a real gateway
      (mock driver, sandbox username, or a misconfigured real driver). */
  dev: boolean;
}

function resolveDriver(env: NodeJS.ProcessEnv): SmsDriver {
  const raw = (env.SMS_DRIVER ?? 'at').trim().toLowerCase();
  if (raw === 'at' || raw === 'beem' || raw === 'mock') return raw;
  console.warn(`[sms:UNCONFIGURED] unknown SMS_DRIVER="${raw}" — falling back to dev-log`);
  return 'mock';
}

/** Loud, uniform dev-log fallback. Returns the misconfig/mock result shape. */
function devLog(to: string, message: string, reason: string): SmsResult {
  console.warn(`[sms:UNCONFIGURED] ${reason} — dev-log only, not sent`);
  console.warn(`[sms:dev] to=${to} message=${JSON.stringify(message)}`);
  return { delivered: false, dev: true };
}

async function sendViaAt(to: string, message: string, env: NodeJS.ProcessEnv): Promise<SmsResult> {
  const apiKey = env.AT_API_KEY;
  const username = env.AT_USERNAME;
  if (!apiKey || !username) {
    return devLog(to, message, "driver=at but AT_API_KEY/AT_USERNAME missing");
  }
  const body = new URLSearchParams({ username, to, message }).toString();
  const res = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[sms:at] send failed ${res.status}: ${text.slice(0, 300)}`);
  }
  // Sandbox credentials do not actually deliver — mark as dev.
  const dev = username === 'sandbox';
  return { delivered: !dev, dev };
}

async function sendViaBeem(to: string, message: string, env: NodeJS.ProcessEnv): Promise<SmsResult> {
  const key = env.BEEM_KEY;
  const secret = env.BEEM_SECRET;
  const sender = env.BEEM_SENDER;
  if (!key || !secret || !sender) {
    return devLog(to, message, "driver=beem but BEEM_KEY/BEEM_SECRET/BEEM_SENDER missing");
  }
  const url = env.BEEM_API_URL || 'https://apisms.beem.africa/v1/send';
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  // Beem wants bare national/international digits, no '+'.
  const destAddr = to.replace(/[^0-9]/g, '');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      source_addr: sender,
      encoding: 0,
      message,
      recipients: [{ recipient_id: 1, dest_addr: destAddr }],
    }),
  });
  const text = await res.text().catch(() => '');
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok || (payload && payload.successful === false)) {
    throw new Error(`[sms:beem] send failed ${res.status}: ${text.slice(0, 300)}`);
  }
  return { delivered: true, dev: false };
}

/** Send an SMS via the configured driver. Never throws on misconfiguration;
    only a genuine gateway rejection (creds present) throws. */
export async function sendSms(
  to: string,
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SmsResult> {
  const driver = resolveDriver(env);
  switch (driver) {
    case 'at':
      return sendViaAt(to, message, env);
    case 'beem':
      return sendViaBeem(to, message, env);
    case 'mock':
    default:
      console.log(`[sms:mock] to=${to} message=${JSON.stringify(message)}`);
      return { delivered: false, dev: true };
  }
}
