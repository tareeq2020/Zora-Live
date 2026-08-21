import { BadRequestException, ConflictException, Body, Controller, ForbiddenException, Get, Module, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { db, requestOtp, verifyOtp, sendSms, sendEmail } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { OrganizerRepo } from '../storage/organizer-repo';
import { AuthUsersRepo } from '../storage/auth-users.repo';
import { SessionService } from '../common/session.module';
import { SessionGuard } from '../common/session.guard';
import { normalizeTzPhone, isValidTzMsisdn } from '../common/phone';
import type { SessionMembership } from '../common/session-cookie';

const ADMIN_FALLBACK = { username: 'admin', passwordHash: '' };

// BS102 — a pragmatic email check (one @, non-empty local + domain-with-dot).
function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}
// Namespaced OTP identifiers so an account-change challenge is disjoint from a
// login/consumer OTP (which key on the raw phone) — a code minted for one flow
// can never be replayed into another.
const emailOtpId = (email: string) => `chg-email:${String(email || '').trim().toLowerCase()}`;
const phoneOtpId = (phone: string) => `chg-phone:${String(phone || '').trim()}`;

@Controller()
export class AuthController {
  constructor(
    private readonly entities: EntityStore,
    private readonly organizers: OrganizerRepo,
    private readonly authUsers: AuthUsersRepo,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  async login(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const { username, password } = body || {};
    const acct = await this.entities.read('admin', ADMIN_FALLBACK);
    // bcrypt hash ($2a$...) — verifier stays bcrypt-compatible.
    if (username === acct.username && bcrypt.compareSync(password || '', acct.passwordHash)) {
      // role:'admin' is additive — legacy consumers still read isAdmin.
      this.sessions.set(res, { isAdmin: true, role: 'admin' });
      return { ok: true };
    }
    throw new UnauthorizedException({ error: 'Wrong username or password' });
  }

  // PR-F-AUTH: real ORGANIZER login. Authenticates handle+password against the
  // 'organizers' collection (bcrypt passwordHash, mirroring the admin account) and
  // mints an organizer session. Suspended accounts and password-less records are
  // rejected. DEFER (comes with the app.zorapass.com move): CSRF token issuance and
  // the cross-subdomain impersonation handoff — the path-prefix phase is
  // same-origin with SameSite=Lax, an adequate baseline, and CSRF now would break
  // the curl-based e2e for no current benefit.
  // ── POST /api/org/login — DUAL-PATH login (BS93 Phase 2, E3 / D1) ─────────────
  // One "Email or handle" field (`identifier`; `handle` still accepted as an alias
  // so the legacy body {handle,password} keeps working). Resolution order:
  //   (a) email  → app_user by lower(email);
  //   (b) handle → organizer.handle → owner membership → app_user;
  //   (c) FALLBACK → the legacy organizer.password_hash, EXACTLY as before, when no
  //       app_user exists yet (prod backfill not run). This is what stops a live
  //       organizer being locked out mid-migration.
  // On the user path the new session shape is set (userId + globalRoles +
  // memberships + actingOrganizerId) AND organizerHandle is kept populated (= the
  // acting org's handle) so every existing endpoint keeps working. Suspended orgs
  // are still refused on every path.
  @Post('org/login')
  async orgLogin(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const identifier = String(body?.identifier ?? body?.handle ?? '').trim();
    const password = String(body?.password ?? '');
    if (!identifier || !password) throw new UnauthorizedException({ error: 'Wrong handle or password' });
    const isEmail = identifier.includes('@');

    // ── (a)/(b) USER-based auth against the Phase-1 tables ────────────────────
    let user = null as Awaited<ReturnType<AuthUsersRepo['byEmail']>>;
    let handleOrg = null as Awaited<ReturnType<OrganizerRepo['byHandle']>>;
    if (isEmail) {
      user = await this.authUsers.byEmail(identifier);
    } else {
      handleOrg = await this.organizers.byHandle(identifier);
      if (handleOrg) user = await this.authUsers.ownerUserByOrganizerId(handleOrg.id);
    }

    if (user && user.passwordHash && bcrypt.compareSync(password, user.passwordHash)) {
      const [rows, globalRoles] = await Promise.all([
        this.authUsers.membershipsOf(user.id),
        this.authUsers.globalRolesOf(user.id),
      ]);
      const memberships: SessionMembership[] = rows.map((m) => ({
        organizerId: m.organizerId,
        organizerHandle: m.organizerHandle,
        role: m.role,
      }));
      // Acting org = the handle they logged in with (b), else the first membership
      // (owner-first ordered). A pure super_admin with no org has none — fine.
      let acting = handleOrg ? rows.find((m) => m.organizerId === handleOrg!.id) ?? null : null;
      if (!acting) acting = rows[0] ?? null;
      if (acting && acting.status === 'suspended') throw new UnauthorizedException({ error: 'Account suspended' });

      this.sessions.set(res, {
        userId: user.id,
        globalRoles,
        memberships,
        actingOrganizerId: acting ? acting.organizerId : undefined,
        organizerHandle: acting ? acting.organizerHandle : undefined, // keep legacy field live
        role: 'organizer',
        kycStatus: acting ? acting.kycStatus ?? undefined : undefined,
      });
      return { ok: true };
    }

    // ── (c) LEGACY fallback: organizer.password_hash (backfill not run) ────────
    // TODO(phase-2.5): the spec retires organizer.password_hash in Phase 2, but that
    // is only safe AFTER the prod backfill has run and login parity is proven. This
    // fallback DEPENDS on the column, so it stays until Phase 2.5.
    const org = handleOrg ?? (isEmail ? await this.organizers.byEmail(identifier) : await this.organizers.byHandle(identifier));
    if (
      org &&
      org.status !== 'suspended' &&
      org.passwordHash &&
      bcrypt.compareSync(password, org.passwordHash)
    ) {
      this.sessions.set(res, { organizerHandle: org.handle, role: 'organizer', kycStatus: org.kycStatus ?? undefined });
      return { ok: true };
    }
    throw new UnauthorizedException({ error: 'Wrong handle or password' });
  }

  // ── POST /api/me/acting-org — switch the acting organizer (BS93 Phase 2, E6) ──
  // Validated against the caller's OWN memberships (from the session, never the
  // body's authority): repoints actingOrganizerId + organizerHandle so every
  // org-scoped read now resolves the chosen org. 403 if not a member.
  @Post('me/acting-org')
  async setActingOrg(@Req() req: Request, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    const s = req.session || {};
    const organizerId = String(body?.organizerId ?? '').trim();
    const memberships = Array.isArray(s.memberships) ? s.memberships : [];
    if (!s.userId || memberships.length === 0) throw new UnauthorizedException({ error: 'Not logged in' });
    const m = memberships.find((x) => x.organizerId === organizerId);
    if (!m) throw new ForbiddenException({ error: 'not_a_member', message: 'You are not a member of that organizer.' });

    const org = await this.organizers.byId(m.organizerId);
    this.sessions.set(res, {
      ...s,
      actingOrganizerId: m.organizerId,
      organizerHandle: m.organizerHandle,
      role: 'organizer',
      kycStatus: org?.kycStatus ?? undefined,
    });
    return { ok: true, actingOrganizerId: m.organizerId, organizerHandle: m.organizerHandle };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    this.sessions.clear(res);
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    // Role-aware superset of the legacy { isAdmin } shape (purely additive).
    const s = req.session || {};
    // BS96 (Phase 4, C) — the account menu + page need the signed-in email/name.
    // Read from app_user only for a user-based session; legacy/admin sessions carry
    // no userId → email/name stay null (the menu shows a graceful label + Log out).
    let email: string | null = null;
    let name: string | null = null;
    let phone: string | null = null;
    if (s.userId) {
      const profile = await this.authUsers.profileById(s.userId);
      email = profile?.email ?? null;
      name = profile?.username ?? null;
      phone = profile?.phone ?? null;
    }
    return {
      isAdmin: !!s.isAdmin,
      role: s.role || (s.isAdmin ? 'admin' : null),
      organizerHandle: s.organizerHandle || null,
      impersonating: s.impersonating || null,
      // BS93 (Phase 2) — additive: the switcher UI reads memberships to decide
      // whether to render (only when >1). Empty/null for legacy + admin sessions.
      userId: s.userId || null,
      globalRoles: Array.isArray(s.globalRoles) ? s.globalRoles : [],
      memberships: Array.isArray(s.memberships) ? s.memberships : [],
      actingOrganizerId: s.actingOrganizerId || null,
      // BS96 (Phase 4, C) — identity for the account surface (null for legacy/admin).
      email,
      name,
      phone,
    };
  }

  // ── POST /api/me/password { currentPassword, newPassword } (BS96 Phase 4, C) ──
  // Change the signed-in user's password. ANY authenticated session (no @Roles):
  //   · verify currentPassword against the app_user (or, if there is no user yet,
  //     the legacy organizer.password_hash of the acting org — the transition
  //     fallback, so an org that predates the user backfill can still rotate);
  //   · write the new hash to app_user.password_hash AND mirror it to the acting
  //     organizer.password_hash, so BOTH the email/handle user login and the legacy
  //     handle fallback stay consistent through the migration.
  @Post('me/password')
  async changePassword(@Req() req: Request, @Body() body: any) {
    const s = req.session || {};
    if (!s.userId && !s.organizerHandle) throw new UnauthorizedException({ error: 'Not logged in' });

    const currentPassword = String(body?.currentPassword ?? '');
    const newPassword = String(body?.newPassword ?? '');
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException({ error: 'weak_password', message: 'New password must be at least 8 characters.' });
    }

    const user = s.userId ? await this.authUsers.byId(s.userId) : null;
    const org = s.organizerHandle ? await this.organizers.byHandle(s.organizerHandle) : null;

    // Verify the current password: the app_user hash is authoritative; fall back to
    // the acting organizer's legacy hash only when there is no user hash to check.
    let verified = false;
    if (user && user.passwordHash) verified = bcrypt.compareSync(currentPassword, user.passwordHash);
    else if (org && org.passwordHash) verified = bcrypt.compareSync(currentPassword, org.passwordHash);
    if (!verified) throw new UnauthorizedException({ error: 'wrong_password', message: 'Current password is wrong.' });

    const hash = bcrypt.hashSync(newPassword, 10);
    if (user) await this.authUsers.setPasswordForUser(user.id, hash);
    // Mirror to the acting organizer so the legacy handle-login fallback matches.
    if (org) await this.organizers.setPasswordHash(org.id, hash);
    return { ok: true };
  }

