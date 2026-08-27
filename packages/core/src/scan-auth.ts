/* Scanner sign-in (BS42 / plan #1, eng review ARCH-3 + OV4).

   A door agent signs in with the 6-digit code the super-admin handed them, and
   gets back a SCOPED SCANNER SESSION — role (`agent` | `supervisor`) plus an
   optional event scope. Not an admin session, not an org session: it can reach
   /api/scan/* and nothing else.

   ── OV4: why the lockout is not optional ────────────────────────────────────
   Six digits is 900,000 possibilities. A script at 20 requests/second sweeps the
   whole space in about twelve hours and finds a LIVE code in far less, and the
   codes are long-lived across a door shift. Without a lockout, "type six digits"
   is not authentication, it is a speed bump. So:

     · every exchange — success or failure — is recorded in `scan_auth_attempt`,
     · too many failures against ONE code inside the window locks that code
       (the targeted attack: someone saw a code over a shoulder and is guessing
       the last two digits),
     · too many failures from ONE source inside the window locks that source
       (the sweep: many codes, one script),
     · while locked, even the CORRECT code is refused. A lockout that a correct
       guess can walk through is not a lockout.

   The attempted code is hashed before it is stored — this table must never
   become a list of near-miss door codes.

   ── What the lockout deliberately does NOT do ──────────────────────────────
   It does not lock the scanner USER (that would let an attacker deny a real
   agent the door by guessing at their code all night — a denial-of-entry attack
   against the event). It locks the CODE and the SOURCE, and the admin's answer
   to a locked code is ROTATE, which is one tap and already exists. */
import * as crypto from 'crypto';
import { tx } from './db';

type Sql = any;

// ── policy ───────────────────────────────────────────────────────────────────

/** Rolling window both counters are measured over. */
export const SCAN_LOCKOUT_WINDOW_SEC = 15 * 60;
/** Failures against ONE code before that code is locked for the window. */
export const SCAN_CODE_MAX_FAILURES = 5;
/** Failures from ONE source before that source is locked for the window. */
export const SCAN_IP_MAX_FAILURES = 10;

/** How long a session token lives. A door shift, not a week. */
export const SCAN_SESSION_TTL_SEC = 12 * 60 * 60;

export type ScannerRole = 'agent' | 'supervisor';

// ── the record ───────────────────────────────────────────────────────────────

export interface ScannerUser {
  id: string;
  name: string;
  contact: string | null;
  via: string | null;
  role: ScannerRole;
  /** event.id this user is pinned to; null = every event. */
  eventScope: string | null;
  code: string;
  status: 'active' | 'revoked';
  /** BS106: the organizer that owns this scanner (their acting handle), or null
      for platform/admin-provisioned scanners (legacy). */
  organizerHandle: string | null;
  createdAt: string;
  expiresAt: string | null;
  codeRotatedAt: string;
  lastSeenAt: string | null;
}

