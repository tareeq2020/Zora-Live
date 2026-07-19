/* PR-8: x-bridge payment-gateway adapter.
   ONE upstream ("x-bridge") that internally routes to CLICKPESA / SELCOM /
   GODIGITAL — the app NEVER calls an FSP directly, only this module. Auth is a
   single-flight cached JWT: concurrent callers share one in-flight token fetch,
   the token is reused until ~60s before expiry.

   MOCK mode (XBRIDGE_MOCK==='true' OR no XBRIDGE_KEY_ID): skips the token + HTTP
   entirely and returns deterministic responses. We have no live gateway creds
   yet, so this is what lets PR-9's pay endpoint + state machine be built and
   tested fully offline. ClickPesa/Selcom creds live INSIDE the gateway, never
   here — this module only knows XBRIDGE_KEY_ID / XBRIDGE_SECRET. */

const CURRENCY = 'TZS';

export interface XbridgeConfig {
  baseUrl: string;
  keyId?: string;
  secret?: string;
  mock: boolean;
}

/** Read config from env at call time (so tests can toggle env between calls). */
export function xbridgeConfig(env: NodeJS.ProcessEnv = process.env): XbridgeConfig {
  const keyId = env.XBRIDGE_KEY_ID;
  return {
    baseUrl: env.XBRIDGE_BASE_URL || 'http://localhost:3001/api',
    keyId,
    secret: env.XBRIDGE_SECRET,
    // No creds ⇒ we physically cannot auth, so mock is the only sane default.
    mock: env.XBRIDGE_MOCK === 'true' || !keyId,
  };
}

/* ── Single-flight cached JWT ─────────────────────────────────────────── */

let _token: { token: string; expiresAt: number } | null = null;
let _tokenInflight: Promise<string> | null = null;

/** Test seam: drop any cached/in-flight token. */
export function __resetTokenCache(): void {
  _token = null;
  _tokenInflight = null;
}

async function fetchToken(cfg: XbridgeConfig): Promise<string> {
  const path = '/generate-token';
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: cfg.keyId, secret: cfg.secret }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`x-bridge ${path} failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { token: string; expiresAt: string };
  _token = { token: json.token, expiresAt: Date.parse(json.expiresAt) };
  return json.token;
}

async function getToken(cfg: XbridgeConfig): Promise<string> {
  const now = Date.now();
  if (_token && _token.expiresAt - 60_000 > now) return _token.token;
  // Coalesce concurrent misses onto one fetch; clear the slot once it settles.
  if (!_tokenInflight) {
    _tokenInflight = fetchToken(cfg).finally(() => {
      _tokenInflight = null;
    });
  }
  return _tokenInflight;
}

/** Authed JSON call: Bearer token + JSON headers; non-2xx throws with body text. */
async function authed(cfg: XbridgeConfig, path: string, init: { method: string; body?: string }): Promise<any> {
  const token = await getToken(cfg);
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`x-bridge ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Tanzanian MSISDN → E.164-ish "+255…": strip non-digits, leading 0 → 255, add +. */
export function normalizeMsisdn(phone: string): string {
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '255' + digits.slice(1);
  return '+' + digits;
}

/** Card checkout URL from a collection response (either field the gateway may use). */
export function cardCheckoutUrl(resp: { cardPaymentLink?: string; paymentGatewayUrl?: string }): string | undefined {
  return resp.cardPaymentLink ?? resp.paymentGatewayUrl;
}

/* ── Mock responses ───────────────────────────────────────────────────── */

function mockCollect(transactionId: string) {
  return {
    orderReference: 'MOCK-' + transactionId,
    billPayNumber: 'MOCK-CN',
    paymentGatewayUrl: 'https://mock/checkout',
    gatewayResponse: { status: 'PENDING' as const },
  };
}

// PR-9's state machine drives off collectionStatus; make its mock steerable so a
// test can force PENDING/PARTIAL/FAILED. Default: COMPLETED, fully collected.
const _mockStatus = new Map<string, CollectionStatusResponse>();

/** Test seam: force the next collectionStatus() result for a transaction. */
export function __setMockCollectionStatus(
  transactionId: string,
  resp: Partial<CollectionStatusResponse> & { status: CollectionStatus },
): void {
  _mockStatus.set(transactionId, { transactionId, ...resp });
}

/** Test seam: clear all forced mock statuses. */
export function __clearMockCollectionStatus(): void {
  _mockStatus.clear();
}

