import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ZoraSession } from './session-cookie';
import { resolveActingContext } from '../org/acting-context';

/* BS93 (auth Phase 2, E4) — the RBAC guard. ONE session-derived role gate,
   registered GLOBALLY (APP_GUARD). It is a NO-OP on any handler that carries no
   @Roles(...) — so it changes nothing about the routes it is not asked about, and
   it does NOT replace OrganizerGuard or the admin SessionGuard: those stay exactly
   where they are (they still 401 the anon/plain-admin cases and stamp the acting
   context). This guard only ADDS the role refusal.

   THE COOPERATION RULE (no live organizer may be locked out): the acting-org role
   is read from the SESSION, never the body.
     · A NEW user session carries memberships[] → the role is the membership whose
       org matches the acting org.
     · A LEGACY session (organizerHandle only, no memberships) OR an admin
       impersonating an org → treated as an implicit `owner` of that org, so every
       pre-Phase-2 login and the existing impersonation flow still pass.
     · A legacy admin session ({ isAdmin }) is treated as the global `super_admin`,
       so /api/admin/* and /api/kyc/* keep working before super-admins become users.

   Ordering: as a global guard it runs BEFORE the controller-scoped guards, so the
   "no identity at all" case is answered here with the SAME 401 shape those guards
   use ({ error: 'Not logged in' }) — anon behaviour is byte-identical. */

export const ROLES_KEY = 'zora:roles';

/** Restrict a handler/controller to these roles (global roles OR the acting-org
    membership role). No decorator = this guard is a no-op for that route. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** The effective role sets for a request, derived purely from the session. */
export function effectiveRoles(session: ZoraSession | undefined | null): {
  global: Set<string>;
  org: Set<string>;
  hasIdentity: boolean;
} {
  const s = session || {};
  const global = new Set<string>(Array.isArray(s.globalRoles) ? s.globalRoles : []);
  // Legacy magic-admin session === global super_admin (until admins are users).
  if (s.isAdmin) global.add('super_admin');

  const org = new Set<string>();
  const acting = resolveActingContext(s); // real org, or admin-impersonating
  const memberships = Array.isArray(s.memberships) ? s.memberships : [];
  if (memberships.length) {
    // Match the acting org by id first, then by handle (organizerHandle is kept in
    // sync with the acting org on login + switch).
    const m = memberships.find(
      (x) =>
        (s.actingOrganizerId && x.organizerId === s.actingOrganizerId) ||
        (acting.actingHandle && x.organizerHandle === acting.actingHandle),
    );
    if (m) org.add(m.role);
  } else if (acting.actingHandle) {
    // Legacy org session or admin impersonation → implicit owner (no lockout).
    org.add('owner');
  }

  const hasIdentity = !!(s.isAdmin || s.userId || s.organizerHandle);
  return { global, org, hasIdentity };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles on this route → this guard has no opinion (pure additive).
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const { global, org, hasIdentity } = effectiveRoles(req.session);
    if (required.some((r) => global.has(r) || org.has(r))) return true;

    // Preserve the existing anon shape (OrganizerGuard/SessionGuard both 401 with
    // this body); only a logged-in principal with the wrong role gets a 403.
    if (!hasIdentity) throw new UnauthorizedException({ error: 'Not logged in' });
    throw new ForbiddenException({
      error: 'forbidden',
      message: 'You do not have permission to do that.',
    });
  }
}
