import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { signSession, verifySession } from './session-cookie';
import { resolveSessionSecret } from './secret';

/* BS4: consumer identity — a SEPARATE session from the privileged zora_session
   (A3). A shopper who signs in via SMS-OTP gets a `zora_buyer` cookie carrying
   only { role:'consumer', phone, customerId }; they never hold the admin/organizer
   cookie shape. Signed + verified with the same HMAC primitive (SESSION_SECRET). */

export const CONSUMER_COOKIE = 'zora_buyer';
const CONSUMER_MAXAGE = 1000 * 60 * 60 * 24 * 7; // 7d

export interface ConsumerIdentity { phone: string; customerId: string }

/** Read one named cookie from the raw header (session-cookie only reads zora_session). */
export function readNamedCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function mintConsumerCookie(res: Response, id: ConsumerIdentity): void {
  const secret = resolveSessionSecret();
  const token = signSession({ role: 'consumer', phone: id.phone, customerId: id.customerId, verified: true } as any, secret);
  res.cookie(CONSUMER_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: CONSUMER_MAXAGE,
  });
}

export function readConsumer(req: Request): ConsumerIdentity | null {
  const token = readNamedCookie(req, CONSUMER_COOKIE);
  const payload: any = verifySession(token, resolveSessionSecret());
  if (!payload || payload.role !== 'consumer' || !payload.customerId) return null;
  return { phone: payload.phone, customerId: payload.customerId };
}

@Injectable()
export class ConsumerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const consumer = readConsumer(req);
    if (!consumer) throw new UnauthorizedException({ error: 'not_signed_in' });
    (req as any).consumer = consumer;
    return true;
  }
}
