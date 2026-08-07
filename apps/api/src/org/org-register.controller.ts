import {
  BadRequestException, Body, ConflictException, Controller, Get, Post, Query, Req, Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { db, resolveCommissionRate, verifyOtp } from '@zora/core';
import { OrganizerRepo, publicOrganizer } from '../storage/organizer-repo';
import { SessionService } from '../common/session.module';
import { AuditService } from '../audit/audit.module';
import { normalizeTzPhone, isValidTzMsisdn } from '../common/phone';
import { HANDLE_MAX, handleIssue, handleIssueMessage, normalizeHandle } from '../common/handles';

/* BS41 (#4) — ORGANIZER SELF-REGISTRATION over phone-OTP.

   Google OAuth is deliberately absent (LOCKED, deferred): phone is the identity
   that actually works here, and OAuth is the one genuinely new dependency in the
   lane. This endpoint is shaped so the provider slots in later behind the same
   POST without a rewrite — swap "prove the phone" for "prove the Google sub" and
   everything after it is unchanged.

   The OTP is NOT re-implemented. The code is requested through the existing
   consumer endpoint POST /api/otp/request (same throttle, same SMS sender, same
   otp_challenge table) and verified here with the same @zora/core verifyOtp the
   consumer path calls. What this endpoint does NOT do is go through
   POST /api/otp/verify: that mints a CONSUMER session (zora_buyer) as its side
   effect, and an organizer signup should not silently hand out a buyer identity
   — nor should account creation depend on a 7-day cookie that was minted for a
   different purpose. Verification and creation happen in ONE call, so a proven
   phone can never be replayed into a second organizer.

   Ordering inside register() matters and is not accidental:
     validate → reserved? → taken? → THEN verify the OTP → THEN insert.
   The OTP is single-use, so verifying it before the cheap, deterministic checks
   would burn the user's code on a typo'd handle and force a fresh SMS. */
@Controller('org')
export class OrgRegisterController {
  constructor(
    private readonly organizers: OrganizerRepo,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /* ── GET /api/org/handle-available?handle=x ─────────────────────────────────
     Powers the live picker. Public on purpose: every answer it gives is already
     public information (a taken handle resolves to a storefront anyone can load),
     so gating it would buy nothing and would mean the picker could not run before
     an account exists — which is the entire point. */
  @Get('handle-available')
  async handleAvailable(@Query('handle') raw: string) {
    const handle = normalizeHandle(raw);
    const issue = handleIssue(handle);
    if (issue) {
      return { handle, available: false, reason: issue, message: handleIssueMessage(issue) };
    }
    if (await this.organizers.handleTaken(handle)) {
      return { handle, available: false, reason: 'taken', message: handleIssueMessage('taken') };
    }
    return { handle, available: true, reason: null, message: `zora.com/${handle} is yours.` };
  }

  /* ── POST /api/org/register ───────────────────────────────────────────────
     { phone, code, name, handle, password? } → a pending organizer + a session
     in the SAME shape POST /api/org/login mints, so every downstream surface
     (OrganizerGuard, /api/org/me, the dashboard gate in middleware) treats a
     self-signup exactly like any other organizer. The row lands
     status:'pending' + kycStatus:'unverified', which is what the existing gates
     read: publishing a sellable drop (assertKycApproved, I6) and requesting a
     payout (#7's not_verified) both refuse until #5 approves. Drafts are
     deliberately allowed — the pending state must not be a dead end. */
  @Post('register')
  async register(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // ── name ──
    const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (name.length < 2) {
      throw new BadRequestException({ error: 'name_required', message: 'Enter your organization’s name.' });
    }

    // ── handle (structure + reserved) ──
    const handle = normalizeHandle(body?.handle);
    const issue = handleIssue(handle);
    if (issue) {
      // 'reserved' is its own typed code so the UI can colour the field red and
      // say WHY, rather than showing a generic "invalid".
      throw new BadRequestException({
        error: issue === 'reserved' ? 'handle_reserved' : 'handle_invalid',
        message: handleIssueMessage(issue),
      });
    }
    if (await this.organizers.handleTaken(handle)) {
      throw new ConflictException({ error: 'handle_taken', message: handleIssueMessage('taken') });
    }

    // ── phone ──
    const phone = normalizeTzPhone(String(body?.phone ?? ''));
    if (!isValidTzMsisdn(phone)) {
      throw new BadRequestException({ error: 'phone_required', message: 'Enter a valid mobile number.' });
    }

    // ── optional password ──
    // Registration proves a PHONE, so a password is not required to create the
    // account. It is offered (and the signup screen asks for one) purely so the
    // organizer has a way back in: /api/org/login is handle+password, and an
    // account with no way to sign in again would be the dead end rule 4b warns
    // about. Admins can still set one later via PUT /api/organizers/:id/password.
    const rawPassword = body?.password == null ? '' : String(body.password);
    if (rawPassword && rawPassword.length < 8) {
      throw new BadRequestException({ error: 'password_too_short', message: 'Password must be at least 8 characters.' });
    }
    const passwordHash = rawPassword ? bcrypt.hashSync(rawPassword, 10) : null;

    const email = body?.email ? String(body.email).trim().slice(0, 160) : null;

    // ── prove the phone (single-use; consumed here) ──
    const code = String(body?.code ?? '');
    const verdict = await verifyOtp(db(), phone, code);
    if (!verdict.ok) {
      throw new UnauthorizedException({
        error: verdict.reason, // 'expired' | 'wrong_code' | 'too_many_attempts'
        message:
          verdict.reason === 'expired'
            ? 'That code expired — send a new one.'
            : verdict.reason === 'too_many_attempts'
              ? 'Too many tries. Request a fresh code.'
              : 'Wrong code — check the SMS and try again.',
        ...(verdict.attemptsLeft != null ? { attemptsLeft: verdict.attemptsLeft } : {}),
      });
    }

    // ── create ──
    // Slug id, derived from the (unique) handle so the id is unique for free and
    // stays greppable in the audit trail. 'o-' prefix keeps it clear of the
    // seeded o1..o4 ids.
    const id = ('o-' + handle).slice(0, 2 + HANDLE_MAX);
    let org;
    try {
      org = await this.organizers.createSelfSignup({ id, name, handle, phone, email, passwordHash });
    } catch (e: any) {
      // The picker→insert race: someone else took the handle in between. The
      // database is the referee, so translate its verdict instead of trusting
      // the check above.
      if (String(e?.code) === '23505') {
        throw new ConflictException({ error: 'handle_taken', message: handleIssueMessage('taken') });
      }
      throw e;
    }

    // Same session shape as POST /api/org/login.
    this.sessions.set(res, {
      organizerHandle: org.handle,
      role: 'organizer',
      kycStatus: org.kycStatus ?? undefined,
    });

    await this.audit.record('org_self_register', `${org.name} (${org.handle}) · pending verification`, req.ip, org.handle);

    return {
      ok: true,
      organizer: publicOrganizer(org, resolveCommissionRate(null, org)),
      // Echoed at the top level so the client never has to dig for the two facts
      // the next screen renders: where to go, and why it is locked.
      handle: org.handle,
      status: org.status,
      kycStatus: org.kycStatus,
    };
  }
}
