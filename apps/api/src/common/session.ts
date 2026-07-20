import type { ZoraSession } from './session-cookie';

/* req.session is populated by the cookie middleware in main.ts (stateless signed
   cookie, not express-session). */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session: ZoraSession;
      // C1: stamped by OrganizerGuard from the resolved acting context so
      // downstream org-scoped controllers + audit read a single source of truth.
      actingHandle?: string;
      actingViaImpersonation?: boolean;
      actingAdminId?: string;
    }
  }
}

export {};
