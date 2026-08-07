/* Broadcasts (BS43 / plan #2) — bulk SMS + email, and the ONE place an audience
   is resolved, priced, gated and queued.

   ── Why one module for two consoles (eng review CQ2) ───────────────────────
   The organizer console and the admin console send the same thing to different
   people. If each grew its own send path, the opt-out check would be fixed in
   one and forgotten in the other, and "unsubscribe" would be a lie half the
   time. There is therefore ONE audience resolver, ONE gate, ONE queueing
   routine and ONE drain. The only difference between the consoles is the SCOPE
   handed in — and the scope's event ids are resolved by the CALLER, exactly
   like `readOrderMoney`, because ownership lives in the events blob and this
   module must never be the thing that decides who owns what.

   ── Scope isolation ────────────────────────────────────────────────────────
   `AudienceScope.eventIds` is a RESOLVED id set. An organizer controller
   intersects the requested event with its owned set before calling in, so an
   org physically cannot address another org's buyers: there is no field on the
   way in that could point at one. `eventIds: null` means "every customer" and
   is reachable only from the admin surface.

   ── PERF-2: count cheap, materialize in batches ────────────────────────────
   `countAudience` is a single aggregate — the composer calls it on every change
   of the audience picker, so it must never touch a per-recipient row. Recipient
   rows are written only once SEND is confirmed, and then in PAGES keyed on
   customer id, so a 50,000-person audience is 100 statements and not one
   monstrous insert holding a lock.

   ── ARCH-4: the worker drains BOUNDED batches ──────────────────────────────
   `drainBroadcasts` claims at most `batchSize` recipients per call with
   FOR UPDATE SKIP LOCKED, sends them, updates the aggregates, and returns. It
   never loops until the queue is empty. The worker's other loops — payment
   reconciliation and the expiry sweeps — are money-critical, and a big blast
   must be an interleaved background trickle, never a stop-the-world job.

   ── OV5: sending costs money, so sending is gated ──────────────────────────
   Three server-side gates, all enforced HERE (the UI's disabled button is
   courtesy, not the gate): the org must be verified, a sender ID must be set,
   and the SMS the send would cost must fit inside the org's monthly cap.

   ── D4: aggregate status only ──────────────────────────────────────────────
   Per-recipient rows exist because a queue needs them, but the product surface
   is aggregate sent/failed. No delivery-receipt dashboard, no templates, no
   personalization in v1. */
import { tx } from './db';
import { sendSms } from './sms';
import { escapeHtml, sendEmail } from './email';

type Sql = any;

// ── audience ─────────────────────────────────────────────────────────────────

export type BroadcastChannel = 'sms' | 'email' | 'both';
export type RecipientChannel = 'sms' | 'email';
export type BroadcastScopeKind = 'event' | 'tier' | 'org_all' | 'organizer' | 'platform';
export type BroadcastStatus = 'queued' | 'sending' | 'sent' | 'failed';

/** Who counts as "a buyer". Money actually changed hands in all three: `paid`
    is the normal case, and the two flagged states are people who paid but whose
    seat needs ops attention — precisely the people an organizer most needs to
    be able to message. A `refunded` order is NOT here: someone who got their
    money back did not opt into the guest list. */
export const BROADCAST_AUDIENCE_STATUSES = ['paid', 'paid_unseatable', 'payment_short'] as const;

/**
 * A resolved audience.
 *
 * `eventIds` is the id set the caller already proved the sender may address.
 * `null` means "every customer on the platform" and is admin-only — an
 * organizer controller never produces it.
 */
export interface AudienceScope {
  kind: BroadcastScopeKind;
  /** RESOLVED, caller-authorized event ids. null = every customer (admin only). */
  eventIds: string[] | null;
  /** Narrow to buyers of one tier (organizer "this tier" audience). */
  tierId?: string | null;
  /** Kept for the history row so it reads as a choice, not a frozen id list. */
  eventId?: string | null;
  organizerHandle?: string | null;
}

export interface AudienceCount {
  /** Distinct people the scope resolves to. */
  people: number;
  /** Addressable, NOT suppressed, deduped phone numbers. */
  sms: number;
  /** Addressable, NOT suppressed, deduped email addresses. */
  email: number;
  /** Addresses excluded because they opted out — surfaced so the composer can
      say so honestly instead of silently sending to fewer people. */
  suppressed: number;
}

const EMPTY_COUNT: AudienceCount = { people: 0, sms: 0, email: 0, suppressed: 0 };

/** The suppression scope a send should respect: an organizer's blast honours
    both its own opt-outs and platform-wide ones; an admin blast honours the
    platform-wide list. `null` handle = platform-wide only. */
function suppressionHandle(senderKind: 'org' | 'admin', senderHandle: string): string | null {
  return senderKind === 'org' ? String(senderHandle || '').toLowerCase() : null;
}