export type ScannerUserRow = {
  id: string; name: string; contact: string | null; via: string | null;
  role: string; event_scope: string | null; code: string; status: string;
  organizer_handle: string | null;
  created_at: Date | string; expires_at: Date | string | null;
  code_rotated_at: Date | string; last_seen_at: Date | string | null;
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

export function toScannerUser(r: ScannerUserRow): ScannerUser {
  return {
    id: r.id,
    name: r.name,
    contact: r.contact,
    via: r.via,
    role: r.role === 'supervisor' ? 'supervisor' : 'agent',
    eventScope: r.event_scope,
    code: r.code,
    status: r.status === 'revoked' ? 'revoked' : 'active',
    organizerHandle: r.organizer_handle ?? null,
    createdAt: iso(r.created_at) as string,
    expiresAt: iso(r.expires_at),
    codeRotatedAt: iso(r.code_rotated_at) as string,
    lastSeenAt: iso(r.last_seen_at),
  };
}

export const SCANNER_USER_COLUMNS = `id, name, contact, via, role, event_scope, code,
                                     status, organizer_handle, created_at, expires_at, code_rotated_at, last_seen_at`;

// ── codes ────────────────────────────────────────────────────────────────────

/** Crypto-random 6-digit code. `Math.random()` was the legacy generator; a door
    credential does not get a predictable PRNG. Leading zeros are preserved. */
export function generateScannerCode(len = 6): string {
  let s = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += String(bytes[i] % 10);
  return s;
}

/** Codes are only ever stored HASHED in the attempt ledger. */
export function hashScanCode(code: string, secret = process.env.SESSION_SECRET || 'zora-scan-dev-secret'): string {
  return crypto.createHmac('sha256', secret).update(String(code ?? '')).digest('hex');
}

// ── the exchange ─────────────────────────────────────────────────────────────

export type ScanAuthErrorCode = 'invalid_code' | 'locked_out' | 'revoked' | 'expired';

export interface ScanAuthInput {
  code: string;
  /** Source address, for the sweep counter. Missing = counted under '-'. */
  ip?: string | null;
}

export type ScanAuthResult =
  | { ok: true; user: ScannerUser }
  | { ok: false; code: ScanAuthErrorCode; message: string; retryAfterSec?: number };

const AUTH_MESSAGE: Record<ScanAuthErrorCode, string> = {
  invalid_code: 'That code isn’t right. Check with the event manager.',
  locked_out: 'Too many wrong codes. Try again later, or ask for a fresh code.',
  revoked: 'That code was revoked. Ask the event manager for a new one.',
  expired: 'That code has expired. Ask the event manager for a new one.',
};

export const scanAuthMessage = (code: ScanAuthErrorCode): string => AUTH_MESSAGE[code];

/**
 * Trade a 6-digit code for a scanner identity, under the lockout.
 *
 * Everything happens in ONE transaction so the attempt is recorded even on the
 * paths that refuse — an attacker must not be able to make their own guesses
 * invisible by racing them.
 */
export async function authenticateScannerCode(sql: Sql, input: ScanAuthInput): Promise<ScanAuthResult> {
  const raw = String(input.code ?? '').trim();
  const ip = String(input.ip ?? '').trim() || '-';
  const codeHash = hashScanCode(raw);

  return tx(async (t: Sql): Promise<ScanAuthResult> => {
    // ── the lockout check, BEFORE the lookup ──
    // Deliberately first: a locked code must not even be compared, or the timing
    // difference between "locked + right" and "locked + wrong" leaks the answer.
    const [counts] = (await t`
      select
        (select count(*)::int from scan_auth_attempt
          where not ok and code_hash = ${codeHash}
            and at > now() - make_interval(secs => ${SCAN_LOCKOUT_WINDOW_SEC})) as code_fails,
        (select count(*)::int from scan_auth_attempt
          where not ok and ip = ${ip}
            and at > now() - make_interval(secs => ${SCAN_LOCKOUT_WINDOW_SEC})) as ip_fails`) as
      { code_fails: number; ip_fails: number }[];

    if (counts.code_fails >= SCAN_CODE_MAX_FAILURES || counts.ip_fails >= SCAN_IP_MAX_FAILURES) {
      // Record the locked attempt too — a sustained attack should keep the window
      // sliding forward rather than expire quietly while it is still running.
      await t`insert into scan_auth_attempt (code_hash, ip, ok) values (${codeHash}, ${ip}, false)`;
      return {
        ok: false, code: 'locked_out', message: AUTH_MESSAGE.locked_out,
        retryAfterSec: SCAN_LOCKOUT_WINDOW_SEC,
      };
    }

    // Only an ACTIVE code can resolve — the partial unique index guarantees at
    // most one row, so this can never silently pick between two users.
    const rows = (await t`
      select ${t.unsafe(SCANNER_USER_COLUMNS)} from scanner_user
       where code = ${raw} and status = 'active'`) as ScannerUserRow[];

    if (!rows.length) {
      await t`insert into scan_auth_attempt (code_hash, ip, ok) values (${codeHash}, ${ip}, false)`;
      // "Revoked" and "never existed" are told apart on purpose: an agent whose
      // shift code was pulled mid-event needs to know to ask for a new one, not
      // to stand there retyping. It IS a small oracle ("this code was once
      // real"), and the lockout above is what makes that acceptable — five
      // guesses per code, ten per source, then the door closes on the guesser.
      const [revoked] = (await t`
        select id from scanner_user where code = ${raw} and status = 'revoked' limit 1`) as { id: string }[];
      return revoked
        ? { ok: false, code: 'revoked', message: AUTH_MESSAGE.revoked }
        : { ok: false, code: 'invalid_code', message: AUTH_MESSAGE.invalid_code };
    }

    const user = toScannerUser(rows[0]);
    if (user.expiresAt && new Date(user.expiresAt).getTime() <= Date.now()) {
      await t`insert into scan_auth_attempt (code_hash, ip, ok) values (${codeHash}, ${ip}, false)`;
      return { ok: false, code: 'expired', message: AUTH_MESSAGE.expired };
    }

    await t`insert into scan_auth_attempt (code_hash, ip, ok, user_id) values (${codeHash}, ${ip}, true, ${user.id})`;
    await t`update scanner_user set last_seen_at = now() where id = ${user.id}`;
    return { ok: true, user };
  }, sql);
}

/** Is this code / source currently locked? (Read-only — the sign-in screen uses
    it to explain itself instead of just failing again.) */
export async function scanLockoutState(
  sql: Sql,
  input: { code?: string | null; ip?: string | null },
): Promise<{ codeLocked: boolean; ipLocked: boolean; windowSec: number }> {
  const codeHash = input.code ? hashScanCode(String(input.code)) : null;
  const ip = String(input.ip ?? '').trim() || '-';
  const [r] = (await sql`
    select
      (select count(*)::int from scan_auth_attempt
        where not ok and code_hash = ${codeHash}
          and at > now() - make_interval(secs => ${SCAN_LOCKOUT_WINDOW_SEC})) as code_fails,
      (select count(*)::int from scan_auth_attempt
        where not ok and ip = ${ip}
          and at > now() - make_interval(secs => ${SCAN_LOCKOUT_WINDOW_SEC})) as ip_fails`) as
    { code_fails: number; ip_fails: number }[];
  return {
    codeLocked: (r?.code_fails ?? 0) >= SCAN_CODE_MAX_FAILURES,
    ipLocked: (r?.ip_fails ?? 0) >= SCAN_IP_MAX_FAILURES,
    windowSec: SCAN_LOCKOUT_WINDOW_SEC,
  };
}
