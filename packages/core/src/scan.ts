/* Scanning (BS42 / plan #1) — the door. Two steps on ONE state column.

   ── The state machine (eng review OV4) ──────────────────────────────────────
   The lifecycle rides `credential.state`, which has existed since 0001_init.
   There is no parallel scan_state: a pass has exactly one state, so "is this
   person in?" has exactly one answer.

     issued ──agent scan──▶ scanned ──supervisor confirm──▶ wristband_issued
        │                      │
        └──────────────────────┴────────────▶ revoked | used   (terminal)

   ── OV6: the AGENT scan is the gate ────────────────────────────────────────
   `scanned` is admission. Normal GA entry STOPS there — the queue does not wait
   on a supervisor, and a flaky uplink at the door cannot hold up the line. The
   supervisor step is SELECTIVE: table / bill-split seats, comps, and anything
   ops flagged (`requires_confirm`). Those are the credentials worth a second
   person; everything else would just be ceremony.

   ── Replay / double-scan ────────────────────────────────────────────────────
   Two agents scanning the same screenshot at two doors is the realistic attack,
   and it is a RACE, not a sequence. `scanCredential` therefore locks the row
   (SELECT … FOR UPDATE) and re-reads the state inside the same transaction, so
   exactly one scan wins and the loser gets the winner's name and timestamp to
   read back to the guest. Idempotent by construction: there is no path where two
   callers both observe `issued`.

   ── Offline ────────────────────────────────────────────────────────────────
   `verifyCredential` is pure HMAC over the claims tuple (credentials.ts) — no
   database, constant-time, key-rotation aware. That is what makes the signature
   half of the gate offline-capable in principle; the state half needs the row,
   and the offline QUEUE is deliberately deferred (see the plan's NOT-in-scope). */
import { tx } from './db';
import { QR_SCHEME, verifyCredential } from './credentials';

type Sql = any;

// ── states ───────────────────────────────────────────────────────────────────

export type CredentialState = 'issued' | 'scanned' | 'wristband_issued' | 'used' | 'revoked';

export const CREDENTIAL_STATES: CredentialState[] = [
  'issued', 'scanned', 'wristband_issued', 'used', 'revoked',
];

/** States a pass can never leave. `used` is the legacy standalone-ticket
    terminal; meeting one at the door means ALREADY USED, not "let them in". */
export const TERMINAL_CREDENTIAL_STATES: CredentialState[] = ['wristband_issued', 'used', 'revoked'];

// ── error codes ──────────────────────────────────────────────────────────────

export type ScanErrorCode =
  | 'malformed_qr'
  | 'invalid_signature'
  | 'not_found'
  | 'wrong_event'
  | 'out_of_scope'
  | 'revoked'
  | 'already_scanned'
  | 'already_confirmed';

export type ConfirmErrorCode =
  | 'not_found'
  | 'not_scanned'
  | 'already_confirmed'
  | 'revoked'
  | 'out_of_scope';

/** Plain, human, no jargon — this is read off a phone across a crowd in under a
    second (DESIGN.md Door plane: "plain reason + who/when"). */
const SCAN_MESSAGE: Record<ScanErrorCode, string> = {
  malformed_qr: 'That’s not a Zora pass.',
  invalid_signature: 'Fake pass — the signature doesn’t match.',
  not_found: 'No pass with that code.',
  wrong_event: 'Wrong event — this pass is for another door.',
  out_of_scope: 'You’re not assigned to this event.',
  revoked: 'This pass was cancelled.',
  already_scanned: 'Already scanned.',
  already_confirmed: 'Already used — wristband issued.',
};

const CONFIRM_MESSAGE: Record<ConfirmErrorCode, string> = {
  not_found: 'No pass with that id.',
  not_scanned: 'That pass hasn’t been scanned yet — the agent scans first.',
  already_confirmed: 'Already confirmed — the wristband was issued.',
  revoked: 'This pass was cancelled.',
  out_of_scope: 'You’re not assigned to this event.',
};

export const scanErrorMessage = (code: ScanErrorCode): string => SCAN_MESSAGE[code];
export const confirmErrorMessage = (code: ConfirmErrorCode): string => CONFIRM_MESSAGE[code];

// ── the pass as the door sees it ─────────────────────────────────────────────

/** Everything the result takeover renders. Deliberately thin: a name, a tier, a
    reference. No phone, no email, no money — a scanner is a locked-down surface
    (the admin console's own copy promises "no revenue, no private data"). */
