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
  /* BS41 (#4/#5) — self-registration + verification (migration 0013). */
  /** null = seeded or staff-created; 'self-signup' = registered themselves. */
  source: string | null;
  /** The MSISDN proven by SMS-OTP at registration (self-signups only). */
  phone: string | null;
  /** Row birth — the "submitted-at" the verification queue sorts and shows. */
  createdAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** On reject: the KYC_REASONS code, plus an optional ` · note` suffix. */
  verificationReason: string | null;
}

type Row = {
  id: string; name: string | null; handle: string; email: string | null; status: string;
  kyc_status: string | null; commission_rate: string | number | null;
  password_hash: string | null; joined: string | null;
  events: number; revenue: string | number;
  source: string | null; phone: string | null; created_at: Date | string | null;
  reviewed_at: Date | string | null; reviewed_by: string | null; verification_reason: string | null;
};

const COLUMNS = `id, name, handle, email, status, kyc_status, commission_rate,
                 password_hash, joined, events, revenue,
                 source, phone, created_at, reviewed_at, reviewed_by, verification_reason`;

/** timestamptz -> ISO string (postgres.js hands back a Date). */
function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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
    source: r.source ?? null,
    phone: r.phone ?? null,
    createdAt: iso(r.created_at ?? null),
    reviewedAt: iso(r.reviewed_at ?? null),
    reviewedBy: r.reviewed_by ?? null,
    verificationReason: r.verification_reason ?? null,
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
    // BS41: emitted ONLY for self-registered orgs. Conditional on purpose — the
    // seeded/staff-created rows carry source=null, so GET /api/organizers stays
    // byte-identical to db/test/golden/organizers.json (pg-parity diffs it).
    ...(o.source ? { source: o.source } : {}),
  };
}

/* BS41 (#5) — the verification-queue shape. Deliberately NOT publicOrganizer:
   the reviewer needs the facts a decision rests on (the proven phone, when they
   signed up, the last rejection) and none of the money columns. Never carries
   passwordHash. */
export function verificationOrganizer(o: OrganizerRecord) {
  return {
    id: o.id,
    name: o.name,
    handle: o.handle,
    email: o.email,
    phone: o.phone,
    status: o.status,
    kycStatus: o.kycStatus,
    source: o.source,
    submittedAt: o.createdAt,
    reviewedAt: o.reviewedAt,
    reviewedBy: o.reviewedBy,
    rejection: o.verificationReason,
    events: o.events,
  };
}

@Injectable()
export class OrganizerRepo {
  /** Every organizer, stable order (matches the blob's original ordering). */
  async list(): Promise<OrganizerRecord[]> {
    const rows = await db()<Row[]>`
      select ${db().unsafe(COLUMNS)} from organizer order by created_at asc, id asc`;
    return rows.map(toRecord);
  }

  async byId(id: string): Promise<OrganizerRecord | null> {
    const rows = await db()<Row[]>`
      select ${db().unsafe(COLUMNS)} from organizer where id = ${id}`;
    return rows.length ? toRecord(rows[0]) : null;
  }

  /** Handles are stored lower-cased; callers may pass any casing. */
  async byHandle(handle: string): Promise<OrganizerRecord | null> {
    const h = String(handle ?? '').toLowerCase();
    if (!h) return null;
    const rows = await db()<Row[]>`
      select ${db().unsafe(COLUMNS)} from organizer where handle = ${h}`;
    return rows.length ? toRecord(rows[0]) : null;
  }

  /* ── BS41 (#4/#5): self-registration + the verification queue ──────────── */

  /** Is this handle free? Case-insensitive by construction (handles are stored
      lower-cased). Cheap enough to call on every keystroke of the picker. */
  async handleTaken(handle: string): Promise<boolean> {
    const h = String(handle ?? '').toLowerCase();
    if (!h) return false;
    const rows = await db()<{ n: number }[]>`
      select count(*)::int as n from organizer where handle = ${h}`;
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /**
   * Create a self-registered organizer. Throws the raw postgres error on a
   * UNIQUE(handle) violation — the caller maps it to `handle_taken`, which is the
   * ONLY correct way to close the gap between "the picker said free" and "the
   * insert ran": two signups can be in that gap at the same time and the database
   * is the only referee.
   *
   * `id` is a slug, not a uuid, because the entire API surface is keyed on slug
   * ids (PUT /api/organizers/:id/commission) — see 0009's note.
   */
  async createSelfSignup(input: {
    id: string;
    name: string;
    handle: string;
    phone: string;
    email?: string | null;
    passwordHash?: string | null;
  }): Promise<OrganizerRecord> {
    const joined = new Date().toISOString().slice(0, 10); // display-only 'YYYY-MM-DD'
    const rows = await db()<Row[]>`
      insert into organizer
        (id, name, handle, email, phone, status, kyc_status, source, password_hash, joined, events, revenue)
      values
        (${input.id}, ${input.name}, ${input.handle.toLowerCase()}, ${input.email ?? null},
         ${input.phone}, 'pending', 'unverified', 'self-signup',
         ${input.passwordHash ?? null}, ${joined}, 0, 0)
      returning ${db().unsafe(COLUMNS)}`;
    return toRecord(rows[0]);
  }

  /** The #5 queue: every self-registered org, oldest first (longest wait on top). */
  async listSelfSignups(): Promise<OrganizerRecord[]> {
    const rows = await db()<Row[]>`
      select ${db().unsafe(COLUMNS)} from organizer
       where source = 'self-signup'
       order by created_at asc, id asc`;
    return rows.map(toRecord);
  }

  /**
   * Record a verification decision. Approve and reject are ONE method because
   * they are one state transition over the same columns — splitting them let the
   * two paths drift on which fields they cleared (a re-approved org keeping a
   * stale rejection reason, say).
   *
   * approve → status 'active' + kyc_status 'approved' (this is what unlocks
   *           publishing a sellable drop and requesting a payout — both gates
   *           read kyc_status === 'approved').
   * reject  → kyc_status 'rejected', and status stays 'pending': a rejection is
   *           "not yet", not a ban. They keep their drafts and can be approved
   *           later without a second signup.
   */
  async recordVerification(
    id: string,
    decision: 'approve' | 'reject',
    reviewedBy: string,
    reason?: string | null,
  ): Promise<OrganizerRecord | null> {
    const approved = decision === 'approve';
    const rows = await db()<Row[]>`
      update organizer set
        status              = ${approved ? 'active' : 'pending'},
        kyc_status          = ${approved ? 'approved' : 'rejected'},
        verification_reason = ${approved ? null : (reason ?? null)},
        reviewed_at         = now(),
        reviewed_by         = ${reviewedBy},
        updated_at          = now()
       where id = ${id}
      returning ${db().unsafe(COLUMNS)}`;
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

  /** BS57: the organizer's own contact number — used for new-order SMS alerts.
      Stored normalized (+255…); empty string clears it (opt out of alerts). */
  async setPhone(id: string, phone: string): Promise<OrganizerRecord | null> {
    const rows = await db()<Row[]>`
      update organizer set phone = ${phone === '' ? null : phone}, updated_at = now()
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
