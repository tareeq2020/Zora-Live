import * as crypto from 'crypto';
import type { Request, Response, CookieOptions } from 'express';

/* Stateless signed-cookie session (replaces express-session + MemoryStore).
   Payload is base64url(JSON) + '.' + HMAC-SHA256(body, SESSION_SECRET). No server
   store, so it survives restarts and works across instances — and it rides the
   Vercel->API proxy first-party, so the web admin login is unchanged. */

export const COOKIE_NAME = 'zora_session';

// 8h session lifetime (mirrors cookie maxAge below); iat/exp are unix seconds.
export const SESSION_LIFETIME_SEC = 60 * 60 * 8;

export interface ZoraSession {
  isAdmin?: boolean;
  impersonating?: { id: string; name: string; handle: string; startedAt: string } | null;
  // PR-F-AUTH: real ORGANIZER identity. An organizer session carries its handle +
  // role; admin sessions keep isAdmin (role is derived/optional). Additive — legacy
  // admin cookies ({ isAdmin }) remain valid.
  organizerHandle?: string;
  role?: 'admin' | 'organizer';
  kycStatus?: string;
  // Signed-token clock: stamped by signSession, enforced by verifySession.
  iat?: number;
  exp?: number;
}

export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true', // set true when the API is behind HTTPS
    path: '/',
    maxAge: 1000 * 60 * 60 * 8, // 8h
  };
}

export function signSession(payload: ZoraSession, secret: string): string {
  // Stamp a fresh iat/exp on every write (sliding 8h window). Overwrites any
  // iat/exp carried in via `{ ...req.session }` spreads.
  const now = Math.floor(Date.now() / 1000);
  const stamped: ZoraSession = { ...payload, iat: now, exp: now + SESSION_LIFETIME_SEC };
  const body = Buffer.from(JSON.stringify(stamped)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

export function verifySession(token: string | null | undefined, secret: string): ZoraSession | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ZoraSession;
    // Reject expired tokens. A MISSING exp is treated as legacy-valid (cookies
    // signed before this field existed) — backward compat until secret rotation.
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setSessionCookie(res: Response, payload: ZoraSession, secret: string): void {
  res.cookie(COOKIE_NAME, signSession(payload, secret), cookieOptions());
}
export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}
