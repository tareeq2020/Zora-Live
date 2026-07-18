import * as crypto from 'crypto';
import type { Request, Response, CookieOptions } from 'express';

/* Stateless signed-cookie session (replaces express-session + MemoryStore).
   Payload is base64url(JSON) + '.' + HMAC-SHA256(body, SESSION_SECRET). No server
   store, so it survives restarts and works across instances — and it rides the
   Vercel->API proxy first-party, so the web admin login is unchanged. */

export const COOKIE_NAME = 'zora_session';

export interface ZoraSession {
  isAdmin?: boolean;
  impersonating?: { id: string; name: string; handle: string; startedAt: string } | null;
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
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
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
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
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
