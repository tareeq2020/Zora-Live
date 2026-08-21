/* PR-MT6 — shared types + helpers for the organizer drop editor.

   These types are the FRONTEND's local view of the /api/org/events contract
   (see mt-dashboard-plan.md "## API contract"). The backend (MT2) is the source
   of truth; we mirror its shape here so create/edit build against the contract
   before the endpoints land, and we surface server error messages verbatim
   rather than trusting client validation. Do NOT import backend types — this is
   a deliberate local definition. */

// ── server-shaped types (responses) ─────────────────────────────────────────

export type KycStatus = 'approved' | 'pending' | 'rejected' | 'unverified' | string;

export type OrgMe = {
  actingHandle: string;
  name: string;
  role: string;
  impersonating?: { handle: string; name: string } | null;
  kycStatus: KycStatus;
  commissionRate?: number; // BS31: platform commission netted from payout (default 0.05)
};

// A tier as returned by GET /api/org/events (richer than the write shape).
export type OrgTier = {
  tierId?: string;
  name: string;
  unitPrice: number;
  usd?: number; // BS87: USD anchor (the price the organizer set)
  capacity: number;
  sold?: number;
  available?: number;
  currency?: string;
  split?: boolean; // splittable (bill-split) tier
  seats?: number; // BS30: max people per table (splitters), split tiers only
  disabled?: boolean; // BS23: hidden from the storefront / not on sale
};

export type OrgEvent = {
  id: string;
  name: string;
  category?: string;
  city?: string;
  venue?: string;
  dateLabel?: string;
  time?: string;
  priceFrom?: number;
  seated?: boolean;
  status?: 'draft' | 'published' | 'archived' | string;
  sellable?: boolean;
  tiers?: OrgTier[];
};

// ── write shape (POST / PUT body) ────────────────────────────────────────────

// Tier as the create/edit form submits it — the provisioning service (MT2)
// drives product_tier/price_version/inventory_pool off this, NOT the display blob.
export type DropTierInput = { tierId?: string; name: string; price: number; usd?: number; capacity: number; splitEnabled?: boolean; seats?: number; disabled?: boolean };

export type DropInput = {
  name: string;
  dateLabel: string;
  // NOTE: `time` is not listed in the finalized POST/PUT contract body, but GET
  // /api/org/events returns it, so we round-trip it here. Flagged as an
  // assumption to verify with MT2 — a backend that ignores unknown keys is safe.
  time: string;
  city: string;
  venue: string;
  category: string;
  cover?: string;
  priceFrom: number;
  seated: boolean;
  sellable: boolean;
  tiers: DropTierInput[];
  idempotencyKey: string;
};

// ── editor form state (strings, so inputs stay controlled + empty-friendly) ──

// `tierId`/`sold` are present only for EXISTING (already-saved) tiers; a freshly
// added row has neither. `disabled` = BS23 on-sale toggle.
export type TierRow = { tierId?: string; name: string; price: string; capacity: string; splitEnabled?: boolean; seats?: string; disabled?: boolean; sold?: number };

export type PriceCurrency = 'TZS' | 'USD';

export type DropForm = {
  name: string;
  dateLabel: string;
  time: string;
  city: string;
  venue: string;
  category: string;
  cover: string; // per-event hero image URL (CDN)
  seated: boolean;
  sellable: boolean;
  // BS99 (#3): how the organizer enters tier prices FOR THIS EVENT. Default 'TZS'
  // (enter the shilling price directly, usd anchor omitted). 'USD' opts in to the
  // admin-rate conversion (the price field is USD; the buyer is charged usd×rate).
  priceCurrency: PriceCurrency;
  tiers: TierRow[];
};

export const emptyTier = (): TierRow => ({ name: '', price: '', capacity: '', splitEnabled: false });

export const emptyForm = (): DropForm => ({
  name: '',
  dateLabel: '',
  time: '',
  city: '',
  venue: '',
  category: '',
  cover: '',
  seated: false,
  sellable: false,
  priceCurrency: 'TZS', // BS99 (#3): TZS-direct is the default; USD is opt-in per event.
  tiers: [emptyTier()],
});

