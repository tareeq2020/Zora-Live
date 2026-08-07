/* BS41 (#4) — the ONE place organizer-handle rules live.
   A handle is not cosmetic: it becomes a public front door three ways —
   `zora.com/<handle>`, `zora.com/@<handle>` and `<handle>.zora.com` (see
   apps/web/middleware.ts). So "is this handle free?" has to answer the same way
   in three places that used to each have their own opinion:
     · the live availability picker on the signup screen,
     · POST /api/org/register,
     · the database's UNIQUE(handle) constraint.
   The first two now call these functions; the third is the backstop for the race
   between them.

   Rejecting a RESERVED handle is not politeness — claiming `dashboard` or `admin`
   would shadow a real route in middleware.ts's bare-handle rewrite and hand an
   organizer a URL that can never resolve to their storefront. */

import { RESERVED_HANDLES } from './defaults';

/** Lower-cased, trimmed, '@' stripped. Handles are STORED lower-cased (0009), so
    every read/compare must normalize first or a capitalized signup looks free. */
export function normalizeHandle(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().replace(/^@+/, '');
}

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

/** Why a handle can't be used — or null when it is structurally fine.
    'taken' is NOT decided here: it needs the database (see OrganizerRepo). */
export type HandleIssue = 'too_short' | 'too_long' | 'invalid_chars' | 'reserved';

export function handleIssue(handle: string): HandleIssue | null {
  if (handle.length < HANDLE_MIN) return 'too_short';
  if (handle.length > HANDLE_MAX) return 'too_long';
  // Letters, digits and single inner hyphens. No leading/trailing hyphen (an ugly
  // subdomain), no dots (they would read as another DNS label), no underscores
  // (not valid in a hostname at all).
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(handle)) return 'invalid_chars';
  if (handle.includes('--')) return 'invalid_chars';
  if (RESERVED_HANDLES.includes(handle)) return 'reserved';
  return null;
}

/** The message the signup picker shows under the field. Plain, not a code dump. */
export function handleIssueMessage(issue: HandleIssue | 'taken'): string {
  switch (issue) {
    case 'too_short': return `At least ${HANDLE_MIN} characters.`;
    case 'too_long': return `At most ${HANDLE_MAX} characters.`;
    case 'invalid_chars': return 'Letters, numbers and hyphens only — no spaces, and it can’t start or end with a hyphen.';
    case 'reserved': return 'That one is reserved by Zora. Try another.';
    case 'taken': return 'Taken — another organizer already has it.';
  }
}
