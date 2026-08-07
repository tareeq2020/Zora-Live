import * as crypto from 'crypto';
import { SCAN_SESSION_TTL_SEC, type ScannerRole } from '@zora/core';
import { resolveSessionSecret } from '../common/secret';

/* The SCANNER SESSION (eng review ARCH-3).

   A scoped, stateless bearer token — deliberately NOT the `zora_session` cookie.
   Three reasons:

     · SCOPE. This token says "agent, event offshore-001" and nothing else. It
       cannot be widened into an admin or organizer session by any code path,
       because no code path reads it as one.
     · SURFACE. The scanner is a PWA that a door agent installs on a personal
       phone. A bearer token in app storage can be dropped by signing out of that
       one device; a shared cookie jar cannot.
     · CSRF. A bearer header is not sent by the browser automatically, so the
       write endpoints (/scan/verify, /scan/confirm) need no separate CSRF story.

   Wire format is the session cookie's, on purpose: base64url(JSON) + '.' +
   HMAC-SHA256. Signed with SESSION_SECRET under a distinct NAMESPACE string, so
   a scanner token can never be replayed as a session cookie or vice versa even
   though they share a secret.

   Rotation binding: the token carries `cv` = the code_rotated_at it was minted
   under. Rotating a scanner user's code therefore kills their live sessions,
   which is what an admin means when they hit NEW CODE mid-shift. */

const SCAN_TOKEN_NAMESPACE = 'zora-scan-session-v1';

export interface ScanSession {
  /** scanner_user.id */
  uid: string;
  name: string;
  role: ScannerRole;
  /** event.id, or null for an unscoped scanner user. */
  scope: string | null;
  /** code_rotated_at (epoch seconds) this token was minted under. */
  cv: number;
  iat: number;
  exp: number;
}

function scanSecret(): string {
  return crypto.createHmac('sha256', resolveSessionSecret()).update(SCAN_TOKEN_NAMESPACE).digest('hex');
}

export function signScanSession(
  payload: Omit<ScanSession, 'iat' | 'exp'>,
  ttlSec = SCAN_SESSION_TTL_SEC,
): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const full: ScanSession = { ...payload, iat: now, exp: now + ttlSec };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', scanSecret()).update(body).digest('base64url');
  return { token: body + '.' + sig, expiresAt: new Date(full.exp * 1000).toISOString() };
}

export function verifyScanSession(token: string | null | undefined): ScanSession | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', scanSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ScanSession;
    // Unlike the admin cookie, a missing exp is NOT tolerated here: there are no
    // legacy scanner tokens to stay compatible with, so an unbounded one is a bug.
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.uid || (payload.role !== 'agent' && payload.role !== 'supervisor')) return null;
    return payload;
  } catch {
    return null;
  }
}

/** `Authorization: Bearer <token>`, with a `x-scan-token` fallback for the
    PWA's offline-replay path (some service-worker fetch shims strip Authorization). */
export function readScanToken(req: { headers: Record<string, any> }): string | null {
  const auth = String(req.headers?.authorization || '');
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim() || null;
  const alt = req.headers?.['x-scan-token'];
  return typeof alt === 'string' && alt.trim() ? alt.trim() : null;
}