export interface ScanPass {
  credentialId: string;
  publicRef: string | null;
  state: CredentialState;
  eventId: string | null;
  eventName: string | null;
  tierId: string | null;
  tierName: string | null;
  holderName: string | null;
  tableNo: string | null;
  seatIndex: number | null;
  /** OV6 — does this one need the second person? */
  requiresConfirm: boolean;
  scannedAt: string | null;
  scannedBy: string | null;
  scannedByName: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmedByName: string | null;
}

type CredRow = {
  id: string; public_ref: string | null; state: string;
  event_id: string | null; event_name: string | null;
  tier_id: string | null; tier_name: string | null;
  holder_name: string | null; customer_name: string | null;
  table_no: string | null; seat_index: number | null;
  split_id: string | null; signature: string | null; code: string;
  requires_confirm: boolean;
  scanned_at: Date | string | null; scanned_by: string | null; scanned_by_name: string | null;
  confirmed_at: Date | string | null; confirmed_by: string | null; confirmed_by_name: string | null;
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/* One SELECT list, used by the scan path, the confirm path and the queue, so
   those three surfaces can never disagree about what a pass looks like. The
   holder falls back to the buying customer: a GA credential carries no
   holder_name of its own, but the order behind it knows who paid. */
const PASS_SELECT = `
  c.id, c.public_ref, c.state, c.event_id, c.tier_id, c.holder_name, c.table_no,
  c.seat_index, c.split_id, c.signature, c.code, c.requires_confirm,
  c.scanned_at, c.scanned_by, c.scanned_by_name,
  c.confirmed_at, c.confirmed_by, c.confirmed_by_name,
  e.name as event_name, t.name as tier_name, cu.name as customer_name`;

const PASS_FROM = `
  from credential c
  left join event        e  on e.id  = c.event_id
  left join product_tier t  on t.id  = c.tier_id
  left join order_item   oi on oi.id = c.order_item_id
  left join "order"      o  on o.id  = oi.order_id
  left join customer     cu on cu.id = o.customer_id`;

/** OV6 — the selective-confirm rule, in ONE place. A table/split seat always
    takes the second person; anything else only if it was explicitly flagged. */
export function requiresSupervisor(row: { requires_confirm?: boolean | null; split_id?: string | null; table_no?: string | null }): boolean {
  return row.requires_confirm === true || row.split_id != null || row.table_no != null;
}

function toPass(r: CredRow): ScanPass {
  return {
    credentialId: r.id,
    publicRef: r.public_ref,
    state: r.state as CredentialState,
    eventId: r.event_id,
    eventName: r.event_name,
    tierId: r.tier_id,
    tierName: r.tier_name,
    holderName: r.holder_name ?? r.customer_name ?? null,
    tableNo: r.table_no,
    seatIndex: r.seat_index == null ? null : Number(r.seat_index),
    requiresConfirm: requiresSupervisor(r),
    scannedAt: iso(r.scanned_at),
    scannedBy: r.scanned_by,
    scannedByName: r.scanned_by_name,
    confirmedAt: iso(r.confirmed_at),
    confirmedBy: r.confirmed_by,
    confirmedByName: r.confirmed_by_name,
  };
}

// ── QR payload ───────────────────────────────────────────────────────────────

export interface ParsedQr { code: string; signature: string }

/** `zora:<code>:<signature>` (credentials.qrPayload). Tolerates the whitespace and
    casing a camera decode or a hand-typed fallback can introduce, but NOT a
    different scheme — a random QR at the door must fail fast and loudly. */
export function parseQrPayload(raw: string): ParsedQr | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length !== 3) return null;
  if (parts[0].toLowerCase() !== QR_SCHEME) return null;
  const [, code, signature] = parts;
  if (!code || !signature) return null;
  return { code, signature };
}

// ── scan (agent) ─────────────────────────────────────────────────────────────

export interface ScanActor {
  id: string;
  name: string;
  /** event.id the scanner user is pinned to; null = every event (ARCH-3). */
  eventScope?: string | null;
}

export interface ScanCredentialInput {
  /** The decoded QR payload, `zora:<code>:<signature>`. */
  qr?: string | null;
  /** MANUAL FALLBACK (design-review-spec "CAMERA DENIED"): the human-dictatable
      `public_ref` printed on the pass, typed in when the camera is unavailable.
      There is no signature to check on this path — but there is nothing to
      weaken either: the ref and the QR are printed on the SAME pass, so holding
      one implies holding the other, and a forger cannot invent a ref that exists
      (~31^8 random, and it must match a real row). Everything after the lookup —
      scope, state, the row lock, who/when — is identical. */
  ref?: string | null;
  actor: ScanActor;
  /** Trusted HMAC keys (credentials.ticketSigningKeys — a LIST, for rotation). */
  keys: string[];
  /** The door this scanner is standing at. When set, a pass for another event is
      refused even if the scanner user itself is unscoped. */
  eventId?: string | null;
}