  // ── Change EMAIL — two steps, OTP to the NEW address (BS102) ────────────────
  // Email is the login identity, so this is the strongest gate:
  //   request: re-auth with the current password (identity) + confirm the new
  //     address is free, then OTP the NEW email (proof the user owns it);
  //   confirm: verify the code against the new email and write it.
  // Only a real app_user session can do this (legacy handle → no identity to move).
  // The OTP identifier is namespaced so a login/consumer OTP can never satisfy it.
  @Post('me/email/request')
  async emailChangeRequest(@Req() req: Request, @Body() body: any) {
    const user = await this.requireUser(req);
    const currentPassword = String(body?.currentPassword ?? '');
    if (!user.passwordHash || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException({ error: 'wrong_password', message: 'Current password is wrong.' });
    }
    const newEmail = String(body?.newEmail ?? '').trim();
    if (!isEmail(newEmail)) throw new BadRequestException({ error: 'invalid_email', message: 'Enter a valid email address.' });
    if (newEmail.toLowerCase() === String(user.email ?? '').toLowerCase()) {
      throw new BadRequestException({ error: 'same_email', message: "That's already your email." });
    }
    const taken = await this.authUsers.byEmail(newEmail);
    if (taken && taken.id !== user.id) throw new ConflictException({ error: 'email_taken', message: 'That email is already in use.' });

    const r = await requestOtp(db(), emailOtpId(newEmail));
    if (!r.ok) throw new BadRequestException({ error: 'throttled', message: 'Too many codes requested. Wait a minute and try again.' });
    try {
      await sendEmail(
        newEmail,
        'Your Zora verification code',
        `<p>Your Zora code is <b>${r.code}</b>. It expires in 5 minutes.</p><p>Enter it in Zora to confirm this as your new sign-in email. If you didn't request this, ignore this email.</p>`,
      );
    } catch (e) { console.error('email-change otp send failed', e); }
    return { ok: true, expiresInSec: r.expiresInSec, ...(process.env.OTP_ECHO === 'true' ? { code: r.code } : {}) };
  }

