import { Injectable } from '@nestjs/common';
import { db, generateScannerCode, toScannerUser, SCANNER_USER_COLUMNS } from '@zora/core';
import type { ScannerRole, ScannerUser, ScannerUserRow } from '@zora/core';

/* ScannerUserRepo (BS42 / plan #1) — the door staff, as ROWS.

   This replaces `entities.read('agents')` / `entities.write('agents')`. The blob
   was fine while an "agent" was a name and a code, but the moment a code became
   an AUTHENTICATOR it stopped being fine: a whole-collection upsert cannot
   enforce "one live code belongs to one person", so two admins registering staff
   at the same time could hand out a colliding code and the exchange would have
   to guess which user signed in. The partial unique index in 0013 makes that
   impossible at the database level (see the migration for the full argument).

   The API-facing shape is deliberately IDENTICAL to the old blob record
   (id/name/contact/via/event/role/code/status/createdAt/expiresAt) so the live
   admin console section keeps working unchanged; `eventScope` is additive. */

const THREE_DAYS_MS = 1000 * 60 * 60 * 24 * 3;

/** The blob's display value for "not pinned to one event". */
export const ALL_EVENTS_LABEL = 'All events';

/** The response body. `code` IS returned — the whole point of the admin panel is
    to read the code out and hand it over, and the panel is admin-session-gated. */
export function publicScannerUser(u: ScannerUser) {
  return {
    id: u.id,
    name: u.name,
    contact: u.contact ?? '',
    via: u.via ?? '',
    event: u.eventScope ?? ALL_EVENTS_LABEL,
    eventScope: u.eventScope,
    role: u.role,
    code: u.code,
    status: u.status,
    organizerHandle: u.organizerHandle,
    createdAt: u.createdAt,
    expiresAt: u.expiresAt,
    lastSeenAt: u.lastSeenAt,
  };
}

export interface CreateScannerUserInput {
  name: string;
  contact: string;
  role?: ScannerRole;
  /** event.id, or null / 'All events' for unscoped. */
  eventScope?: string | null;
  /** BS106: the owning organizer (acting handle) — null for admin-provisioned. */
  organizerHandle?: string | null;
}

@Injectable()
export class ScannerUserRepo {
  /** Oldest first — the admin table reverses it, matching the blob's behaviour. */
  async list(): Promise<ScannerUser[]> {
    const rows = await db()<ScannerUserRow[]>`
      select ${db().unsafe(SCANNER_USER_COLUMNS)} from scanner_user order by created_at asc, id asc`;
    return rows.map(toScannerUser);
  }

  async byId(id: string): Promise<ScannerUser | null> {
    const rows = await db()<ScannerUserRow[]>`
      select ${db().unsafe(SCANNER_USER_COLUMNS)} from scanner_user where id = ${id}`;
    return rows.length ? toScannerUser(rows[0]) : null;
  }

  /** Normalize the admin's scope input: an empty value or the 'All events' label
      means unscoped. A real event id is stored verbatim. */
  static normalizeScope(v: unknown): string | null {
    const s = String(v ?? '').trim();
    if (!s || s.toLowerCase() === ALL_EVENTS_LABEL.toLowerCase()) return null;
    return s;
  }

  /** Insert with a fresh code, retrying on the (astronomically unlikely, but
      real) unique-code collision rather than handing back a 500. */
  async create(input: CreateScannerUserInput): Promise<ScannerUser> {
    const role: ScannerRole = input.role === 'supervisor' ? 'supervisor' : 'agent';
    const contact = String(input.contact ?? '').trim();
    const scope = ScannerUserRepo.normalizeScope(input.eventScope);
    const organizerHandle = input.organizerHandle ? String(input.organizerHandle).trim() : null;
    const expiresAt = new Date(Date.now() + THREE_DAYS_MS).toISOString();

    for (let attempt = 0; attempt < 8; attempt++) {
      const id = Date.now().toString(36) + attempt.toString(36);
      const code = generateScannerCode();
      const rows = await db()<ScannerUserRow[]>`
        insert into scanner_user (id, name, contact, via, role, event_scope, code, status, organizer_handle, expires_at)
        values (${id}, ${String(input.name ?? '').slice(0, 80)}, ${contact.slice(0, 120)},
                ${/@/.test(contact) ? 'email' : 'phone'}, ${role}, ${scope}, ${code}, 'active', ${organizerHandle}, ${expiresAt})
        on conflict do nothing
        returning ${db().unsafe(SCANNER_USER_COLUMNS)}`;
      if (rows.length) return toScannerUser(rows[0]);
    }
    throw new Error('could not allocate a free scanner code');
  }

  /** BS106: an organizer's own scanners (never another org's, never admin ones). */
  async listByOrganizer(handle: string): Promise<ScannerUser[]> {
    const rows = await db()<ScannerUserRow[]>`
      select ${db().unsafe(SCANNER_USER_COLUMNS)} from scanner_user
       where organizer_handle = ${handle} order by created_at asc, id asc`;
    return rows.map(toScannerUser);
  }

  /** The scanner IF it belongs to this org — used to gate every org-side mutation. */
  async byIdOwned(id: string, handle: string): Promise<ScannerUser | null> {
    const rows = await db()<ScannerUserRow[]>`
      select ${db().unsafe(SCANNER_USER_COLUMNS)} from scanner_user
       where id = ${id} and organizer_handle = ${handle}`;
    return rows.length ? toScannerUser(rows[0]) : null;
  }

  /** NEW CODE. Also bumps `code_rotated_at`, which invalidates any live session
      minted under the old code — rotation mid-shift means "that person is out". */
  async rotateCode(id: string): Promise<ScannerUser | null> {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const rows = await db()<ScannerUserRow[]>`
          update scanner_user
             set code = ${generateScannerCode()},
                 code_rotated_at = now(),
                 expires_at = now() + interval '3 days',
                 status = 'active'
           where id = ${id}
          returning ${db().unsafe(SCANNER_USER_COLUMNS)}`;
        return rows.length ? toScannerUser(rows[0]) : null;
      } catch (e: any) {
        // 23505 = the new code collided with another LIVE one. Draw again; any
        // other error is a real failure and must not be swallowed.
        if (e?.code !== '23505') throw e;
      }
    }
    throw new Error('could not allocate a free scanner code');
  }

  async setRole(id: string, role: ScannerRole): Promise<ScannerUser | null> {
    const rows = await db()<ScannerUserRow[]>`
      update scanner_user set role = ${role === 'supervisor' ? 'supervisor' : 'agent'}
       where id = ${id} returning ${db().unsafe(SCANNER_USER_COLUMNS)}`;
    return rows.length ? toScannerUser(rows[0]) : null;
  }

  async setScope(id: string, scope: string | null): Promise<ScannerUser | null> {
    const rows = await db()<ScannerUserRow[]>`
      update scanner_user set event_scope = ${scope}
       where id = ${id} returning ${db().unsafe(SCANNER_USER_COLUMNS)}`;
    return rows.length ? toScannerUser(rows[0]) : null;
  }

  /** REVOKE is a state change, never a DELETE. The blob path deleted the record,
      which threw away the only evidence of who was on the door — and `credential.
      scanned_by` points here. Revoked frees the code for reuse (the unique index
      is partial on status='active') and kills the account. */
  async revoke(id: string): Promise<ScannerUser | null> {
    const rows = await db()<ScannerUserRow[]>`
      update scanner_user set status = 'revoked', code_rotated_at = now()
       where id = ${id} returning ${db().unsafe(SCANNER_USER_COLUMNS)}`;
    return rows.length ? toScannerUser(rows[0]) : null;
  }
}
