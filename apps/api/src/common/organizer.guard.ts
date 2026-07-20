import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { resolveActingContext } from '../org/acting-context';

/* C1 (MT1 rewrite): the org-surface gate. The previous one-liner required
   req.session.organizerHandle, so it 401'd an admin who was impersonating an
   organizer. This rewrite allows BOTH a real organizer session AND an
   impersonating admin, resolving the acting handle through the shared resolver
   (single source of truth with OrgScopeService.actingHandle). It stamps the
   acting context on the request so downstream controllers + audit read the same
   values. Plain admin (no impersonation) and anon both 401 with the legacy shape. */
@Injectable()
export class OrganizerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const acting = resolveActingContext(req.session);
    if (!acting.actingHandle) throw new UnauthorizedException({ error: 'Not logged in' });
    req.actingHandle = acting.actingHandle;
    req.actingViaImpersonation = acting.actingViaImpersonation;
    // admin id only meaningful when the action is performed via impersonation.
    req.actingAdminId = acting.actingViaImpersonation ? acting.actingAdminId ?? undefined : undefined;
    return true;
  }
}
