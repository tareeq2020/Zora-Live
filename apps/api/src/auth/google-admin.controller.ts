import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { publicWebOrigin } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { SessionService } from '../common/session.module';
import { resolveSessionSecret } from '../common/secret';
import { DEFAULT_SETTINGS } from '../common/defaults';

/* BS141: Google sign-in as the default admin login (Web Premium v1).

   GET /api/auth/google/config   → { enabled } (login page shows Google first)
   GET /api/auth/google/start    → redirect to Google (state cookie, CSRF)
   GET /api/auth/google/callback → verify state, exchange code, verify the ID
                                   token with Google, check the admin allowlist,
                                   mint the same admin session as password login.

   Allowlist (any match admits): settings.adminGoogleEmails (array, editable by
   an admin), env ADMIN_GOOGLE_EMAILS (comma list), env ADMIN_GOOGLE_DOMAIN
   (hosted domain, e.g. reli.co.tz — checked against the verified `hd` claim).
   Needs env GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET; without them the feature is
   off and password login stays the only path. Password login is kept as the
   break-glass fallback. The callback URL to register in Google Cloud is
   <PUBLIC_WEB_ORIGIN>/api/auth/google/callback (the web app proxies /api). */

const STATE_COOKIE = 'zora_g_state';

function cfg() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret, enabled: !!(clientId && clientSecret), redirectUri: `${publicWebOrigin()}/api/auth/google/callback` };
}

function sign(v: string): string {
  return createHmac('sha256', resolveSessionSecret()).update('g-state:' + v).digest('base64url');
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Controller('auth/google')
export class GoogleAdminController {
  constructor(private readonly entities: EntityStore, private readonly sessions: SessionService) {}

  @Get('config')
  config() {
    return { enabled: cfg().enabled };
  }

  @Get('start')
  start(@Res() res: Response) {
    const c = cfg();
    if (!c.enabled) return res.redirect(302, '/admin/login?error=google_off');
    const nonce = randomBytes(24).toString('base64url');
    res.cookie(STATE_COOKIE, `${nonce}.${sign(nonce)}`, {
      httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/api/auth/google', maxAge: 10 * 60 * 1000,
    });
    const q = new URLSearchParams({
      client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
      scope: 'openid email profile', state: nonce, prompt: 'select_account',
    });
    return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    const fail = (why: string) => {
      res.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
      return res.redirect(302, `/admin/login?error=${encodeURIComponent(why)}`);
    };
    const c = cfg();
    if (!c.enabled) return fail('google_off');
    const raw = (String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(STATE_COOKIE + '=')) || '').slice(STATE_COOKIE.length + 1);
    const [nonce, mac] = raw.split('.');
    if (!nonce || !mac || !state || !safeEq(nonce, String(state)) || !safeEq(mac, sign(nonce))) return fail('state');
    if (!code) return fail('code');

    try {
      const tok = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(code), client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!tok.ok) return fail('exchange');
      const { id_token } = (await tok.json()) as { id_token?: string };
      if (!id_token) return fail('exchange');
      // Google verifies the signature + expiry; we check audience/issuer/email.
      const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`, { signal: AbortSignal.timeout(8000) });
      if (!info.ok) return fail('token');
      const claims = (await info.json()) as { aud?: string; iss?: string; email?: string; email_verified?: string | boolean; hd?: string; exp?: string };
      const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
      const verified = claims.email_verified === true || claims.email_verified === 'true';
      if (claims.aud !== c.clientId || !issOk || !verified || !claims.email) return fail('token');
      if (Number(claims.exp || 0) * 1000 < Date.now()) return fail('token');

      const email = claims.email.toLowerCase();
      const settings = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
      const fromSettings = Array.isArray(settings.adminGoogleEmails) ? (settings.adminGoogleEmails as unknown[]).map((e) => String(e).toLowerCase()) : [];
      const fromEnv = (process.env.ADMIN_GOOGLE_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      const domain = (process.env.ADMIN_GOOGLE_DOMAIN || '').trim().toLowerCase();
      const allowed = fromSettings.includes(email) || fromEnv.includes(email) || (!!domain && (claims.hd || '').toLowerCase() === domain);
      if (!allowed) return fail('not_allowed');

      res.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
      this.sessions.set(res, { isAdmin: true, role: 'admin' });
      console.log(`[auth] admin google sign-in: ${email}`);
      return res.redirect(302, '/admin/console/overview');
    } catch (e) {
      console.error('[auth] google callback failed', (e as Error)?.message);
      return fail('google_error');
    }
  }
}
