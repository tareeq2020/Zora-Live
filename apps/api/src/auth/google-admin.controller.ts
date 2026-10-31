import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { publicWebOrigin } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { SessionService } from '../common/session.module';
import { resolveSessionSecret } from '../common/secret';
import { DEFAULT_SETTINGS } from '../common/defaults';
import { OrganizerRepo } from '../storage/organizer-repo';
import { AuthUsersRepo } from '../storage/auth-users.repo';
import { AuditService } from '../audit/audit.module';
import type { SessionMembership } from '../common/session-cookie';
import {
  type CandidateMembership, type GoogleIntent, decideGoogle, encodeState, encodeTicket, errorPage,
  organizerLanding, parseIntent, peekIntent, sanitizeNext, verifyState,
} from './google-flow';

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
   <PUBLIC_WEB_ORIGIN>/api/auth/google/callback (the web app proxies /api).

   BS148: the SAME start/callback now also serves ORGANIZERS — no new redirect URI.
   GET /api/auth/google/start?intent=org|signup&next=/dashboard/... carries the
   intent + a sanitized relative `next` inside the HMAC-signed state (see
   google-flow.ts). No intent = admin, exactly as before. The callback verifies the
   identity once, then the intent decides: admin → the BS141 allowlist (unchanged);
   org → match an existing app_user by google_sub, then verified email, and mint
   the SAME session shape POST /api/org/login mints (no match → no_account; sign-in
   never creates an organizer); signup → an existing organizer just signs in,
   otherwise a short-lived signed ticket cookie hands the verified email/name/sub to
   /dashboard/signup, where the phone OTP still proves the account. */

const STATE_COOKIE = 'zora_g_state';
const STATE_PATH = '/api/auth/google';
/** BS148: the verified Google identity handed to POST /api/org/register. */
export const SIGNUP_COOKIE = 'zora_g_signup';
export const SIGNUP_PATH = '/api/org';
const SIGNUP_TTL_MS = 30 * 60 * 1000;

function cfg() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret, enabled: !!(clientId && clientSecret), redirectUri: `${publicWebOrigin()}/api/auth/google/callback` };
}

export const cookieOpts = (path: string, maxAge: number) => ({
  httpOnly: true, sameSite: 'lax' as const, secure: process.env.COOKIE_SECURE === 'true', path, maxAge,
});

export function readCookie(req: Request, name: string): string {
  return (String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(name + '=')) || '').slice(name.length + 1);
}

@Controller('auth/google')
export class GoogleAdminController {
  constructor(
    private readonly entities: EntityStore,
    private readonly sessions: SessionService,
    private readonly organizers: OrganizerRepo,
    private readonly authUsers: AuthUsersRepo,
    private readonly audit: AuditService,
  ) {}

  @Get('config')
  config() {
    return { enabled: cfg().enabled };
  }

  @Get('start')
  start(@Query('intent') rawIntent: string, @Query('next') rawNext: string, @Res() res: Response) {
    const c = cfg();
    const intent = parseIntent(rawIntent);
    if (!c.enabled) return res.redirect(302, `${errorPage(intent)}?error=google_off`);
    const nonce = randomBytes(24).toString('base64url');
    const { state, cookie } = encodeState(resolveSessionSecret(), nonce, intent, sanitizeNext(rawNext));
    res.cookie(STATE_COOKIE, cookie, cookieOpts(STATE_PATH, 10 * 60 * 1000));
    const q = new URLSearchParams({
      client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
    });
    return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    const raw = readCookie(req, STATE_COOKIE);
    let intent: GoogleIntent = peekIntent(raw); // UNVERIFIED — only picks which login page shows the error
    const fail = (why: string) => {
      res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
      return res.redirect(302, `${errorPage(intent)}?error=${encodeURIComponent(why)}`);
    };
    const c = cfg();
    if (!c.enabled) return fail('google_off');
    const verified = verifyState(resolveSessionSecret(), raw, state);
    if (!verified) return fail('state');
    intent = verified.i;
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
      const claims = (await info.json()) as { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string | boolean; hd?: string; exp?: string; name?: string };
      const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
      const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
      if (claims.aud !== c.clientId || !issOk || !emailVerified || !claims.email) return fail('token');
      if (Number(claims.exp || 0) * 1000 < Date.now()) return fail('token');

      const email = claims.email.toLowerCase();

      if (intent === 'admin') {
        // BS141 — unchanged.
        const settings = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
        const fromSettings = Array.isArray(settings.adminGoogleEmails) ? (settings.adminGoogleEmails as unknown[]).map((e) => String(e).toLowerCase()) : [];
        const fromEnv = (process.env.ADMIN_GOOGLE_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
        const domain = (process.env.ADMIN_GOOGLE_DOMAIN || '').trim().toLowerCase();
        const allowed = fromSettings.includes(email) || fromEnv.includes(email) || (!!domain && (claims.hd || '').toLowerCase() === domain);
        if (!allowed) return fail('not_allowed');

        res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
        this.sessions.set(res, { isAdmin: true, role: 'admin' });
        console.log(`[auth] admin google sign-in: ${email}`);
        return res.redirect(302, '/admin/console/overview');
      }

      if (!claims.sub) return fail('token');
      return await this.organizerCallback(intent, { sub: claims.sub, email, name: claims.name || null }, verified.n, req, res, fail);
    } catch (e) {
      console.error('[auth] google callback failed', (e as Error)?.message);
      return fail('google_error');
    }
  }