export type ScanOutcome = 'valid' | 'needs_supervisor';

export type ScanCredentialResult =
  | { ok: true; outcome: ScanOutcome; pass: ScanPass }
  | { ok: false; code: ScanErrorCode; message: string; pass?: ScanPass };

const scanFail = (code: ScanErrorCode, pass?: ScanPass): ScanCredentialResult =>
  ({ ok: false, code, message: SCAN_MESSAGE[code], pass });

/**
 * The gate. Verify → check event → claim the row → mark scanned.
 *
 * Order matters. Signature is checked BEFORE any state write, so a forged QR
 * never touches a real credential; the row lock is taken BEFORE the state test,
 * so two simultaneous scans of the same pass serialize instead of both winning.
 */
export async function scanCredential(sql: Sql, input: ScanCredentialInput): Promise<ScanCredentialResult> {
  const manualRef = String(input.ref ?? '').trim().toUpperCase();
  const parsed = input.qr ? parseQrPayload(input.qr) : null;
  if (!parsed && !manualRef) return scanFail('malformed_qr');

  const scope = input.actor.eventScope ?? null;
  const door = input.eventId ?? null;

  return tx(async (t: Sql): Promise<ScanCredentialResult> => {
    // FOR UPDATE on `credential` only — the LEFT JOINs are read-only display
    // data, and locking them would drag unrelated rows into the transaction.
    const rows = (await t`
      select ${t.unsafe(PASS_SELECT)} ${t.unsafe(PASS_FROM)}
       where ${parsed ? t`c.code = ${parsed.code}` : t`upper(c.public_ref) = ${manualRef}`}
       for update of c`) as CredRow[];
    if (!rows.length) return scanFail('not_found');
    const row = rows[0];

    // ── signature ── the offline-capable half. Claims come from the ROW, the
    // signature from the QR: a forged pass has to forge the HMAC, not the data.
    // Skipped on the manual-ref path, which has no signature to present (see
    // ScanCredentialInput.ref for why that is not a hole).
    if (parsed) {
      const claims = {
        code: row.code,
        tier: row.tier_id ?? '',
        eventId: row.event_id ?? '',
        tableId: row.split_id ?? null,
      };
      if (!row.signature || !verifyCredential(claims, parsed.signature, input.keys)) {
        return scanFail('invalid_signature');
      }
      // A signature that verifies but doesn't match the row's own stored one means
      // two different valid signings of the same code — impossible unless someone
      // has the key. Refuse rather than reason about it.
      if (row.signature !== parsed.signature) return scanFail('invalid_signature');
    }

    // ── the right door ──
    if (scope && row.event_id !== scope) return scanFail('out_of_scope', toPass(row));
    if (door && row.event_id !== door) return scanFail('wrong_event', toPass(row));

    // ── state ──
    const state = row.state as CredentialState;
    if (state === 'revoked') return scanFail('revoked', toPass(row));
    if (state === 'wristband_issued' || state === 'used') return scanFail('already_confirmed', toPass(row));
    if (state === 'scanned') {
      // The replay. The loser of the race lands here holding the winner's name
      // and time — which is the only thing the agent can actually act on.
      return scanFail('already_scanned', toPass(row));
    }

    const [updated] = (await t`
      update credential
         set state = 'scanned', scanned_at = now(),
             scanned_by = ${input.actor.id}, scanned_by_name = ${input.actor.name}
       where id = ${row.id} and state = 'issued'
      returning id`) as { id: string }[];
    // Belt and braces: the lock above already guarantees this, but a guarded
    // UPDATE means a future caller that forgets the lock still cannot double-scan.
    if (!updated) return scanFail('already_scanned', toPass(row));

    const [after] = (await t`
      select ${t.unsafe(PASS_SELECT)} ${t.unsafe(PASS_FROM)} where c.id = ${row.id}`) as CredRow[];
    const pass = toPass(after);
    return { ok: true, outcome: pass.requiresConfirm ? 'needs_supervisor' : 'valid', pass };
  }, sql);
}

// ── confirm (supervisor) ─────────────────────────────────────────────────────