/**
 * How many people this scope reaches, as ONE aggregate query (PERF-2).
 *
 * Never materializes a recipient row. The composer calls this on every audience
 * change, so it has to stay cheap enough to run on a keystroke.
 */
export async function countAudience(
  sql: Sql,
  scope: AudienceScope,
  scopeHandle: string | null,
): Promise<AudienceCount> {
  const statuses = [...BROADCAST_AUDIENCE_STATUSES];
  const tierId = scope.tierId ?? null;

  // An empty (not null) id set means "the caller owns nothing that matches" —
  // an org asking about an event it does not own lands here. Zero, never a leak.
  if (scope.eventIds !== null && scope.eventIds.length === 0) return { ...EMPTY_COUNT };

  type Row = { people: string | number; sms: string | number; email: string | number; suppressed: string | number };

  // The two variants differ only in the `buyers` CTE. Kept as two literal
  // queries rather than one stitched string so both stay parameterized.
  const rows = (scope.eventIds === null
    ? await sql`
        with buyers as (
          select c.id as id, c.phone as phone, lower(c.email) as email from customer c
        ),
        flagged as (
          select b.id,
                 b.phone, b.email,
                 (b.phone is not null and b.phone <> '') as has_phone,
                 (b.email is not null and b.email <> '') as has_email,
                 exists (select 1 from message_suppression s
                          where s.channel = 'sms' and s.address = b.phone
                            and (s.scope_handle is null or s.scope_handle = ${scopeHandle})) as sms_sup,
                 exists (select 1 from message_suppression s
                          where s.channel = 'email' and s.address = b.email
                            and (s.scope_handle is null or s.scope_handle = ${scopeHandle})) as email_sup
            from buyers b
        )
        select count(*)::int                                                            as people,
               count(distinct phone) filter (where has_phone and not sms_sup)::int      as sms,
               count(distinct email) filter (where has_email and not email_sup)::int    as email,
               (count(distinct phone) filter (where has_phone and sms_sup)
                + count(distinct email) filter (where has_email and email_sup))::int    as suppressed
          from flagged`
    : await sql`
        with buyers as (
          select distinct c.id as id, c.phone as phone, lower(c.email) as email
            from "order" o
            join customer c on c.id = o.customer_id
           where o.status = any(${statuses})
             and o.event_id = any(${scope.eventIds})
             and (${tierId}::text is null
                  or exists (select 1 from order_item oi
                              where oi.order_id = o.id and oi.product_tier_id = ${tierId}))
        ),
        flagged as (
          select b.id,
                 b.phone, b.email,
                 (b.phone is not null and b.phone <> '') as has_phone,
                 (b.email is not null and b.email <> '') as has_email,
                 exists (select 1 from message_suppression s
                          where s.channel = 'sms' and s.address = b.phone
                            and (s.scope_handle is null or s.scope_handle = ${scopeHandle})) as sms_sup,
                 exists (select 1 from message_suppression s
                          where s.channel = 'email' and s.address = b.email
                            and (s.scope_handle is null or s.scope_handle = ${scopeHandle})) as email_sup
            from buyers b
        )
        select count(*)::int                                                            as people,
               count(distinct phone) filter (where has_phone and not sms_sup)::int      as sms,
               count(distinct email) filter (where has_email and not email_sup)::int    as email,
               (count(distinct phone) filter (where has_phone and sms_sup)
                + count(distinct email) filter (where has_email and email_sup))::int    as suppressed
          from flagged`) as Row[];

  const r = rows[0];
  if (!r) return { ...EMPTY_COUNT };
  return {
    people: Number(r.people ?? 0),
    sms: Number(r.sms ?? 0),
    email: Number(r.email ?? 0),
    suppressed: Number(r.suppressed ?? 0),
  };
}

/** One page of customer ids for the scope, keyed on id so paging is stable even
    while new orders land mid-materialization. */
async function audiencePage(
  sql: Sql,
  scope: AudienceScope,
  after: string | null,
  pageSize: number,
): Promise<string[]> {
  const statuses = [...BROADCAST_AUDIENCE_STATUSES];
  const tierId = scope.tierId ?? null;
  const rows = (scope.eventIds === null
    ? await sql`
        select c.id as id from customer c
         where (${after}::uuid is null or c.id > ${after}::uuid)
         order by c.id
         limit ${pageSize}`
    : await sql`
        select distinct o.customer_id as id
          from "order" o
         where o.customer_id is not null
           and o.status = any(${statuses})
           and o.event_id = any(${scope.eventIds})
           and (${tierId}::text is null
                or exists (select 1 from order_item oi
                            where oi.order_id = o.id and oi.product_tier_id = ${tierId}))
           and (${after}::uuid is null or o.customer_id > ${after}::uuid)
         order by 1
         limit ${pageSize}`) as { id: string }[];
  return rows.map((r) => r.id);
}

