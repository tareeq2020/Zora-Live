import type { ZoraSession } from './session-cookie';

/* req.session is populated by the cookie middleware in main.ts (stateless signed
   cookie, not express-session). */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session: ZoraSession;
    }
  }
}

export {};
