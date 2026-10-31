/* BS123: first-party storefront analytics capture + server product events.

   recordView() turns one beacon into daily aggregates (A10). Unique visitors are
   deduped per day by sha256(HMAC(secret, day) + anonId): the same browser is one
   visitor per day per page, and hashes cannot be linked across days. Nothing
   personal is stored. Sources are bucketed from the referrer / utm_source on the
   client's first touch (A22).

   captureServerEvent() sends money-path product events (payment_completed,
   checkout_abandoned) to PostHog from the server, fire-and-forget with a 2s
   timeout (A11). Disabled unless POSTHOG_KEY is set. */

import { createHash, createHmac } from 'node:crypto';

type Sql = any;

export const ANALYTICS_SOURCES = ['whatsapp', 'instagram', 'facebook', 'google', 'tiktok', 'x', 'direct', 'other'] as const;
export type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number];

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|headless|lighthouse|curl|wget|python|axios|node-fetch/i;

/** Is this user agent a crawler / link-preview fetcher (not a person)? */
export function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return true;
  return BOT_UA.test(ua);
}

/** Bucket a referrer URL and/or utm_source into a small fixed set. */
export function classifySource(referrer?: string | null, utmSource?: string | null): AnalyticsSource {
  const pick = (s: string): AnalyticsSource | null => {
    const v = s.toLowerCase();
    if (/whatsapp|wa\.me/.test(v)) return 'whatsapp';
    if (/instagram|ig\b/.test(v)) return 'instagram';
    if (/facebook|fb\.|\bfb\b|messenger/.test(v)) return 'facebook';
    if (/google/.test(v)) return 'google';
    if (/tiktok/.test(v)) return 'tiktok';
    if (/twitter|t\.co\b|x\.com/.test(v)) return 'x';
    return null;
  };
  if (utmSource) {
    const u = pick(utmSource);
    if (u) return u;
  }
  if (!referrer) return 'direct';
  let host = '';
  try { host = new URL(referrer).hostname; } catch { return 'other'; }
  if (/(^|\.)zorapass\.com$|(^|\.)zora/.test(host)) return 'direct'; // internal navigation
  return pick(host) ?? 'other';
}

function dayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function visitorHash(secret: string, day: string, anonId: string): string {
  const salt = createHmac('sha256', secret).update('zp-analytics:' + day).digest();
  return createHash('sha256').update(salt).update(anonId).digest('base64url').slice(0, 32);
}

export interface RecordViewInput {
  org: string;
  event?: string | null;
  kind: 'storefront' | 'event';
  anonId: string;
  referrer?: string | null;
  utmSource?: string | null;
  userAgent?: string | null;
  secret: string;
  now?: Date;
}

const SAFE_ID = /^[A-Za-z0-9._@-]{1,120}$/;

/** Record one page view. Returns false when ignored (bot / malformed). Never throws on bad input. */
export async function recordView(sql: Sql, input: RecordViewInput): Promise<boolean> {
  if (isBotUserAgent(input.userAgent)) return false;
  if (!SAFE_ID.test(input.org)) return false;
  const event = input.event && SAFE_ID.test(input.event) ? input.event : '';
  if (input.kind !== 'storefront' && input.kind !== 'event') return false;
  if (input.kind === 'event' && !event) return false;
  if (!input.anonId || input.anonId.length > 100) return false;
  const day = dayString(input.now ?? new Date());
  const source = classifySource(input.referrer, input.utmSource);
  const hash = visitorHash(input.secret, day, input.anonId);
  await sql.begin(async (t: Sql) => {
    const ins = await t`
      insert into analytics_visitor_day (day, org_handle, event_id, visitor_hash)
      values (${day}, ${input.org}, ${event}, ${hash}) on conflict do nothing`;
    const newVisitor = Number(ins.count ?? 0) > 0 ? 1 : 0;
    await t`
      insert into analytics_daily (day, org_handle, event_id, kind, source, views, visitors)
      values (${day}, ${input.org}, ${event}, ${input.kind}, ${source}, 1, ${newVisitor})
      on conflict (day, org_handle, event_id, kind, source)
      do update set views = analytics_daily.views + 1, visitors = analytics_daily.visitors + excluded.visitors`;
  });
  return true;
}

/** Worker: drop visitor-dedupe rows older than `keepDays` (aggregates stay). */
export async function purgeVisitorDays(sql: Sql, keepDays = 35): Promise<number> {
  const res = await sql`delete from analytics_visitor_day where day < current_date - ${keepDays}::int`;
  return Number(res.count ?? 0);
}

/** Server-side product event to PostHog. Fire-and-forget; never throws. */
export async function captureServerEvent(event: 'payment_completed' | 'checkout_abandoned', distinctSeed: string, properties: Record<string, string | number | boolean | null> = {}): Promise<void> {
  const key = process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
  // distinct id is a one-way hash of the order id — no raw ids leave.
  const distinct = 'srv_' + createHash('sha256').update(distinctSeed).digest('base64url').slice(0, 24);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, event, distinct_id: distinct, properties: { surface: 'server', ...properties } }),
      signal: ctrl.signal,
    });
  } catch {
    /* analytics never breaks the money path */
  } finally {
    clearTimeout(timer);
  }
}
