import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/* PR-F-AUTH: organizer-session gate. Mirrors SessionGuard but requires a real
   ORGANIZER principal (req.session.organizerHandle set by POST /api/org/login),
   not the admin flag. Same 401 shape as SessionGuard. */
@Injectable()
export class OrganizerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.session && req.session.organizerHandle) return true;
    throw new UnauthorizedException({ error: 'Not logged in' });
  }
}
