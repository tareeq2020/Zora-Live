import { Injectable } from '@nestjs/common';
import { db } from '@zora/core';

/* OrganizerRepo (BS35 / eng-review OV2) — organizers as ROWS, not a JSON blob.
   Replaces `entities.read('organizers', …)` + `entities.write('organizers', …)`.

   Why this exists: the blob write was a whole-collection upsert with no version
   guard, so "admin sets a commission" and "admin sets a password" issued a second
   apart would clobber each other — last write wins over EVERY organizer. Money
   can't sit on that. Every write below is a targeted single-row UPDATE, so
   concurrent edits to different organizers (or different columns of the same one)
   no longer collide, and `handle` uniqueness is enforced by the database.

   The API-facing shape is deliberately IDENTICAL to the old blob records
   (id/name/handle/email/status/events/revenue/joined/kycStatus/commissionRate),
   so the admin console, the organizer dashboard and the e2e suites are unchanged.
   `passwordHash` is carried on the record but is NEVER serialized by a controller
   — `publicOrganizer()` is the one way to build a response body. */

export interface OrganizerRecord {
  id: string;
  name: string;
  handle: string;
  email: string | null;
  status: string;
  kycStatus: string | null;
  /** Raw stamp: null means "no org-level rate" — resolveCommissionRate() decides
      the effective value. Never default it here; that math lives in @zora/core. */
  commissionRate: number | null;
  passwordHash: string | null;
  joined: string | null;
  events: number;
  revenue: number;
}

type Row = {
  id: string; name: string | null; handle: string; email: string | null; status: string;
  kyc_status: string | null; commission_rate: string | number | null;
  password_hash: string | null; joined: string | null;
  events: number; revenue: string | number;
};

const COLUMNS = `id, name, handle, email, status, kyc_status, commission_rate,
                 password_hash, joined, events, revenue`;

function toRecord(r: Row): OrganizerRecord {
  return {
    id: r.id,
    // `name` is nullable in 0001's schema; the blob always had one. Fall back to
    // the handle so a response never carries a null display name.
    name: r.name ?? r.handle,
    handle: r.handle,
    email: r.email,
    status: r.status,
    kycStatus: r.kyc_status,
    // numeric(6,5) comes back as a string from postgres.js — never let it reach
    // the response (or the commission math) untyped.
    commissionRate: r.commission_rate == null ? null : Number(r.commission_rate),
    passwordHash: r.password_hash,
    joined: r.joined,
    events: Number(r.events ?? 0),
    revenue: Number(r.revenue ?? 0),
  };
}

/** The response shape — identical to the old blob record minus passwordHash.
    `commissionRate` is always a number so the admin UI can render/edit it even
    for organizers that predate the field (falls back to the platform default). */
export function publicOrganizer(o: OrganizerRecord, effectiveRate: number) {
  return {
    id: o.id, name: o.name, handle: o.handle, email: o.email, status: o.status,
    events: o.events, revenue: o.revenue, joined: o.joined,
    ...(o.kycStatus != null ? { kycStatus: o.kycStatus } : {}),
    commissionRate: effectiveRate,
  };
}

@Injectable()
export class OrganizerRepo {
  /** Every organizer, stable order (matches the blob's original ordering). */
  async list(): Promise<OrganizerRecord[]> {
    const rows = await db()<Row[]>`
      select id, name, handle, email, status, kyc_status, commission_rate,
             password_hash, joined, events, revenue
        from organizer order by created_at asc, id asc`;
    return rows.map(toRecord);
  }

  async byId(id: string): Promise<OrganizerRecord | null> {
    const rows = await db()<Row[]>`
      select id, name, handle, email, status, kyc_status, commission_rate,
             password_hash, joined, events, revenue
        from organizer where id = ${id}`;
    return rows.length ? toRecord(rows[0]) : null;
  }

  /** Handles are stored lower-cased; callers may pass any casing. */
  async byHandle(handle: string): Promise<OrganizerRecord | null> {
    const h = String(handle ?? '').toLowerCase();
    if (!h) return null;
    const rows = await db()<Row[]>`
      select id, name, handle, email, status, kyc_status, commission_rate,
             password_hash, joined, events, revenue
        from organizer where handle = ${h}`;
    return rows.length ? toRecord(rows[0]) : null;
  }

  /* Single-column writes — the whole point of the migration. One organizer, one
     column: two admins editing two organizers (or the same one's commission and
     password) can no longer overwrite each other the way the blob upsert did.
     Each returns the refreshed record, or null if the organizer does not exist. */

  async setCommissionRate(id: string, rate: number): Promise<OrganizerRecord | null> {
    const rows = await db()<Row[]>`
      update organizer set commission_rate = ${rate}, updated_at = now()
       where id = ${id}
      returning ${db().unsafe(COLUMNS)}`;
    return rows.length ? toRecord(rows[0]) : null;
  }

  async setPasswordHash(id: string, hash: string): Promise<OrganizerRecord | null> {
    const rows = await db()<Row[]>`
      update organizer set password_hash = ${hash}, updated_at = now()
       where id = ${id}
      returning ${db().unsafe(COLUMNS)}`;
    return rows.length ? toRecord(rows[0]) : null;
  }

  async setStatus(id: string, status: string): Promise<OrganizerRecord | null> {
    const rows = await db()<Row[]>`
      update organizer set status = ${status}, updated_at = now()
       where id = ${id}
      returning ${db().unsafe(COLUMNS)}`;
    return rows.length ? toRecord(rows[0]) : null;
  }

  /** Accepts an id OR a handle — KYC review keys off the handle, admin off the id. */
  async setKycStatus(idOrHandle: string, kycStatus: string): Promise<OrganizerRecord | null> {
    const rows = await db()<Row[]>`
      update organizer set kyc_status = ${kycStatus}, updated_at = now()
       where id = ${idOrHandle} or handle = ${String(idOrHandle ?? '').toLowerCase()}
      returning ${db().unsafe(COLUMNS)}`;
    return rows.length ? toRecord(rows[0]) : null;
  }
}
