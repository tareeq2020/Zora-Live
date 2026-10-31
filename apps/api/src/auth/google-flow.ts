import { createHmac, timingSafeEqual } from 'node:crypto';

/* BS148: the pure half of Google sign-in — no Nest, no DB, no network — so the
   security-relevant pieces (state encode/verify, the `next` sanitizer, the
   claims → session decision) are unit-tested in isolation
   (apps/api/test/google-flow.test.mjs).

   ONE callback serves every intent. Google Cloud only has
   <origin>/api/auth/google/callback registered, so the intent (admin | org |
   signup) and the post-login `next` path ride inside the signed state:

     state sent to Google : `${nonce}.${payload}`
     state cookie         : `${nonce}.${payload}.${mac}`   mac = HMAC(secret, nonce.payload)
     payload              : base64url(JSON { i: intent, n: next })

   The callback requires the query `state` to equal the cookie's nonce.payload
   AND the mac to verify — so neither the intent nor `next` can be swapped by
   anyone who does not hold SESSION_SECRET. */

export type GoogleIntent = 'admin' | 'org' | 'signup';
export const INTENTS: readonly GoogleIntent[] = ['admin', 'org', 'signup'];

export function hmac(secret: string, prefix: string, v: string): string {
  return createHmac('sha256', secret).update(prefix + v).digest('base64url');
}

export function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseIntent(raw: unknown): GoogleIntent {
  const s = String(raw ?? '').trim().toLowerCase();
  return (INTENTS as readonly string[]).includes(s) ? (s as GoogleIntent) : 'admin';
}

/** A same-site RELATIVE path, or null. Rejects protocol-relative (`//x`),
    backslash tricks (`/\x` — browsers normalise `\` to `/`), schemes
    (`javascript:`, `https:`), control characters and anything over 512 chars. */
export function sanitizeNext(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 512) return null;
  if (s[0] !== '/') return null;
  if (s[1] === '/' || s[1] === '\\') return null;
  if (s.includes('\\')) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  // Belt and braces: a URL parsed against a dummy origin must stay on it.
  try {
    const u = new URL(s, 'https://same.invalid');
    if (u.origin !== 'https://same.invalid') return null;
  } catch {
    return null;
  }
  return s;
}

/** Where an organizer lands: the sanitized `next` when it is a dashboard path
    (never back onto the login/signup pages), else the Home. */
export function organizerLanding(next: string | null | undefined): string {
  const n = sanitizeNext(next);
  if (!n) return '/dashboard/overview';
  const path = n.split(/[?#]/)[0];
  if (path === '/dashboard/login' || path === '/dashboard/signup') return '/dashboard/overview';
  if (path === '/dashboard' || path.startsWith('/dashboard/')) return n;
  return '/dashboard/overview';
}

/** The login page each intent reports errors on. */
export function errorPage(intent: GoogleIntent): string {
  return intent === 'admin' ? '/admin/login' : intent === 'signup' ? '/dashboard/signup' : '/dashboard/login';
}

export interface StatePayload { i: GoogleIntent; n: string | null }

export function encodeState(secret: string, nonce: string, intent: GoogleIntent, next: string | null) {
  const payload = Buffer.from(JSON.stringify({ i: intent, n: sanitizeNext(next) })).toString('base64url');
  const state = `${nonce}.${payload}`;
  return { state, cookie: `${state}.${hmac(secret, 'g-state:', state)}` };
}

/** Verify the callback's `state` against the cookie. Returns the decoded payload
    or null on ANY mismatch (missing, forged mac, swapped intent, bad JSON). */
export function verifyState(secret: string, cookie: string | null | undefined, state: string | null | undefined): StatePayload | null {
  const raw = String(cookie || '');
  const parts = raw.split('.');
  if (parts.length !== 3 || !state) return null;
  const [nonce, payload, mac] = parts;
  if (!nonce || !payload || !mac) return null;
  const signed = `${nonce}.${payload}`;
  if (!safeEq(signed, String(state))) return null;
  if (!safeEq(mac, hmac(secret, 'g-state:', signed))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return { i: parseIntent(p?.i), n: sanitizeNext(p?.n) };
  } catch {
    return null;
  }
}

/** UNVERIFIED peek at the intent, used ONLY to choose which login page an error
    is reported on (one of three fixed paths) when the state itself failed. */
export function peekIntent(cookie: string | null | undefined): GoogleIntent {
  const parts = String(cookie || '').split('.');
  if (parts.length !== 3) return 'admin';
  try {
    return parseIntent(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.i);
  } catch {
    return 'admin';
  }
}

/* ── Signup ticket ─────────────────────────────────────────────────────────────
   After "Continue with Google" on the signup page the verified Google identity is
   parked in a short-lived signed cookie (path /api/org) that POST /api/org/register
   reads: the email/name are locked to what Google verified, and the `sub` is stored
   on the new user. The phone OTP is still required — phone stays the identity. */
export interface SignupTicket { sub: string; email: string; name: string | null; exp: number }

export function encodeTicket(secret: string, t: SignupTicket): string {
  const payload = Buffer.from(JSON.stringify(t)).toString('base64url');
  return `${payload}.${hmac(secret, 'g-signup:', payload)}`;
}

export function verifyTicket(secret: string, raw: string | null | undefined, now = Date.now()): SignupTicket | null {
  const [payload, mac, extra] = String(raw || '').split('.');
  if (!payload || !mac || extra !== undefined) return null;
  if (!safeEq(mac, hmac(secret, 'g-signup:', payload))) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!t || typeof t.sub !== 'string' || typeof t.email !== 'string' || !t.sub || !t.email) return null;
    if (!(Number(t.exp) > now)) return null;
    return { sub: t.sub, email: t.email.toLowerCase(), name: typeof t.name === 'string' ? t.name : null, exp: Number(t.exp) };
  } catch {
    return null;
  }
}