// Hydrate the editable form from a server event (edit route prefill).
export function formFromEvent(ev: OrgEvent, rate: number): DropForm {
  // BS99 (#3): the event's currency mode is inferred from its tiers — if ANY tier
  // carries a `usd` anchor it was priced in USD; otherwise it's TZS-direct. New/
  // legacy events with no usd anchor edit in TZS (the default), so opening an
  // existing TZS event no longer silently divides its price by the USD rate.
  const usesUsd = (ev.tiers || []).some((t) => t.usd != null);
  const priceCurrency: PriceCurrency = usesUsd ? 'USD' : 'TZS';
  const tiers = (ev.tiers || []).map((t) => ({
    tierId: t.tierId, // preserved so edits match by id (not name) and delete/disable can target it
    name: t.name || '',
    // The price field is in the event's currency: for USD, the stored anchor (or a
    // legacy TZS tier's derived USD); for TZS, the shilling unitPrice verbatim.
    price:
      priceCurrency === 'USD'
        ? t.usd != null
          ? String(t.usd)
          : t.unitPrice != null
            ? String(Math.round(t.unitPrice / rate))
            : ''
        : t.unitPrice != null
          ? String(t.unitPrice)
          : '',
    capacity: t.capacity != null ? String(t.capacity) : '',
    splitEnabled: !!t.split,
    seats: t.seats != null ? String(t.seats) : '',
    disabled: !!t.disabled,
    sold: t.sold,
  }));
  return {
    name: ev.name || '',
    dateLabel: ev.dateLabel || '',
    time: ev.time || '',
    city: ev.city || '',
    venue: ev.venue || '',
    category: ev.category || '',
    cover: (ev as { cover?: string }).cover || '',
    seated: !!ev.seated,
    sellable: !!ev.sellable,
    priceCurrency,
    tiers: tiers.length ? tiers : [emptyTier()],
  };
}

// ── validation (MIRRORS the backend; server stays the source of truth) ───────

export type FieldErrors = {
  name?: string;
  tiers?: string; // form-level (e.g. "add a tier")
  tierRows?: Record<number, string>; // per-row message
};

const isNonNegNumber = (raw: string): boolean => {
  if (raw.trim() === '') return false;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0;
};

export function validate(form: DropForm): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name.trim()) errors.name = 'Give your drop a name.';

  const rows = form.tiers;
  const tierRows: Record<number, string> = {};
  rows.forEach((t, i) => {
    const hasAny = t.name.trim() || t.price.trim() || t.capacity.trim();
    // Only validate rows the user actually started, unless sellable (all count).
    if (!hasAny && !form.sellable) return;
    if (!t.name.trim()) tierRows[i] = 'Tier name is required.';
    else if (!isNonNegNumber(t.price)) tierRows[i] = 'Price must be a number ≥ 0.';
    else if (!isNonNegNumber(t.capacity) || !Number.isInteger(Number(t.capacity)))
      tierRows[i] = 'Capacity must be a whole number ≥ 0.';
  });
  if (Object.keys(tierRows).length) errors.tierRows = tierRows;

  if (form.sellable) {
    const usable = rows.filter((t) => t.name.trim() && isNonNegNumber(t.price) && isNonNegNumber(t.capacity));
    if (usable.length === 0) errors.tiers = 'A sellable drop needs at least one valid ticket tier.';
  }
  return errors;
}

export const hasErrors = (e: FieldErrors): boolean =>
  !!(e.name || e.tiers || (e.tierRows && Object.keys(e.tierRows).length));

// Tiers that are complete enough to send (used for priceFrom + body).
export function usableTiers(form: DropForm, rate: number): DropTierInput[] {
  const usdMode = form.priceCurrency === 'USD';
  return form.tiers
    .filter((t) => t.name.trim() !== '' || t.price.trim() !== '' || t.capacity.trim() !== '')
    .map((t) => {
      // BS99 (#3): in USD mode the price field is the USD anchor and the buyer is
      // charged TZS = round(usd × admin-rate) — `usd` rides along and the server
      // recomputes the shilling price authoritatively. In TZS mode the field IS the
      // shilling price: no anchor is sent, so the server takes it verbatim.
      const entered = Number(t.price) || 0;
      const usd = usdMode ? entered : undefined;
      const price = usdMode ? Math.round(entered * rate) : entered;
      return {
        tierId: t.tierId,
        name: t.name.trim(),
        ...(usd != null ? { usd } : {}),
        price,
        capacity: Number(t.capacity) || 0,
        splitEnabled: !!t.splitEnabled,
        // BS30: people-per-table only rides along for split tiers (>=2); server defaults to 8.
        ...(t.splitEnabled && Number(t.seats) >= 2 ? { seats: Math.floor(Number(t.seats)) } : {}),
        disabled: !!t.disabled,
      };
    });
}

export function priceFromOf(tiers: DropTierInput[]): number {
  // BS99 (#2, editor parity): the "from" price is the cheapest ON-SALE tier —
  // a disabled tier is not purchasable, so it must not set the floor. This mirrors
  // the server's read-time derivation (vendor/events.js deriveFrom), so the live
  // preview + the stored priceFrom match what the marketplace actually shows. Fall
  // back to all tiers only when every tier is disabled (so the preview isn't 0).
  const live = tiers.filter((t) => !t.disabled).map((t) => t.price).filter((p) => Number.isFinite(p) && p >= 0);
  const pool = live.length ? live : tiers.map((t) => t.price).filter((p) => Number.isFinite(p) && p >= 0);
  return pool.length ? Math.min(...pool) : 0;
}

