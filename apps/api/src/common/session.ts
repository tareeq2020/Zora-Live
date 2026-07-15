import 'express-session';

/* Session shape used across the API — mirrors what server.js stashed on
   req.session (admin flag + active impersonation). */
declare module 'express-session' {
  interface SessionData {
    isAdmin?: boolean;
    impersonating?: {
      id: string;
      name: string;
      handle: string;
      startedAt: string;
    } | null;
  }
}
