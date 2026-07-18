import { Global, Injectable, Module } from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveSessionSecret } from './secret';
import { ZoraSession, setSessionCookie, clearSessionCookie, verifySession, readSessionCookie } from './session-cookie';

/* Signs/reads the stateless session cookie. Secret = SESSION_SECRET env
   (separate from the KYC encryption key). */
@Injectable()
export class SessionService {
  private readonly secret = resolveSessionSecret();

  set(res: Response, payload: ZoraSession): void {
    setSessionCookie(res, payload, this.secret);
  }
  clear(res: Response): void {
    clearSessionCookie(res);
  }
  read(req: Request): ZoraSession {
    return verifySession(readSessionCookie(req), this.secret) || {};
  }
}

@Global()
@Module({ providers: [SessionService], exports: [SessionService] })
export class SessionModule {}
