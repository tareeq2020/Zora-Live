/* PR-BS2: consumer SMS one-time-code auth (CQ2).
   Codes are NEVER stored in the clear — only sha256-HMAC(phone:code, secret).
   Hardened four ways: short expiry, per-phone request throttle, attempt cap,
   single-use (consumed_at). The caller sends the returned code by SMS; the DB
   only ever sees the hash. */
import * as crypto from 'crypto';
import { tx } from './db';

type Sql = any;

export const OTP_TTL_SEC = 300;              // 5 min
export const OTP_THROTTLE_WINDOW_SEC = 60;   // per-phone request window
export const OTP_MAX_PER_WINDOW = 3;         // ≤3 requests / window (SMS-bomb guard)
export const OTP_MAX_ATTEMPTS = 5;           // ≤5 verify tries / challenge
const OTP_CODE_LEN = 6;

function otpSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.OTP_SECRET || env.SESSION_SECRET || 'zora-otp-dev-secret';
}

/** sha256-HMAC over `phone:code` — deterministic, so verify re-hashes and compares. */
export function hashOtp(phone: string, code: string, secret = otpSecret()): string {
  return crypto.createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
}

/** Crypto-random N-digit numeric code (leading zeros preserved). */
export function generateOtpCode(len = OTP_CODE_LEN): string {
  // rejection-free: build digit by digit from random bytes
  let s = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += String(bytes[i] % 10);
  return s;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export type RequestOtpResult =
  | { ok: true; code: string; expiresInSec: number }
  | { ok: false; reason: 'throttled'; retryAfterSec: number };

/** Issue a fresh challenge unless the phone is over its request throttle. Returns
    the raw code for the caller to SMS; only the hash is persisted. */
export async function requestOtp(sql: Sql, phone: string): Promise<RequestOtpResult> {
  const [{ n }] = await sql`
    select count(*)::int as n from otp_challenge
     where phone = ${phone} and created_at > now() - make_interval(secs => ${OTP_THROTTLE_WINDOW_SEC})`;
  if (n >= OTP_MAX_PER_WINDOW) return { ok: false, reason: 'throttled', retryAfterSec: OTP_THROTTLE_WINDOW_SEC };

  const code = generateOtpCode();
  await sql`
    insert into otp_challenge (phone, code_hash, expires_at)
    values (${phone}, ${hashOtp(phone, code)}, now() + make_interval(secs => ${OTP_TTL_SEC}))`;
  return { ok: true, code, expiresInSec: OTP_TTL_SEC };
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'too_many_attempts' | 'wrong_code'; attemptsLeft?: number };

/** Verify against the newest live challenge for the phone. Increments attempts
    under a row lock (so concurrent guesses can't exceed the cap), consumes on
    success. Constant-time hash compare. */
export async function verifyOtp(sql: Sql, phone: string, code: string): Promise<VerifyOtpResult> {
  return tx(async (t: Sql): Promise<VerifyOtpResult> => {
    const [ch] = await t`
      select id, code_hash, attempts from otp_challenge
       where phone = ${phone} and consumed_at is null and expires_at > now()
       order by created_at desc limit 1 for update`;
    if (!ch) return { ok: false, reason: 'expired' };
    if (ch.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
    await t`update otp_challenge set attempts = attempts + 1 where id = ${ch.id}`;
    if (!timingSafeHexEqual(hashOtp(phone, code), ch.code_hash)) {
      return { ok: false, reason: 'wrong_code', attemptsLeft: OTP_MAX_ATTEMPTS - (ch.attempts + 1) };
    }
    await t`update otp_challenge set consumed_at = now() where id = ${ch.id}`;
    return { ok: true };
  }, sql);
}
