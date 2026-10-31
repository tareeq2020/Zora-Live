/* Shared checkout contract — used by checkout-flow.tsx (flag switch),
   checkout-flow-v1.tsx (fallback) and checkout-flow-v2.tsx (BS122). */

export type CheckoutTier = {
  tierId: string;
  name: string;
  unitPrice: number;
  currency?: string;
  split?: boolean;   // BS8: a splittable table tier — surfaces the "Split a table" CTA
  seats?: number;    // BS8: seats per table (max splitters); defaults to 8
  disabled?: boolean; // BS23: hidden from the storefront / not purchasable
  usd?: number;      // BS65: original USD price — shown in brackets beside the TZS price
  /** BS122 → BS126 plug-in: seats already picked on the seat map for this tier.
      When present, v2 locks the quantity to seatIds.length and sends the ids on
      the cart line ({ tier, quantity, seatIds }), which POST /api/checkout
      already accepts (BS125). */
  seatIds?: string[];
  /** BS126: a quantity already chosen on the seat map (GA zones, no seat ids). */
  quantity?: number;
};

export type CheckoutFlowProps = {
  open: boolean;
  onClose: () => void;
  eventName: string;
  /** Event id — sent with every checkout analytics event and the flag lookup. */
  eventId?: string;
  when?: string; // "SAT 08 AUG · 12:00 · THE VENUE" (v1 header line)
  tiers: CheckoutTier[];
  /** Brand accent (organizer theme). v1 only. */
  accent?: string;
  // ── BS122 (v2 summary column) — all optional so older callers still work ──
  /** Organizer handle — resolves the zp_checkout_v2 flag for this org. */
  organizerHandle?: string;
  /** Event artwork URL for the summary thumbnail. */
  artwork?: string;
  /** Human date label ("Sat 7 Nov"). */
  dateLabel?: string;
  time?: string;
  venue?: string;
  /** City name in full ("Dar es Salaam"). */
  city?: string;
  // ── BS126 seat map hooks — all optional ──
  /** The tiers carry the buyer's picks (seatIds / quantity): skip the pass
      picker and check out exactly those lines. */
  seatMode?: boolean;
  /** 409 seat_taken — the seat map marks these seats and keeps the rest. */
  onSeatTaken?: (seatIds: string[]) => void;
  /** The server hold window (holdExpiresAt) for the seat map's countdown. */
  onHold?: (holdExpiresAt: string | null) => void;
  /** Terminal order status (paid / failed / expired …). */
  onResult?: (status: string) => void;
};
