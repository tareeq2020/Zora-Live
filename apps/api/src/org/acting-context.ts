import type { ZoraSession } from '../common/session-cookie';

/* C1 — acting-organizer resolution. THE single source of truth shared by
   OrganizerGuard and OrgScopeService so the guard and every org-scoped service
   agree on "who is acting".

   Rule: a real organizer session acts as itself; an admin acts ONLY while
   impersonating an organizer (a plain admin has no acting handle → 401). This
   matches the existing impersonation model (organizers.module.ts stamps
   session.impersonating = { id, name, handle, startedAt }).

   There is one singleton admin principal — the session carries { isAdmin, role }
   with no per-admin id — so the admin id surfaced for audit is the constant
   'admin' (same value AuditService already records). */
export interface ActingContext {
  actingHandle: string | null;
  actingViaImpersonation: boolean;
  actingAdminId: string | null;
}

export function resolveActingContext(session: ZoraSession | undefined | null): ActingContext {
  const s = session || {};
  if (s.organizerHandle) {
    return { actingHandle: s.organizerHandle, actingViaImpersonation: false, actingAdminId: null };
  }
  if (s.isAdmin && s.impersonating) {
    return { actingHandle: s.impersonating.handle, actingViaImpersonation: true, actingAdminId: 'admin' };
  }
  return { actingHandle: null, actingViaImpersonation: false, actingAdminId: null };
}