  @Post('me/email/confirm')
  async emailChangeConfirm(@Req() req: Request, @Body() body: any) {
    const user = await this.requireUser(req);
    const newEmail = String(body?.newEmail ?? '').trim();
    const code = String(body?.code ?? '');
    if (!isEmail(newEmail)) throw new BadRequestException({ error: 'invalid_email' });
    const v = await verifyOtp(db(), emailOtpId(newEmail), code);
    if (!v.ok) throw new UnauthorizedException({ error: v.reason, ...(v.attemptsLeft != null ? { attemptsLeft: v.attemptsLeft } : {}) });
    // Re-check uniqueness at write time (someone may have taken it since request).
    const taken = await this.authUsers.byEmail(newEmail);
    if (taken && taken.id !== user.id) throw new ConflictException({ error: 'email_taken', message: 'That email was just taken. Try another.' });
    try {
      await this.authUsers.setEmail(user.id, newEmail);
    } catch {
      throw new ConflictException({ error: 'email_taken', message: 'That email is already in use.' });
    }
    return { ok: true, email: newEmail };
  }

  // ── Change PHONE — two steps, OTP by SMS to the NEW number (BS102) ───────────
  // The phone is a contact field, not a login credential, so the live session is
  // sufficient identity; OTP to the new number proves ownership.
  @Post('me/phone/request')
  async phoneChangeRequest(@Req() req: Request, @Body() body: any) {
    await this.requireUser(req);
    const phone = normalizeTzPhone(String(body?.phone ?? body?.newPhone ?? ''));
    if (!isValidTzMsisdn(phone)) throw new BadRequestException({ error: 'phone_required', message: 'Enter a valid phone number.' });
    const r = await requestOtp(db(), phoneOtpId(phone));
    if (!r.ok) throw new BadRequestException({ error: 'throttled', message: 'Too many codes requested. Wait a minute and try again.' });
    try { await sendSms(phone, `Your Zora code is ${r.code}. Expires in 5 min. Never share it.`); }
    catch (e) { console.error('phone-change otp send failed', e); }
    return { ok: true, expiresInSec: r.expiresInSec, ...(process.env.OTP_ECHO === 'true' ? { code: r.code } : {}) };
  }