  /** BS148: org / signup intents, after the Google identity is verified. */
  private async organizerCallback(
    intent: GoogleIntent,
    claims: { sub: string; email: string; name: string | null },
    next: string | null,
    req: Request,
    res: Response,
    fail: (why: string) => unknown,
  ) {
    const withMemberships = async (u: { id: string; email: string | null } | null, googleSub: string | null) =>
      u ? { user: { id: u.id, email: u.email, googleSub }, memberships: (await this.authUsers.membershipsOf(u.id)) as CandidateMembership[] } : null;

    const subUser = await this.authUsers.byGoogleSub(claims.sub);
    const bySub = await withMemberships(subUser, subUser?.googleSub ?? null);
    let byEmail: Awaited<ReturnType<typeof withMemberships>> = null;
    if (!bySub) {
      const u = await this.authUsers.byEmail(claims.email);
      byEmail = await withMemberships(u, u ? await this.authUsers.googleSubOf(u.id) : null);
    }
    const legacy = !bySub && !byEmail ? await this.organizers.byEmail(claims.email) : null;
    const decision = decideGoogle({
      intent, claims, bySub, byEmail,
      legacyOrg: legacy ? { handle: legacy.handle, status: legacy.status, kycStatus: legacy.kycStatus } : null,
    });

    if (decision.kind === 'error') {
      if (decision.error === 'suspended' || decision.error === 'google_mismatch') {
        await this.audit.record('org_google_login_refused', `${claims.email} · ${decision.error}`, req.ip, 'google');
      }
      return fail(decision.error);
    }

    if (decision.kind === 'signup') {
      const ticket = encodeTicket(resolveSessionSecret(), { sub: claims.sub, email: claims.email, name: claims.name, exp: Date.now() + SIGNUP_TTL_MS });
      res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
      res.cookie(SIGNUP_COOKIE, ticket, cookieOpts(SIGNUP_PATH, SIGNUP_TTL_MS));
      return res.redirect(302, '/dashboard/signup?google=1');
    }

    if (decision.kind === 'legacy') {
      res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
      this.sessions.set(res, { organizerHandle: decision.org.handle, role: 'organizer', kycStatus: decision.org.kycStatus ?? undefined });
      await this.audit.record('org_google_login', `${claims.email} · legacy organizer`, req.ip, decision.org.handle);
      return res.redirect(302, organizerLanding(next));
    }

    if (decision.kind === 'organizer') {
      if (decision.linkSub) await this.authUsers.setGoogleSub(decision.userId, claims.sub);
      const globalRoles = await this.authUsers.globalRolesOf(decision.userId);
      const memberships: SessionMembership[] = decision.memberships.map((m) => ({
        organizerId: m.organizerId, organizerHandle: m.organizerHandle, role: m.role,
      }));
      res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
      // EXACTLY the shape POST /api/org/login mints on its user path.
      this.sessions.set(res, {
        userId: decision.userId,
        globalRoles,
        memberships,
        actingOrganizerId: decision.acting.organizerId,
        organizerHandle: decision.acting.organizerHandle,
        role: 'organizer',
        kycStatus: decision.acting.kycStatus ?? undefined,
      });
      await this.audit.record('org_google_login', `${claims.email} · matched by ${decision.matchedBy}`, req.ip, decision.acting.organizerHandle);
      return res.redirect(302, organizerLanding(next));
    }

    return fail('google_error');
  }
}