export interface ConfirmCredentialInput {
  credentialId: string;
  actor: ScanActor;
}

export type ConfirmCredentialResult =
  | { ok: true; pass: ScanPass }
  | { ok: false; code: ConfirmErrorCode; message: string; pass?: ScanPass };

const confirmFail = (code: ConfirmErrorCode, pass?: ScanPass): ConfirmCredentialResult =>
  ({ ok: false, code, message: CONFIRM_MESSAGE[code], pass });

/**
 * scanned → wristband_issued. The second person.
 *
 * Only `scanned` is a legal source: confirming a pass nobody scanned would let a
 * supervisor admit a guest alone, which defeats the entire two-step. Same row
 * lock, so two supervisors tapping CONFIRM on the same queue row produce one
 * wristband and one "already confirmed".
 */
export async function confirmCredential(sql: Sql, input: ConfirmCredentialInput): Promise<ConfirmCredentialResult> {
  const scope = input.actor.eventScope ?? null;

  return tx(async (t: Sql): Promise<ConfirmCredentialResult> => {
    const rows = (await t`
      select ${t.unsafe(PASS_SELECT)} ${t.unsafe(PASS_FROM)}
       where c.id = ${input.credentialId}
       for update of c`) as CredRow[];
    if (!rows.length) return confirmFail('not_found');
    const row = rows[0];

    if (scope && row.event_id !== scope) return confirmFail('out_of_scope', toPass(row));

    const state = row.state as CredentialState;
    if (state === 'revoked') return confirmFail('revoked', toPass(row));
    if (state === 'wristband_issued' || state === 'used') return confirmFail('already_confirmed', toPass(row));
    if (state !== 'scanned') return confirmFail('not_scanned', toPass(row));

    const [updated] = (await t`
      update credential
         set state = 'wristband_issued', confirmed_at = now(),
             confirmed_by = ${input.actor.id}, confirmed_by_name = ${input.actor.name}
       where id = ${row.id} and state = 'scanned'
      returning id`) as { id: string }[];
    if (!updated) return confirmFail('already_confirmed', toPass(row));

    const [after] = (await t`
      select ${t.unsafe(PASS_SELECT)} ${t.unsafe(PASS_FROM)} where c.id = ${row.id}`) as CredRow[];
    return { ok: true, pass: toPass(after) };
  }, sql);
}

// ── the supervisor queue ─────────────────────────────────────────────────────

export interface PendingFilter {
  /** null = every event the supervisor can see. */
  eventId?: string | null;
  limit?: number;
  /** OV6 — the queue is the SELECTIVE set by default: only the credentials that
      actually need a second person. Pass false to see every scanned pass. */
  onlyRequiresConfirm?: boolean;
}

/** Scanned-and-waiting, oldest first (the person standing there longest). */
export async function pendingConfirmations(sql: Sql, filter: PendingFilter = {}): Promise<ScanPass[]> {
  const eventId = filter.eventId ?? null;
  const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 200));
  const selective = filter.onlyRequiresConfirm !== false;
  const rows = (await sql`
    select ${sql.unsafe(PASS_SELECT)} ${sql.unsafe(PASS_FROM)}
     where c.state = 'scanned'
       and (${eventId}::text is null or c.event_id = ${eventId})
       and (${!selective}::boolean or c.requires_confirm or c.split_id is not null or c.table_no is not null)
     order by c.scanned_at asc
     limit ${limit}`) as CredRow[];
  return rows.map(toPass);
}

/** One pass by id — the supervisor detail read, scope-checked by the caller. */
export async function getPass(sql: Sql, credentialId: string): Promise<ScanPass | null> {
  const rows = (await sql`
    select ${sql.unsafe(PASS_SELECT)} ${sql.unsafe(PASS_FROM)} where c.id = ${credentialId}`) as CredRow[];
  return rows.length ? toPass(rows[0]) : null;
}

/** Door totals for the top strip — cheap, one grouped scan of the event. */
export async function scanTotals(sql: Sql, eventId?: string | null): Promise<Record<CredentialState, number>> {
  const ev = eventId ?? null;
  const rows = (await sql`
    select state, count(*)::int as n from credential
     where (${ev}::text is null or event_id = ${ev})
     group by state`) as { state: string; n: number }[];
  const out = { issued: 0, scanned: 0, wristband_issued: 0, used: 0, revoked: 0 } as Record<CredentialState, number>;
  for (const r of rows) if (r.state in out) out[r.state as CredentialState] = Number(r.n ?? 0);
  return out;
}
