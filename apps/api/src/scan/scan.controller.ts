import {
  BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus,
  Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  db, authenticateScannerCode, scanCredential, confirmCredential, pendingConfirmations,
  scanTotals, ticketSigningKeys, SCAN_LOCKOUT_WINDOW_SEC,
} from '@zora/core';
import { ScanGuard, ScanRoles } from './scan.guard';
import { signScanSession } from './scan-session';
import { ScannerUserRepo } from '../storage/scanner-user.repo';

/* /api/scan/* — the door API (plan #1).

   Three endpoints, three responsibilities:
     POST /api/scan/session  code → a scoped scanner session   (rate-limited, OV4)
     POST /api/scan/verify   qr   → scanned                    (AGENT only, OV6 gate)
     POST /api/scan/confirm  id   → wristband_issued           (SUPERVISOR only)

   Everything that can go wrong returns a machine-readable `error` code plus a
   plain sentence, because the scanner's whole UI is one giant word and one line
   of reason — it cannot afford to string-match an exception message.

   HTTP status carries meaning here, deliberately:
     409 = the pass is real but the state says no (already scanned / confirmed)
     403 = the ROLE says no (an agent reaching confirm)
     429 = the lockout says no
     422 = the pass itself is bad (forged, unknown, wrong door) */

/* The SOURCE key for the per-source half of the lockout (OV4).

   `x-forwarded-for` is only honoured when TRUST_PROXY=true, because an attacker
   hitting the API host directly can put whatever they like in that header — and
   an unconditionally-trusted XFF turns the per-source lockout into a decoration
   (rotate the header, get a fresh budget). Default is the socket address.

   Residual risk, stated plainly: when the scanner reaches the API through the
   web app's /api proxy, every request shares that proxy's address, so the
   per-source counter is coarse there. The per-CODE counter is the half that
   cannot be evaded — it is keyed on the thing being attacked — and rotating a
   locked code is one tap in the admin panel. */
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