/** How many customer ids we resolve per insert page. Small enough that no single
    statement is long-running, big enough that a 50k audience is ~100 round trips. */
export const AUDIENCE_PAGE_SIZE = 500;

/**
 * Write the queue rows for a broadcast, in pages (PERF-2).
 *
 * Suppressed addresses are excluded HERE as well as at count time and again at
 * send time. Three checks is not paranoia: count and materialize are separated
 * by however long the composer sat open, and materialize and send by however
 * long the queue is.
 */
export async function queueRecipients(
  sql: Sql,
  broadcastId: string,
  scope: AudienceScope,
  channels: RecipientChannel[],
  scopeHandle: string | null,
  pageSize: number = AUDIENCE_PAGE_SIZE,
): Promise<{ sms: number; email: number }> {
  const out = { sms: 0, email: 0 };
  if (scope.eventIds !== null && scope.eventIds.length === 0) return out;

  let after: string | null = null;
  for (;;) {
    const ids = await audiencePage(sql, scope, after, pageSize);
    if (!ids.length) break;
    after = ids[ids.length - 1];

    if (channels.includes('sms')) {
      const rows = (await sql`
        insert into broadcast_recipient (broadcast_id, channel, address, customer_id, unsubscribe_token)
        select ${broadcastId}, 'sms', c.phone, c.id,
               left(replace(gen_random_uuid()::text, '-', ''), 16)
          from customer c
         where c.id = any(${ids}::uuid[])
           and c.phone is not null and c.phone <> ''
           and not exists (select 1 from message_suppression s
                            where s.channel = 'sms' and s.address = c.phone
                              and (s.scope_handle is null or s.scope_handle = ${scopeHandle}))
        on conflict (broadcast_id, channel, address) do nothing
        returning id`) as { id: string }[];
      out.sms += rows.length;
    }

    if (channels.includes('email')) {
      const rows = (await sql`
        insert into broadcast_recipient (broadcast_id, channel, address, customer_id, unsubscribe_token)
        select ${broadcastId}, 'email', lower(c.email), c.id,
               left(replace(gen_random_uuid()::text, '-', ''), 16)
          from customer c
         where c.id = any(${ids}::uuid[])
           and c.email is not null and c.email <> ''
           and not exists (select 1 from message_suppression s
                            where s.channel = 'email' and s.address = lower(c.email)
                              and (s.scope_handle is null or s.scope_handle = ${scopeHandle}))
        on conflict (broadcast_id, channel, address) do nothing
        returning id`) as { id: string }[];
      out.email += rows.length;
    }

    if (ids.length < pageSize) break;
  }
  return out;
}

// ── SMS cost (the cost-confirm gate's number) ────────────────────────────────

/** GSM-7 single / multipart lengths, and the UCS-2 pair for anything outside it. */
const GSM7 = /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\r\n\f^{}\\[~\]|€]*$/;

/** Segments one SMS body costs. Charged per segment per recipient, which is why
    the composer shows it — a 200-character message is TWO messages of money. */
export function smsSegments(body: string): number {
  const s = String(body ?? '');
  if (!s.length) return 0;
  const unicode = !GSM7.test(s);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return s.length <= single ? 1 : Math.ceil(s.length / multi);
}

/** Per-segment price. Beem's TZ rate is around 20–30 TZS; the exact contracted
    number is deployment config, never a hard-coded guess in the UI. */
export const DEFAULT_SMS_UNIT_COST = 25;

export function smsUnitCost(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SMS_UNIT_COST);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SMS_UNIT_COST;
}

export interface SmsCostEstimate {
  segments: number;
  recipients: number;
  /** segments × recipients — the number of billable messages. */
  units: number;
  unitCost: number;
  total: number;
  currency: string;
}

/** The figure shown BEFORE send is enabled (design spec #2 cost-confirm gate). */
export function estimateSmsCost(
  recipients: number,
  body: string,
  env: NodeJS.ProcessEnv = process.env,
): SmsCostEstimate {
  const segments = smsSegments(body);
  const n = Math.max(0, Math.floor(Number(recipients) || 0));
  const unitCost = smsUnitCost(env);
  const units = segments * n;
  return { segments, recipients: n, units, unitCost, total: units * unitCost, currency: 'TZS' };
}

// ── the monthly cap (OV5) ────────────────────────────────────────────────────

/** Messages, not broadcasts. A cap on broadcasts would be trivially defeated by
    sending ten of them. Deployment-configurable; the default is deliberately
    generous enough for a real event and small enough to bound an accident. */
export const DEFAULT_MONTHLY_SMS_CAP = 5000;

export function monthlySmsCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BROADCAST_SMS_MONTHLY_CAP);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_MONTHLY_SMS_CAP;
}

/** SMS recipients this sender has queued since the start of the calendar month.
    Counted off the QUEUE, not off successful sends — a message that failed at
    the gateway may still have been billed, and in any case the cap exists to
    bound spend, so it must count intent. */
