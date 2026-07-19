/* PR-8: pure FSP routing + fee resolution.
   ZORA talks to ONE upstream ("x-bridge") which internally fans out to the
   financial-service-providers (CLICKPESA / SELCOM / GODIGITAL). The *choice* of
   which FSP handles a given payment is policy, not gateway plumbing — so it lives
   here as a pure function fed the route map + rates from settings. Core stays
   framework/DB-free: the app loads the map (per-tenant overrides) and passes it in. */

export type FspId = 'CLICKPESA' | 'SELCOM' | 'GODIGITAL';
export type PaymentMethod = 'mobile' | 'billpay' | 'card';

/** Per-method routing: an optional MNO-keyed override plus a required-ish default.
    e.g. { mobile: { VODACOM: 'SELCOM', default: 'CLICKPESA' } }. */
export type FspRouteMap = Partial<Record<PaymentMethod, { default?: FspId } & Record<string, FspId | undefined>>>;

/** Sensible built-in routing when settings supply nothing. */
export const DEFAULT_FSP_ROUTE_MAP: FspRouteMap = {
  mobile: { default: 'CLICKPESA' },
  billpay: { default: 'CLICKPESA' },
  card: { default: 'SELCOM' },
};

/** Platform base take rate (3%) when no per-FSP override applies. */
export const DEFAULT_FEE_RATE = 0.03;

/** Resolve the FSP for a payment: MNO override → method default → CLICKPESA.
    Capability failover: GODIGITAL only does mobile; for card fall back to SELCOM,
    for anything else (billpay) fall back to CLICKPESA. */
export function resolveFsp(map: FspRouteMap, method: PaymentMethod, mno?: string): FspId {
  let chosen: FspId = (mno && map[method]?.[mno]) || map[method]?.default || 'CLICKPESA';
  if (chosen === 'GODIGITAL' && method !== 'mobile') {
    chosen = method === 'card' ? 'SELCOM' : 'CLICKPESA';
  }
  return chosen;
}

/** Effective fee rate for an FSP: a non-negative numeric override wins, else base. */
export function feeRateForFsp(overrides: Record<string, number>, base: number, fspId: FspId): number {
  return typeof overrides[fspId] === 'number' && overrides[fspId] >= 0 ? overrides[fspId] : base;
}
