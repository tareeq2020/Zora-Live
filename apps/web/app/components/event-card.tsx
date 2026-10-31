'use client';

/* PR-BS120 — the ONE shared event card (storefront grid + Discover).

   Spec: docs/ZoraPass-Design-System-Handoff/03_COMPONENTS/components.md §4 and the
   approved Main / StorefrontMobile mockups (web-premium-v1 F2, DD2).

     ┌────────────────────────┐
     │ [artwork 4:5]  [chip]  │  chip top-left, 12px inset — only when TRUE
     ├────────────────────────┤
     │ SAT 7 NOV · 11:00      │  mono 13, uppercase
     │ Apricot Crush Brunch   │  Bricolage Bold 20
     │ The Slipway · Dar es…  │  14, secondary
     │ From TSh 60,000  [hint]│  mono 16 (+ optional installment hint)
     │ [ GET PASSES       → ] │  the CTA strip, last row
     └────────────────────────┘

   DD2: the whole card is ONE link. The "GET PASSES →" strip is a visual row
   inside that link, never a nested button. Sold out stays visible (proof the
   platform works): artwork dimmed to 60%, SOLD OUT chip (struck through by the
   token class), strip reads JOIN THE WAITLIST.

   Fixed light (bone) — primitive tokens only, because <html data-theme>
   defaults to dark and would flip the semantic --zp-surface* tokens. */

import type { MouseEvent, ReactNode } from 'react';
import styles from './event-card.module.css';

/** The card-level statuses from 04_UI_COPY §2, in the §2 priority order
    (components.md: CANCELLED > POSTPONED > SOLD OUT > ALMOST GONE > FEW LEFT >
    LIVE NOW > ON SALE > JUST ANNOUNCED > ZORA PICK). */
export const EVENT_STATUS_PRIORITY = [
  'CANCELLED',
  'POSTPONED',
  'SOLD OUT',
  'ALMOST GONE',
  'FEW LEFT',
  'LIVE NOW',
  'ON SALE',
  'JUST ANNOUNCED',
  'ZORA PICK',
] as const;
export type EventStatus = (typeof EVENT_STATUS_PRIORITY)[number];

/** One chip per card: the highest-priority status that is actually true. */
export function pickStatus(candidates: Array<EventStatus | null | undefined | false>): EventStatus | null {
  const set = new Set(candidates.filter(Boolean) as EventStatus[]);
  return EVENT_STATUS_PRIORITY.find((s) => set.has(s)) ?? null;
}

/** Honest stock words (04_UI_COPY thresholds): SOLD OUT at zero, ALMOST GONE under
    10% remaining, FEW LEFT under 20%, otherwise ON SALE. Unknown capacity → null
    (no chip — we never claim a state we can't prove). */
export function stockStatus(remaining: number | null | undefined, capacity: number | null | undefined): EventStatus | null {
  if (remaining == null || capacity == null || !Number.isFinite(remaining) || !Number.isFinite(capacity) || capacity <= 0) {
    return null;
  }
  if (remaining <= 0) return 'SOLD OUT';
  const share = remaining / capacity;
  if (share < 0.1) return 'ALMOST GONE';
  if (share < 0.2) return 'FEW LEFT';
  return 'ON SALE';
}

/** A /api/inventory pool row. */
export type InventoryPool = { tierId: string; available: number; capacity?: number };

/** Sum the pools of an event's on-sale tiers into one remaining/capacity pair.
    Returns null when any tier has no pool row or no capacity (unknown). */
export function stockForTiers(
  tierIds: string[],
  pools: Record<string, InventoryPool> | null | undefined,
): { remaining: number; capacity: number } | null {
  if (!pools || tierIds.length === 0) return null;
  let remaining = 0;
  let capacity = 0;
  for (const id of tierIds) {
    const p = pools[id];
    if (!p || p.capacity == null || !Number.isFinite(Number(p.capacity))) return null;
    remaining += Math.max(0, Number(p.available) || 0);
    capacity += Math.max(0, Number(p.capacity) || 0);
  }
  return { remaining, capacity };
}

const CHIP_CLASS: Record<EventStatus, string> = {
  CANCELLED: 'zp-chip--cancelled',
  POSTPONED: 'zp-chip--postponed',
  'SOLD OUT': 'zp-chip--sold-out',
  'ALMOST GONE': 'zp-chip--almost-gone',
  'FEW LEFT': 'zp-chip--few-left',
  'LIVE NOW': 'zp-chip--live-now',
  'ON SALE': 'zp-chip--on-sale',
  'JUST ANNOUNCED': 'zp-chip--just-announced',
  'ZORA PICK': 'zp-chip--zora-pick',
};