export async function smsUsedThisMonth(sql: Sql, senderHandle: string): Promise<number> {
  const [row] = (await sql`
    select count(*)::int as n
      from broadcast_recipient r
      join broadcast b on b.id = r.broadcast_id
     where b.sender_handle = ${String(senderHandle || '').toLowerCase()}
       and r.channel = 'sms'
       and b.created_at >= date_trunc('month', now())`) as { n: string | number }[];
  return Number(row?.n ?? 0);
}

export interface SmsCapState {
  limit: number;
  used: number;
  remaining: number;
  /** First instant of next month — when `used` resets. */
  resetsAt: string;
}

export async function smsCapState(
  sql: Sql,
  senderHandle: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SmsCapState> {
  const limit = monthlySmsCap(env);
  const used = await smsUsedThisMonth(sql, senderHandle);
  const now = new Date();
  const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { limit, used, remaining: Math.max(0, limit - used), resetsAt: resets.toISOString() };
}

// ── create + queue ───────────────────────────────────────────────────────────

export type BroadcastErrorCode =
  | 'not_verified'
  | 'audience_empty'
  | 'monthly_cap_exceeded'
  | 'body_required'
  | 'subject_required'
  | 'sender_id_required'
  | 'channel_invalid'
  | 'scope_forbidden';

const BROADCAST_MESSAGE: Record<BroadcastErrorCode, string> = {
  not_verified:
    'Your organizer account is not verified yet. You can write and save a message now — sending unlocks once a Zora admin approves you.',
  audience_empty: 'No recipients match this filter.',
  monthly_cap_exceeded: 'That send would go past your monthly SMS allowance.',
  body_required: 'Write the message before sending.',
  subject_required: 'An email needs a subject line.',
  sender_id_required: 'Set the sender ID recipients will see before sending.',
  channel_invalid: 'Pick SMS, email, or both.',
  scope_forbidden: 'You can only message your own buyers.',
};

/** ONE place a refusal becomes a sentence, so the two consoles cannot disagree
    about why a send was blocked (mirrors payoutErrorMessage, CQ3). */
export function broadcastErrorMessage(code: BroadcastErrorCode, ctx?: { remaining?: number; needed?: number }): string {
  if (code === 'monthly_cap_exceeded' && ctx?.needed != null && ctx?.remaining != null) {
    return `That send needs ${ctx.needed.toLocaleString('en-US')} SMS but only ${ctx.remaining.toLocaleString(
      'en-US',
    )} are left in this month's allowance. Send to a smaller audience, or email instead.`;
  }
  return BROADCAST_MESSAGE[code] ?? 'That broadcast could not be sent.';
}

export interface BroadcastRecord {
  id: string;
  senderHandle: string;
  senderKind: 'org' | 'admin';
  scopeKind: BroadcastScopeKind;
  scopeEventId: string | null;
  scopeTierId: string | null;
  scopeOrganizerHandle: string | null;
  channel: BroadcastChannel;
  senderId: string | null;
  subject: string | null;
  bodySms: string | null;
  bodyEmail: string | null;
  audienceCount: number;
  smsCount: number;
  emailCount: number;
  suppressedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  status: BroadcastStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

type BroadcastRow = {
  id: string; sender_handle: string; sender_kind: string; scope_kind: string;
  scope_event_id: string | null; scope_tier_id: string | null; scope_organizer_handle: string | null;
  channel: string; sender_id: string | null; subject: string | null;
  body_sms: string | null; body_email: string | null;
  audience_count: number; sms_count: number; email_count: number; suppressed_count: number;
  sent_count: number; failed_count: number; skipped_count: number; status: string;
  created_at: Date | string; started_at: Date | string | null; completed_at: Date | string | null;
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

const BROADCAST_COLUMNS = `id, sender_handle, sender_kind, scope_kind, scope_event_id, scope_tier_id,
                           scope_organizer_handle, channel, sender_id, subject, body_sms, body_email,
                           audience_count, sms_count, email_count, suppressed_count,
                           sent_count, failed_count, skipped_count, status,
                           created_at, started_at, completed_at`;

function toRecord(r: BroadcastRow): BroadcastRecord {
  return {
    id: r.id,
    senderHandle: r.sender_handle,
    senderKind: r.sender_kind as 'org' | 'admin',
    scopeKind: r.scope_kind as BroadcastScopeKind,
    scopeEventId: r.scope_event_id,
    scopeTierId: r.scope_tier_id,
    scopeOrganizerHandle: r.scope_organizer_handle,
    channel: r.channel as BroadcastChannel,
    senderId: r.sender_id,
    subject: r.subject,
    bodySms: r.body_sms,
    bodyEmail: r.body_email,
    audienceCount: Number(r.audience_count ?? 0),
    smsCount: Number(r.sms_count ?? 0),
    emailCount: Number(r.email_count ?? 0),
    suppressedCount: Number(r.suppressed_count ?? 0),
    sentCount: Number(r.sent_count ?? 0),
    failedCount: Number(r.failed_count ?? 0),
    skippedCount: Number(r.skipped_count ?? 0),
    status: r.status as BroadcastStatus,
    createdAt: iso(r.created_at) as string,
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
  };
}

export interface CreateBroadcastInput {
  /** Organizer handle, or 'admin'. */
  senderHandle: string;
  senderKind: 'org' | 'admin';
  scope: AudienceScope;
  channel: BroadcastChannel;
  subject?: string | null;
  bodySms?: string | null;
  bodyEmail?: string | null;
  /** The name recipients see as the SMS sender (OV5 — required to send). */
  senderId?: string | null;
  /** OV5 gate: org verification. Admin passes true. */
  verified: boolean;
  env?: NodeJS.ProcessEnv;
}

export type CreateBroadcastResult =
  | { ok: true; broadcast: BroadcastRecord; audience: AudienceCount; cap: SmsCapState }
  | { ok: false; code: BroadcastErrorCode; message: string; audience?: AudienceCount; cap?: SmsCapState };

const fail = (
  code: BroadcastErrorCode,
  ctx?: { remaining?: number; needed?: number },
  extra?: { audience?: AudienceCount; cap?: SmsCapState },
): CreateBroadcastResult => ({ ok: false, code, message: broadcastErrorMessage(code, ctx), ...extra });

/**
 * Validate, gate, insert and QUEUE a broadcast. Nothing is sent here — the
 * request returns as soon as the rows are durable and the worker takes it from
 * there (plan #2: "queued + batched via the worker, not inline in the request").
 *
 * The gates run inside the transaction that writes the rows, so a send cannot
 * squeeze past the monthly cap by racing another one.
 */
export async function createBroadcast(sql: Sql, input: CreateBroadcastInput): Promise<CreateBroadcastResult> {
  const env = input.env ?? process.env;
  const channel = String(input.channel || '').toLowerCase() as BroadcastChannel;
  if (channel !== 'sms' && channel !== 'email' && channel !== 'both') return fail('channel_invalid');

  const wantsSms = channel === 'sms' || channel === 'both';
  const wantsEmail = channel === 'email' || channel === 'both';

  const bodySms = (input.bodySms ?? '').trim();
  const bodyEmail = (input.bodyEmail ?? '').trim();
  const subject = (input.subject ?? '').trim();
  const senderId = (input.senderId ?? '').trim();

  if (wantsSms && !bodySms) return fail('body_required');
  if (wantsEmail && !bodyEmail) return fail('body_required');
  if (wantsEmail && !subject) return fail('subject_required');
  // A blast with no sender ID is indistinguishable from a scam SMS. Required
  // for SMS specifically — email carries its From address already.
  if (wantsSms && !senderId) return fail('sender_id_required');

  // The org's requested scope resolved to nothing it owns. Distinct from an
  // audience that is genuinely empty, and never a leak about what exists.
  if (input.scope.eventIds !== null && input.scope.eventIds.length === 0 && input.scope.kind !== 'platform') {
    return fail('scope_forbidden');
  }

  // OV5 — verification gates SENDING, not composing. The composer stays usable
  // for a pending org (design spec: "a pending org can compose but not send").
  if (!input.verified) return fail('not_verified');

  const senderHandle = String(input.senderHandle || '').toLowerCase();
  const scopeHandle = suppressionHandle(input.senderKind, senderHandle);

  const audience = await countAudience(sql, input.scope, scopeHandle);
  const cap = await smsCapState(sql, senderHandle, env);

  if ((wantsSms ? audience.sms : 0) + (wantsEmail ? audience.email : 0) === 0) {
    return fail('audience_empty', undefined, { audience, cap });
  }

  // Cap counts MESSAGES: a two-segment SMS to 100 people is 200 against it,
  // which is what it actually costs.
  const segments = wantsSms ? Math.max(1, smsSegments(bodySms)) : 0;
  const needed = wantsSms ? audience.sms * segments : 0;
  if (needed > cap.remaining) {
    return fail('monthly_cap_exceeded', { remaining: cap.remaining, needed }, { audience, cap });
  }

  const channels: RecipientChannel[] = [];
  if (wantsSms) channels.push('sms');
  if (wantsEmail) channels.push('email');

  return tx(async (t: Sql): Promise<CreateBroadcastResult> => {
    const [row] = (await t`
      insert into broadcast (sender_handle, sender_kind, scope_kind, scope_event_id, scope_tier_id,
                             scope_organizer_handle, channel, sender_id, subject, body_sms, body_email,
                             audience_count, suppressed_count, status)
      values (${senderHandle}, ${input.senderKind}, ${input.scope.kind},
              ${input.scope.eventId ?? null}, ${input.scope.tierId ?? null},
              ${input.scope.organizerHandle ?? null}, ${channel},
              ${senderId || null}, ${subject || null}, ${bodySms || null}, ${bodyEmail || null},
              ${audience.people}, ${audience.suppressed}, 'queued')
      returning ${t.unsafe(BROADCAST_COLUMNS)}`) as BroadcastRow[];

    const queued = await queueRecipients(t, row.id, input.scope, channels, scopeHandle);

    const [updated] = (await t`
      update broadcast set sms_count = ${queued.sms}, email_count = ${queued.email}
       where id = ${row.id}
      returning ${t.unsafe(BROADCAST_COLUMNS)}`) as BroadcastRow[];

    return { ok: true, broadcast: toRecord(updated), audience, cap };
  }, sql);
}

// ── history ──────────────────────────────────────────────────────────────────

export interface ListBroadcastsFilter {
  /** Scope to ONE sender. The organizer surface ALWAYS passes this — it is what
      makes cross-org history reads impossible rather than merely unlikely. */
  senderHandle?: string | null;
  limit?: number;
}

export async function listBroadcasts(sql: Sql, filter: ListBroadcastsFilter = {}): Promise<BroadcastRecord[]> {
  const handle = filter.senderHandle == null ? null : String(filter.senderHandle).toLowerCase();
  const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 200));
  const rows = (await sql`
    select ${sql.unsafe(BROADCAST_COLUMNS)}
      from broadcast
     where (${handle}::text is null or sender_handle = ${handle})
     order by created_at desc
     limit ${limit}`) as BroadcastRow[];
  return rows.map(toRecord);
}

export async function getBroadcast(sql: Sql, id: string): Promise<BroadcastRecord | null> {
  const rows = (await sql`
    select ${sql.unsafe(BROADCAST_COLUMNS)} from broadcast where id = ${id}`) as BroadcastRow[];
  return rows.length ? toRecord(rows[0]) : null;
}

// ── suppression / unsubscribe ────────────────────────────────────────────────

export interface SuppressInput {
  channel: RecipientChannel;
  address: string;
  /** null = platform-wide. */
  scopeHandle?: string | null;
  reason?: string | null;
  source?: string | null;
}

/** Idempotent: unsubscribing twice is a no-op, never an error the person sees. */
export async function suppressAddress(sql: Sql, input: SuppressInput): Promise<{ created: boolean }> {
  const address = input.channel === 'email' ? String(input.address || '').toLowerCase() : String(input.address || '');
  if (!address) return { created: false };
  const rows = (await sql`
    insert into message_suppression (channel, address, scope_handle, reason, source)
    values (${input.channel}, ${address}, ${input.scopeHandle ?? null},
            ${input.reason ?? null}, ${input.source ?? 'unsubscribe-link'})
    on conflict (channel, address, coalesce(scope_handle, '*')) do nothing
    returning id`) as { id: string }[];
  return { created: rows.length > 0 };
}

export async function isSuppressed(
  sql: Sql,
  channel: RecipientChannel,
  address: string,
  scopeHandle: string | null,
): Promise<boolean> {
  const [row] = (await sql`
    select 1 as hit from message_suppression
     where channel = ${channel} and address = ${address}
       and (scope_handle is null or scope_handle = ${scopeHandle})
     limit 1`) as { hit: number }[];
  return !!row;
}

export interface UnsubscribeTarget {
  token: string;
  channel: RecipientChannel;
  /** Masked for display — the page confirms WHICH address without publishing it
      to anyone who merely got hold of the link. */
  addressMasked: string;
  senderLabel: string;
  scopeHandle: string | null;
  alreadySuppressed: boolean;
}

/** Keep the last 3 characters — enough to recognize your own number, useless to
    a stranger (same rule as the org-sales PII mask). */
export function maskAddress(channel: RecipientChannel, address: string): string {
  const s = String(address ?? '');
  if (!s) return '';
  if (channel === 'email') {
    const at = s.indexOf('@');
    if (at <= 0) return '*'.repeat(Math.max(0, s.length - 3)) + s.slice(-3);
    const user = s.slice(0, at);
    const head = user.slice(0, 1);
    return head + '*'.repeat(Math.max(1, user.length - 1)) + s.slice(at);
  }
  return s.length <= 3 ? '*'.repeat(s.length) : '*'.repeat(s.length - 3) + s.slice(-3);
}

type TokenRow = {
  address: string; channel: string; sender_handle: string; sender_kind: string; sender_id: string | null;
};

async function readToken(sql: Sql, token: string): Promise<TokenRow | null> {
  const t = String(token ?? '').trim();
  if (!t || !/^[a-z0-9]{6,64}$/i.test(t)) return null;
  const [row] = (await sql`
    select r.address, r.channel, b.sender_handle, b.sender_kind, b.sender_id
      from broadcast_recipient r
      join broadcast b on b.id = r.broadcast_id
     where r.unsubscribe_token = ${t}`) as TokenRow[];
  return row ?? null;
}

/** What the unsubscribe page shows BEFORE the person confirms. A GET must never
    unsubscribe on its own — link scanners and email previewers follow every URL
    in a message, and a scanner-triggered opt-out is a silently lost customer. */
export async function resolveUnsubscribeToken(sql: Sql, token: string): Promise<UnsubscribeTarget | null> {
  const row = await readToken(sql, token);
  if (!row) return null;
  const channel = row.channel as RecipientChannel;
  const scopeHandle = suppressionHandle(row.sender_kind as 'org' | 'admin', row.sender_handle);
  return {
    token: String(token).trim(),
    channel,
    addressMasked: maskAddress(channel, row.address),
    senderLabel: row.sender_kind === 'admin' ? 'Zora' : row.sender_handle,
    scopeHandle,
    alreadySuppressed: await isSuppressed(sql, channel, row.address, scopeHandle),
  };
}

/** Confirm the opt-out. Idempotent, and scoped: unsubscribing from one
    organizer's blast does not silence Zora's own ticket receipts. */
export async function unsubscribeByToken(
  sql: Sql,
  token: string,
  reason?: string | null,
): Promise<{ ok: boolean; target?: UnsubscribeTarget }> {
  const row = await readToken(sql, token);
  if (!row) return { ok: false };
  const channel = row.channel as RecipientChannel;
  const scopeHandle = suppressionHandle(row.sender_kind as 'org' | 'admin', row.sender_handle);
  await suppressAddress(sql, {
    channel,
    address: row.address,
    scopeHandle,
    reason: reason ?? null,
    source: 'unsubscribe-link',
  });
  // Anything of theirs still sitting in the queue is cancelled now, not sent and
  // apologized for later.
  await sql`
    update broadcast_recipient r
       set status = 'skipped', error = 'unsubscribed'
      from broadcast b
     where b.id = r.broadcast_id
       and r.status = 'queued'
       and r.channel = ${channel}
       and r.address = ${row.address}
       and (${scopeHandle}::text is null or b.sender_handle = ${scopeHandle})`;
  return { ok: true, target: (await resolveUnsubscribeToken(sql, token)) ?? undefined };
}

// ── the worker drain (ARCH-4) ────────────────────────────────────────────────

/** Recipients claimed per tick. Bounded so a large broadcast is a trickle beside
    reconcile/sweep, never a job that owns the worker. */
export const DEFAULT_BROADCAST_BATCH = 25;
/** Pause between two sends inside one batch — the provider rate limit. */
export const DEFAULT_BROADCAST_RATE_MS = 40;

export function broadcastBatchSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BROADCAST_BATCH);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 200) : DEFAULT_BROADCAST_BATCH;
}