const clientIp = (req: Request): string => {
  if (TRUST_PROXY) {
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  return String(req.ip || req.socket?.remoteAddress || '').trim();
};

/** Pass-level refusals: real HTTP semantics, not a blanket 400.
      409 — the pass is genuine, the STATE says no (this is the replay)
      422 — the pass itself is bad (forged, wrong door, cancelled)
      404 — no such pass (NO MATCH)
      403 — the scanner is not assigned to this event */
const PASS_ERROR_STATUS: Record<string, number> = {
  malformed_qr: 422,
  invalid_signature: 422,
  not_found: 404,
  wrong_event: 422,
  out_of_scope: 403,
  revoked: 422,
  already_scanned: 409,
  already_confirmed: 409,
  not_scanned: 409,
};

/** Credential ids are uuids. Shape-check before the query so a junk id is a
    clean 404 instead of a Postgres cast error surfacing as a 500. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('scan')
export class ScanController {
  constructor(private readonly users: ScannerUserRepo) {}

  /* ── sign-in ───────────────────────────────────────────────────────────────
     The only unauthenticated endpoint in this file, and therefore the only one
     an attacker can hammer. `authenticateScannerCode` records every attempt and
     refuses once a code or a source is over its window (see scan-auth.ts for
     why six digits without a lockout is not authentication). */
  @Post('session')
  @HttpCode(200)
  async createSession(@Body() body: any, @Req() req: Request) {
    const code = String(body?.code ?? '').trim();
    if (!/^\d{4,10}$/.test(code)) {
      // Shape-checked before the exchange so a fat-fingered entry does not burn
      // one of the agent's five real attempts.
      throw new BadRequestException({ error: 'invalid_code', message: 'Enter the 6-digit code from your event manager.' });
    }

    const result = await authenticateScannerCode(db(), { code, ip: clientIp(req) });
    if (!result.ok) {
      if (result.code === 'locked_out') {
        throw new HttpException(
          {
            error: 'locked_out',
            message: result.message,
            retryAfterSec: result.retryAfterSec ?? SCAN_LOCKOUT_WINDOW_SEC,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new UnauthorizedException({ error: result.code, message: result.message });
    }

    const u = result.user;
    const { token, expiresAt } = signScanSession({
      uid: u.id,
      name: u.name,
      role: u.role,
      scope: u.eventScope,
      cv: Math.floor(new Date(u.codeRotatedAt).getTime() / 1000),
    });
    return {
      token,
      expiresAt,
      scanner: { id: u.id, name: u.name, role: u.role, eventScope: u.eventScope },
    };
  }

  /** Who am I / am I still allowed in — the PWA's boot + reconnect check. */
  @Get('me')
  @UseGuards(ScanGuard)
  async me(@Req() req: Request) {
    const s = req.scanner!;
    const totals = await scanTotals(db(), s.eventScope);
    return { scanner: s, totals };
  }

  /* ── the gate (AGENT) ──────────────────────────────────────────────────────
     OV6: this IS admission. A GA pass that lands here `scanned` is in — nothing
     waits on a supervisor. `outcome` tells the PWA which takeover to paint:
     'valid' → solid green, 'needs_supervisor' → the aura gradient. */
  @Post('verify')
  @HttpCode(200)
  @UseGuards(ScanGuard)
  @ScanRoles('agent')
  async verify(@Body() body: any, @Req() req: Request) {
    const qr = String(body?.qr ?? '').trim();
    // The CAMERA-DENIED fallback: the agent types the reference printed on the
    // pass instead of pointing a camera at it.
    const ref = String(body?.ref ?? '').trim();
    if (!qr && !ref) throw new BadRequestException({ error: 'malformed_qr', message: 'Nothing was scanned.' });
    const s = req.scanner!;

    const result = await scanCredential(db(), {
      qr,
      ref,
      actor: { id: s.id, name: s.name, eventScope: s.eventScope },
      keys: ticketSigningKeys(),
      // An explicit door overrides nothing — it only NARROWS. A scanner user
      // pinned to one event can never widen itself by passing an eventId.
      eventId: s.eventScope ?? (body?.eventId ? String(body.eventId) : null),
    });

    if (!result.ok) {
      const payload = {
        error: result.code,
        message: result.message,
        outcome: result.code === 'already_scanned' || result.code === 'already_confirmed' ? 'already_used' : 'invalid',
        pass: result.pass ?? null,
        // The 409 the plan asks for by name: WHO scanned it and WHEN, so the
        // agent can say it out loud instead of shrugging at the guest.
        priorActor: result.pass?.scannedByName ?? result.pass?.confirmedByName ?? null,
        priorAt: result.pass?.confirmedAt ?? result.pass?.scannedAt ?? null,
      };
      throw httpForPass(result.code, payload);
    }
    return { ok: true, outcome: result.outcome, pass: result.pass };
  }

  /* ── the second person (SUPERVISOR) ────────────────────────────────────────
     Selective by OV6: the queue below only surfaces credentials that actually
     need this. Confirming anything not in `scanned` is refused — a supervisor
     must never be able to admit a guest an agent never saw. */
  @Post('confirm')
  @HttpCode(200)
  @UseGuards(ScanGuard)
  @ScanRoles('supervisor')
  async confirm(@Body() body: any, @Req() req: Request) {
    const credentialId = String(body?.credentialId ?? '').trim();
    if (!UUID_RE.test(credentialId)) {
      throw new HttpException({ error: 'not_found', message: 'No pass with that id.' }, HttpStatus.NOT_FOUND);
    }
    const s = req.scanner!;

    const result = await confirmCredential(db(), {
      credentialId,
      actor: { id: s.id, name: s.name, eventScope: s.eventScope },
    });
    if (!result.ok) {
      throw httpForPass(result.code, {
        error: result.code,
        message: result.message,
        pass: result.pass ?? null,
        priorActor: result.pass?.confirmedByName ?? null,
        priorAt: result.pass?.confirmedAt ?? null,
      });
    }
    return { ok: true, pass: result.pass };
  }

  /** The supervisor's calm dark queue: scanned, waiting, oldest first. */
  @Get('pending')
  @UseGuards(ScanGuard)
  @ScanRoles('supervisor')
  async pending(@Req() req: Request, @Query('all') all?: string) {
    const s = req.scanner!;
    const passes = await pendingConfirmations(db(), {
      eventId: s.eventScope,
      onlyRequiresConfirm: all !== '1',
      limit: 100,
    });
    return { pending: passes, selective: all !== '1' };
  }
}

/** The ONE place a pass-level error code becomes an HTTP status, so /verify and
    /confirm can never drift on what "already used" means over the wire. */
function httpForPass(code: string, payload: Record<string, unknown>): HttpException {
  return new HttpException(payload, PASS_ERROR_STATUS[code] ?? HttpStatus.BAD_REQUEST);
}