// Stable client idempotency key for one form instance (dedupes double-submit
// server-side; the UI ALSO disables-on-submit). crypto.randomUUID in all modern
// browsers, with a defensive fallback.
export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function buildBody(form: DropForm, idempotencyKey: string, rate: number): DropInput {
  const tiers = usableTiers(form, rate);
  return {
    name: form.name.trim(),
    dateLabel: form.dateLabel.trim(),
    time: form.time.trim(),
    city: form.city.trim(),
    venue: form.venue.trim(),
    category: form.category.trim(),
    priceFrom: priceFromOf(tiers),
    cover: form.cover?.trim() ?? '',
    seated: form.seated,
    sellable: form.sellable,
    tiers,
    idempotencyKey,
  };
}

// ── API calls (same-origin /api/* proxy) ─────────────────────────────────────

export type ApiError = { status: number; error?: string; message?: string };

async function readError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const b = (body || {}) as Record<string, unknown>;
  return {
    status: res.status,
    error: typeof b.error === 'string' ? b.error : undefined,
    message: typeof b.message === 'string' ? b.message : undefined,
  };
}

export async function fetchMe(): Promise<OrgMe> {
  const res = await fetch('/api/org/me', { headers: { accept: 'application/json' } });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function fetchEvents(): Promise<OrgEvent[]> {
  const res = await fetch('/api/org/events', { headers: { accept: 'application/json' } });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function createDrop(body: DropInput): Promise<OrgEvent> {
  const res = await fetch('/api/org/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function updateDrop(id: string, body: DropInput): Promise<OrgEvent> {
  const res = await fetch(`/api/org/events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function deleteDrop(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/org/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// BS23: hard-delete one ticket tier (server refuses with 409 tier_has_sales if it
// has any orders/holds/splits/credentials, or 409 last_tier for the only tier).
export async function deleteTier(eventId: string, tierId: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/org/events/${encodeURIComponent(eventId)}/tiers/${encodeURIComponent(tierId)}`, {
    method: 'DELETE',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// BS24: reversibly archive a drop (allowed even with paid orders) / restore it.
export async function archiveDrop(id: string): Promise<OrgEvent> {
  const res = await fetch(`/api/org/events/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}
export async function unarchiveDrop(id: string): Promise<OrgEvent> {
  const res = await fetch(`/api/org/events/${encodeURIComponent(id)}/unarchive`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Human-friendly copy for the server error codes in the contract.
export function messageForError(err: ApiError, context: 'save' | 'delete'): string {
  if (err.error === 'kyc_required')
    return 'Your account must be verified before you can publish a paid, public drop. You can still save it as a draft.';
  if (err.error === 'has_paid_orders')
    return "This drop can't be deleted — it already has sales. Archive it instead once the event has passed.";
  if (err.status === 404) return "That drop no longer exists, or it isn't yours.";
  if (err.status === 401) return 'Your session expired. Sign in again to continue.';
  // Map the server's field-validation codes to readable copy (publish enforces the
  // full field set; a draft only needs a name). Keeps a missing field from ever
  // surfacing as a raw code like "city_required".
  const REQUIRED_LABELS: Record<string, string> = {
    name_required: 'name',
    dateLabel_required: 'date',
    city_required: 'city',
    venue_required: 'venue',
    category_required: 'category',
  };
  if (err.error && REQUIRED_LABELS[err.error])
    return `Add a ${REQUIRED_LABELS[err.error]} to publish this drop (drafts can skip it).`;
  if (err.error === 'city_invalid') return 'Choose a city from the list to publish this drop.';
  if (err.error === 'priceFrom_invalid') return 'Set a valid starting price to publish.';
  if (err.error === 'seated_required') return 'Choose whether this is a seated event.';
  if (err.error === 'tiers_required') return 'A public drop needs at least one ticket tier.';
  if (err.error === 'capacity_below_committed') return "You can't drop capacity below tickets already sold or held.";
  if (err.error === 'tier_has_sales') return "This tier has orders or held seats — it can't be deleted. Disable it instead to stop new sales.";
  if (err.error === 'last_tier') return "You can't delete the only ticket tier. Add another tier first, or delete the whole drop.";
  if (err.error === 'suspended') return 'Your account is suspended. Contact ZORA support.';
  if (err.message) return err.message;
  if (err.error) return err.error;
  return context === 'delete' ? 'Could not delete this drop. Please try again.' : 'Could not save this drop. Please try again.';
}
