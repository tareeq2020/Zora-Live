import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/* Direct port of requireAuth: admin session required, else 401 { error: 'Not logged in' }. */
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.session && req.session.isAdmin) return true;
    throw new UnauthorizedException({ error: 'Not logged in' });
  }
}