export function broadcastRateMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BROADCAST_RATE_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(Math.floor(raw), 5000) : DEFAULT_BROADCAST_RATE_MS;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function publicOrigin(env: NodeJS.ProcessEnv): string {
  return (env.PUBLIC_ORIGIN || 'https://zorapass.com').replace(/\/+$/, '');
}

/** SMS body as it actually goes out: the composed text plus a short opt-out
    link. Compliance is not optional and not the organizer's to forget, so it is
    appended here rather than trusted to the composer. */
export function renderSmsBody(body: string, token: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${String(body ?? '').trim()}\nStop: ${publicOrigin(env)}/u/${token}`;
}

/** Email body: the organizer's text (escaped — v1 has no rich composer, so any
    angle bracket in it is literal text, not markup) plus the unsubscribe link. */
export function renderEmailBody(
  body: string,
  token: string,
  senderLabel: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = `${publicOrigin(env)}/u/${token}`;
  const paragraphs = String(body ?? '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return (
    `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;color:#11131E;max-width:560px">` +
    paragraphs +
    `<hr style="border:none;border-top:1px solid #DDD8CB;margin:28px 0 14px"/>` +
    `<p style="margin:0;font-size:12px;color:#8A877E;line-height:1.6">` +
    `You are getting this because you bought a ticket through ${escapeHtml(senderLabel)} on Zora.<br/>` +
    `<a href="${url}" style="color:#3D5AFE">Unsubscribe from these messages</a>` +
    `</p></div>`
  );
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

