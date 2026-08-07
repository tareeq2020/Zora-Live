import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ScannerRole } from '@zora/core';
import { ScannerUserRepo } from '../storage/scanner-user.repo';
import { readScanToken, verifyScanSession, type ScanSession } from './scan-session';

/* The ROLE GATE (eng review ARCH-3): the role in the scanner session decides
   which endpoint may be called, and nothing else does.

   An agent token reaching /api/scan/confirm is the two-step's whole failure mode
   — one person who can both admit and confirm is not a two-step. So the check is
   server-side and mandatory. The scanner UI hiding the button is presentation,
   not security.

   The guard also RE-READS the scanner user on every request rather than trusting
   the token alone. That costs one indexed primary-key lookup and buys instant
   revocation: an admin hitting REVOKE (or NEW CODE) mid-shift takes effect on
   the very next scan, instead of whenever a 12-hour token happens to lapse. */

export const SCAN_ROLES_KEY = 'scan:roles';

/** Restrict a handler to these scanner roles. No decorator = any valid session. */
export const ScanRoles = (...roles: ScannerRole[]) => SetMetadata(SCAN_ROLES_KEY, roles);

/** The acting scanner, stamped on the request by the guard. */
export interface ScanPrincipal {
  id: string;
  name: string;
  role: ScannerRole;
  eventScope: string | null;
}

declare module 'express' {
  interface Request {
    scanner?: ScanPrincipal;
    scanSession?: ScanSession;
  }
}

@Injectable()
export class ScanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: ScannerUserRepo,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const session = verifyScanSession(readScanToken(req as any));
    if (!session) throw new UnauthorizedException({ error: 'scan_session_required' });

    const user = await this.users.byId(session.uid);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({ error: 'scan_session_revoked' });
    }
    // Rotating the code invalidates tokens minted before the rotation.
    if (Math.floor(new Date(user.codeRotatedAt).getTime() / 1000) > session.cv) {
      throw new UnauthorizedException({ error: 'scan_session_revoked' });
    }

    // Role and scope come from the ROW, not the token: an admin who demotes a
    // supervisor mid-shift must not have to wait for a token to expire.
    const principal: ScanPrincipal = {
      id: user.id, name: user.name, role: user.role, eventScope: user.eventScope,
    };
    req.scanner = principal;
    req.scanSession = session;

    const allowed = this.reflector.getAllAndOverride<ScannerRole[] | undefined>(SCAN_ROLES_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (allowed && allowed.length && !allowed.includes(principal.role)) {
      throw new ForbiddenException({
        error: 'wrong_role',
        message: allowed.includes('supervisor')
          ? 'Only a supervisor can confirm a wristband.'
          : 'Only a door agent can scan passes.',
        role: principal.role,
      });
    }
    return true;
  }
}
