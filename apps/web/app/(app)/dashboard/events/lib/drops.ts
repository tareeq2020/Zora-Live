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
};

// A tier as returned by GET /api/org/events (richer than the write shape).
export type OrgTier = {
  tierId?: string;
  name: string;
  unitPrice: number;
  capacity: number;
  sold?: number;
  available?: number;
  currency?: string;
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
export type DropTierInput = { name: string; price: number; capacity: number; splitEnabled?: boolean };

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
  priceFrom: number;
  seated: boolean;
  sellable: boolean;
  tiers: DropTierInput[];
  idempotencyKey: string;
};

// ── editor form state (strings, so inputs stay controlled + empty-friendly) ──

export type TierRow = { name: string; price: string; capacity: string; splitEnabled?: boolean };

export type DropForm = {
  name: string;
  dateLabel: string;
  time: string;
  city: string;
  venue: string;
  category: string;
  seated: boolean;
  sellable: boolean;
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
  seated: false,
  sellable: false,
  tiers: [emptyTier()],
});

// Hydrate the editable form from a server event (edit route prefill).
export function formFromEvent(ev: OrgEvent): DropForm {
  const tiers = (ev.tiers || []).map((t) => ({
    name: t.name || '',
    price: t.unitPrice != null ? String(t.unitPrice) : '',
    capacity: t.capacity != null ? String(t.capacity) : '',
    splitEnabled: !!(t as { split?: boolean }).split,
  }));
  return {
    name: ev.name || '',
    dateLabel: ev.dateLabel || '',
    time: ev.time || '',
    city: ev.city || '',
    venue: ev.venue || '',
    category: ev.category || '',
    seated: !!ev.seated,
    sellable: !!ev.sellable,
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
export function usableTiers(form: DropForm): DropTierInput[] {
  return form.tiers
    .filter((t) => t.name.trim() !== '' || t.price.trim() !== '' || t.capacity.trim() !== '')
    .map((t) => ({ name: t.name.trim(), price: Number(t.price) || 0, capacity: Number(t.capacity) || 0, splitEnabled: !!t.splitEnabled }));
}

export function priceFromOf(tiers: DropTierInput[]): number {
  const priced = tiers.map((t) => t.price).filter((p) => Number.isFinite(p) && p >= 0);
  return priced.length ? Math.min(...priced) : 0;
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

export function buildBody(form: DropForm, idempotencyKey: string): DropInput {
  const tiers = usableTiers(form);
  return {
    name: form.name.trim(),
    dateLabel: form.dateLabel.trim(),
    time: form.time.trim(),
    city: form.city.trim(),
    venue: form.venue.trim(),
    category: form.category.trim(),
    priceFrom: priceFromOf(tiers),
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
  if (err.error === 'priceFrom_invalid') return 'Set a valid starting price to publish.';
  if (err.error === 'seated_required') return 'Choose whether this is a seated event.';
  if (err.error === 'tiers_required') return 'A public drop needs at least one ticket tier.';
  if (err.error === 'capacity_below_committed') return "You can't drop capacity below tickets already sold or held.";
  if (err.error === 'suspended') return 'Your account is suspended. Contact ZORA support.';
  if (err.message) return err.message;
  if (err.error) return err.error;
  return context === 'delete' ? 'Could not delete this drop. Please try again.' : 'Could not save this drop. Please try again.';
}