type ClaimRow = {
  id: string; broadcast_id: string; channel: string; address: string; unsubscribe_token: string;
};

/**
 * Drain ONE bounded batch of the broadcast queue (ARCH-4).
 *
 * Claims up to `batchSize` queued recipients with FOR UPDATE SKIP LOCKED and
 * flips them to 'sending' in a short transaction, so a crash mid-send leaves
 * them recoverable rather than double-sent. Sends happen OUTSIDE that
 * transaction — holding a DB transaction open across N HTTP calls to an SMS
 * gateway is how a worker ends up holding locks for a minute.
 *
 * Returns the number processed so the worker's tick logger can report it, and
 * so a caller (the e2e) can see the batch boundary.
 */
export async function drainBroadcasts(
  sql: Sql,
  opts: { batchSize?: number; rateMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<DrainResult> {
  const env = opts.env ?? process.env;
  const batchSize = opts.batchSize ?? broadcastBatchSize(env);
  const rateMs = opts.rateMs ?? broadcastRateMs(env);
  const out: DrainResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 };

  // ── claim ──
  const claimed = (await sql`
    with claim as (
      select r.id
        from broadcast_recipient r
        join broadcast b on b.id = r.broadcast_id
       where r.status = 'queued'
         and b.status in ('queued', 'sending')
       order by r.created_at, r.id
       limit ${batchSize}
       for update of r skip locked
    )
    update broadcast_recipient r
       set status = 'sending', attempts = r.attempts + 1
      from claim
     where r.id = claim.id
    returning r.id, r.broadcast_id, r.channel, r.address, r.unsubscribe_token`) as ClaimRow[];

  if (!claimed.length) return out;
  out.claimed = claimed.length;

  const broadcastIds = [...new Set(claimed.map((c) => c.broadcast_id))];
  await sql`
    update broadcast set status = 'sending', started_at = coalesce(started_at, now())
     where id = any(${broadcastIds}::uuid[]) and status = 'queued'`;

  const bodies = (await sql`
    select id, sender_handle, sender_kind, sender_id, subject, body_sms, body_email
      from broadcast where id = any(${broadcastIds}::uuid[])`) as {
    id: string; sender_handle: string; sender_kind: string; sender_id: string | null;
    subject: string | null; body_sms: string | null; body_email: string | null;
  }[];
  const byId = new Map(bodies.map((b) => [b.id, b]));

  for (const r of claimed) {
    const b = byId.get(r.broadcast_id);
    if (!b) {
      await sql`update broadcast_recipient set status = 'failed', error = 'broadcast missing' where id = ${r.id}`;
      out.failed += 1;
      continue;
    }
    const channel = r.channel as RecipientChannel;
    const scopeHandle = suppressionHandle(b.sender_kind as 'org' | 'admin', b.sender_handle);

    // Third suppression check. Someone can unsubscribe between materialization
    // and send; honouring the opt-out only at queue time would mean the very
    // last blast still reaches them.
    if (await isSuppressed(sql, channel, r.address, scopeHandle)) {
      await sql`update broadcast_recipient set status = 'skipped', error = 'suppressed' where id = ${r.id}`;
      out.skipped += 1;
      continue;
    }

    try {
      if (channel === 'sms') {
        await sendSms(r.address, renderSmsBody(b.body_sms ?? '', r.unsubscribe_token, env), env);
      } else {
        const label = b.sender_kind === 'admin' ? 'Zora' : b.sender_handle;
        await sendEmail(
          r.address,
          b.subject ?? 'A message from Zora',
          renderEmailBody(b.body_email ?? '', r.unsubscribe_token, label, env),
          [],
          env,
        );
      }
      await sql`update broadcast_recipient set status = 'sent', sent_at = now(), error = null where id = ${r.id}`;
      out.sent += 1;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
      await sql`update broadcast_recipient set status = 'failed', error = ${msg} where id = ${r.id}`;
      out.failed += 1;
    }

    await sleep(rateMs);
  }

  // ── aggregates (D4) ── recomputed rather than incremented, so a crashed batch
  // or a retried row can never leave a permanently wrong count on the history row.
  await sql`
    update broadcast b
       set sent_count    = c.sent,
           failed_count  = c.failed,
           skipped_count = c.skipped,
           status        = case when c.pending > 0 then 'sending'
                                when c.sent = 0 and c.failed > 0 then 'failed'
                                else 'sent' end,
           completed_at  = case when c.pending > 0 then null else coalesce(b.completed_at, now()) end
      from (
        select broadcast_id,
               count(*) filter (where status = 'sent')::int                        as sent,
               count(*) filter (where status = 'failed')::int                      as failed,
               count(*) filter (where status = 'skipped')::int                     as skipped,
               count(*) filter (where status in ('queued', 'sending'))::int        as pending
          from broadcast_recipient
         where broadcast_id = any(${broadcastIds}::uuid[])
         group by broadcast_id
      ) c
     where b.id = c.broadcast_id`;

  return out;
}

/** Are there queued recipients at all? Cheap enough for the worker to ask every
    tick before doing anything else. */
export async function pendingBroadcastCount(sql: Sql): Promise<number> {
  const [row] = (await sql`
    select count(*)::int as n from broadcast_recipient where status in ('queued', 'sending')`) as
    { n: string | number }[];
  return Number(row?.n ?? 0);
}