  @Post('me/phone/confirm')
  async phoneChangeConfirm(@Req() req: Request, @Body() body: any) {
    const user = await this.requireUser(req);
    const phone = normalizeTzPhone(String(body?.phone ?? body?.newPhone ?? ''));
    const code = String(body?.code ?? '');
    if (!isValidTzMsisdn(phone)) throw new BadRequestException({ error: 'phone_required' });
    const v = await verifyOtp(db(), phoneOtpId(phone), code);
    if (!v.ok) throw new UnauthorizedException({ error: v.reason, ...(v.attemptsLeft != null ? { attemptsLeft: v.attemptsLeft } : {}) });
    await this.authUsers.setPhone(user.id, phone);
    return { ok: true, phone };
  }

  /** BS102: the app_user behind the session, or a 400 for a legacy/anon session
      (no identity row to change email/phone on). */
  private async requireUser(req: Request) {
    const s = req.session || {};
    if (!s.userId) throw new BadRequestException({ error: 'no_identity', message: 'This account is on a legacy login. Ask a Zora admin to finish upgrading it before changing your email or phone.' });
    const user = await this.authUsers.byId(s.userId);
    if (!user) throw new UnauthorizedException({ error: 'not_logged_in', message: 'Sign in again to continue.' });
    return user;
  }

  @UseGuards(SessionGuard)
  @Post('password')
  async password(@Body() body: any) {
    const { current, next } = body || {};
    const acct = await this.entities.read('admin', ADMIN_FALLBACK);
    if (!bcrypt.compareSync(current || '', acct.passwordHash)) {
      throw new BadRequestException({ error: 'Current password is wrong' });
    }
    if (!next || next.length < 8) {
      throw new BadRequestException({ error: 'New password must be at least 8 characters' });
    }
    acct.passwordHash = bcrypt.hashSync(next, 10);
    await this.entities.write('admin', acct);
    return { ok: true };
  }
}

@Module({ controllers: [AuthController] })
export class AuthModule {}