/* ── Collection contracts ─────────────────────────────────────────────── */

export interface CollectMobileInput {
  transactionId: string;
  amount: number;
  payerPhone: string;
  fspId: string;
  callbackUrl: string;
}

export interface CollectMobileResponse {
  orderReference: string;
  gatewayResponse: any;
}

/** Mobile-money push (STK). POST /collection/mobile. */
export async function collectMobile(input: CollectMobileInput, cfg = xbridgeConfig()): Promise<CollectMobileResponse> {
  if (cfg.mock) {
    const m = mockCollect(input.transactionId);
    return { orderReference: m.orderReference, gatewayResponse: m.gatewayResponse };
  }
  const body = {
    transactionId: input.transactionId,
    amount: input.amount,
    currency: CURRENCY,
    payerPhone: input.payerPhone,
    fspId: input.fspId,
    callback_url: input.callbackUrl,
  };
  const json = await authed(cfg, '/collection/mobile', { method: 'POST', body: JSON.stringify(body) });
  return { orderReference: json.orderReference, gatewayResponse: json.gatewayResponse };
}

export interface CollectBillPayInput {
  transactionId: string;
  amount: number;
  payerName: string;
  payerPhone: string;
  fspId: string;
  callbackUrl: string;
  paymentMode?: string; // default 'EXACT'; ONLY honoured for CLICKPESA
}

export interface CollectBillPayResponse {
  billPayNumber: string;
  orderReference: string;
}

/** Bill-pay / control-number collection. POST /collection/billpay.
    paymentMode is CLICKPESA-only — Selcom 400s if it's present. */
export async function collectBillPay(input: CollectBillPayInput, cfg = xbridgeConfig()): Promise<CollectBillPayResponse> {
  if (cfg.mock) {
    const m = mockCollect(input.transactionId);
    return { billPayNumber: m.billPayNumber, orderReference: m.orderReference };
  }
  const body = {
    transactionId: input.transactionId,
    amount: input.amount,
    currency: CURRENCY,
    payerName: input.payerName,
    payerPhone: input.payerPhone,
    fspId: input.fspId,
    callback_url: input.callbackUrl,
    ...(input.fspId === 'CLICKPESA' && input.paymentMode ? { paymentMode: input.paymentMode } : {}),
  };
  const json = await authed(cfg, '/collection/billpay', { method: 'POST', body: JSON.stringify(body) });
  return { billPayNumber: json.billPayNumber, orderReference: json.orderReference ?? json.reference };
}

export interface CollectCardInput {
  fspId: string; // REQUIRED, provider-shaped
  transactionId: string;
  amount: number;
  noOfItems: number;
  buyer: any;
  billing: any;
  redirectUrl: string;
  cancelUrl: string;
}

export interface CollectCardResponse {
  paymentGatewayUrl?: string;
  cardPaymentLink?: string;
  orderReference?: string;
  [k: string]: any;
}

/** Card / hosted-checkout collection. POST /collection/card. */
export async function collectCard(input: CollectCardInput, cfg = xbridgeConfig()): Promise<CollectCardResponse> {
  if (cfg.mock) {
    const m = mockCollect(input.transactionId);
    return { paymentGatewayUrl: m.paymentGatewayUrl, orderReference: m.orderReference };
  }
  const body = { currency: CURRENCY, ...input };
  return authed(cfg, '/collection/card', { method: 'POST', body: JSON.stringify(body) });
}

export type CollectionStatus = 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

export interface CollectionStatusResponse {
  transactionId: string;
  status: CollectionStatus;
  amount?: string; // gateway returns money as strings
  collectedAmount?: string;
  orderReference?: string;
}

/** Poll collection status. GET /collection/status. fspId is REQUIRED. */
export async function collectionStatus(
  transactionId: string,
  fspId: string,
  cfg = xbridgeConfig(),
): Promise<CollectionStatusResponse> {
  if (cfg.mock) {
    const forced = _mockStatus.get(transactionId);
    if (forced) return forced;
    return {
      transactionId,
      status: 'COMPLETED',
      amount: '1000',
      collectedAmount: '1000',
      orderReference: 'MOCK-' + transactionId,
    };
  }
  const path = `/collection/status?transactionId=${encodeURIComponent(transactionId)}&fspId=${encodeURIComponent(fspId)}`;
  return authed(cfg, path, { method: 'GET' });
}