/* ── claims → session decision ─────────────────────────────────────────────── */

export interface CandidateUser { id: string; email: string | null; googleSub: string | null }
export interface CandidateMembership {
  organizerId: string;
  organizerHandle: string;
  role: string;
  status: string | null;
  kycStatus: string | null;
}
export interface LegacyOrg { handle: string; status: string | null; kycStatus: string | null }

export interface DecideInput {
  intent: GoogleIntent;
  claims: { sub: string; email: string; name?: string | null };
  /** admin intent only: the BS141 allowlist verdict, computed by the caller. */
  adminAllowed?: boolean;
  /** app_user whose google_sub = claims.sub (+ its memberships). */
  bySub?: { user: CandidateUser; memberships: CandidateMembership[] } | null;
  /** app_user whose lower(email) = claims.email (+ its memberships). */
  byEmail?: { user: CandidateUser; memberships: CandidateMembership[] } | null;
  /** Legacy organizer row by contact email — consulted only when no user matched. */
  legacyOrg?: LegacyOrg | null;
}

export type Decision =
  | { kind: 'admin' }
  | { kind: 'organizer'; userId: string; linkSub: boolean; memberships: CandidateMembership[]; acting: CandidateMembership; matchedBy: 'sub' | 'email' }
  | { kind: 'legacy'; org: LegacyOrg }
  | { kind: 'signup' }
  | { kind: 'error'; error: 'not_allowed' | 'no_account' | 'suspended' | 'google_mismatch' };

/** Pure: which session (if any) a verified Google identity earns for an intent.
    The INTENT decides — an email that is both admin-allowlisted and an organizer
    gets an admin session from the admin page and an organizer session from the
    organizer pages. Sign-in NEVER creates an organizer: no match → no_account
    (org) or a signup ticket (signup). */
export function decideGoogle(input: DecideInput): Decision {
  if (input.intent === 'admin') return input.adminAllowed ? { kind: 'admin' } : { kind: 'error', error: 'not_allowed' };

  // 1. sub first (stable even if the Google account's email later changes).
  // 2. then email — but never adopt a user already linked to a DIFFERENT Google sub.
  let match: { user: CandidateUser; memberships: CandidateMembership[]; by: 'sub' | 'email' } | null = null;
  if (input.bySub) match = { ...input.bySub, by: 'sub' };
  else if (input.byEmail) {
    const linked = input.byEmail.user.googleSub;
    if (linked && linked !== input.claims.sub) return { kind: 'error', error: 'google_mismatch' };
    match = { ...input.byEmail, by: 'email' };
  }

  if (match && match.memberships.length) {
    // Same acting-org rule as POST /api/org/login: first membership (owner-first).
    const acting = match.memberships[0];
    if (acting.status === 'suspended') return { kind: 'error', error: 'suspended' };
    return {
      kind: 'organizer',
      userId: match.user.id,
      linkSub: match.by === 'email' && !match.user.googleSub,
      memberships: match.memberships,
      acting,
      matchedBy: match.by,
    };
  }

  // No user with a membership. A legacy organizer (backfill not run) whose
  // contact email matches still gets in — same fallback as password login.
  if (!match && input.legacyOrg) {
    if (input.legacyOrg.status === 'suspended') return { kind: 'error', error: 'suspended' };
    return { kind: 'legacy', org: input.legacyOrg };
  }

  return input.intent === 'signup' ? { kind: 'signup' } : { kind: 'error', error: 'no_account' };
}