// Black-fill chips sit on the black artwork frame; a bone outline keeps the pill
// shape readable (the token fill and label colours are unchanged).
const DARK_FILL = new Set<EventStatus>(['FEW LEFT', 'ALMOST GONE']);

export type EventCardProps = {
  /** Where the card goes (event page / tenant event page). The ONE link. */
  href: string;
  name: string;
  /** Event artwork URL. Absent → black block + the ZoraPass stamp. */
  artwork?: string;
  /** Human date label ("Sat 7 Nov"); rendered uppercase mono. */
  dateLabel?: string;
  time?: string;
  venue?: string;
  /** City name in full ("Dar es Salaam", 04_UI_COPY rule 7). */
  city?: string;
  /** Pre-formatted money ("TSh 60,000"); the card adds "From". */
  priceFrom?: string;
  /** Small mono note after the price (e.g. the BS65 USD price "($25)"). */
  priceNote?: string;
  /** The ONE chip, already resolved to a true status (see pickStatus). */
  status?: EventStatus | null;
  /** Installment hint slot ("or 3 × TSh 20,000") — rendered only when passed. */
  installmentHint?: ReactNode;
  /** Optional click handler (e.g. open the in-page checkout). The card stays a
      real link, so middle-click / open-in-new-tab / keyboard still work. */
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** Eager-load the artwork (first row). */
  priority?: boolean;
};

// BS147: landscape artwork → the card frame switches to 16:9 (see .art[data-wide]).
function markWide(i: HTMLImageElement) {
  if (i.naturalWidth > i.naturalHeight * 1.15) i.closest('[data-art]')?.setAttribute('data-wide', '');
}

export function EventCard({
  href,
  name,
  artwork,
  dateLabel,
  time,
  venue,
  city,
  priceFrom,
  priceNote,
  status,
  installmentHint,
  onClick,
  priority,
}: EventCardProps) {
  const soldOut = status === 'SOLD OUT';
  const when = [(dateLabel || 'TBA').toUpperCase(), time].filter(Boolean).join(' · ');
  const where = [venue || 'Venue to be announced', city].filter(Boolean).join(' · ');
  const cta = soldOut ? 'JOIN THE WAITLIST' : 'GET PASSES';

  return (
    <a
      className={styles.card + (soldOut ? ' ' + styles.soldOut : '')}
      href={href}
      onClick={onClick}
      data-event-card
      aria-label={`${name}${status ? ` — ${status.toLowerCase()}` : ''}. ${cta === 'GET PASSES' ? 'Get passes' : 'Join the waitlist'}`}
    >
      <div className={styles.art} data-art="">
        <div className={styles.artInner}>
          {artwork ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.artImg}
              src={artwork}
              alt={name}
              loading={priority ? 'eager' : 'lazy'}
              // BS147: landscape artwork gets a 16:9 frame (shown whole, no bars,
              // no crop); portrait/square posters keep the 4:5 frame.
              ref={(i) => { if (i && i.complete) markWide(i); }}
              onLoad={(e) => markWide(e.currentTarget)}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.stamp} src="/brand/stamps/svg/zp-stamp-zorapass-dar-signal.svg" alt="" aria-hidden="true" />
          )}
        </div>
        {status ? (
          <span className={`${styles.chip} ${CHIP_CLASS[status]}${DARK_FILL.has(status) ? ' ' + styles.onDark : ''}`}>{status}</span>
        ) : null}
      </div>
      <div className={styles.body}>
        <span className={styles.when}>{when}</span>
        <span className={styles.name}>{name}</span>
        <span className={styles.where}>{where}</span>
        {priceFrom || installmentHint ? (
          <span className={styles.priceRow}>
            {priceFrom ? (
              <span className={styles.price}>
                From {priceFrom}
                {priceNote ? <small> {priceNote}</small> : null}
              </span>
            ) : (
              <span />
            )}
            {installmentHint ? <span className={styles.plan}>{installmentHint}</span> : null}
          </span>
        ) : null}
        <span className={styles.strip} aria-hidden="true">
          {cta}
          <span>→</span>
        </span>
      </div>
    </a>
  );
}

export default EventCard;
