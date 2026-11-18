/* BS166: x-bridge /v1 Payments client (card checkout, method list, status
   read, collection list).

   /v1 differs from the /collection/* routes in xbridge.ts:
   - Base URL is the API origin (https://api.xbridge.co.tz). The routes are
     /v1/payments/..., with no /api prefix. XBRIDGE_V1_BASE_URL sets it;
     otherwise it is XBRIDGE_BASE_URL with a trailing /api removed.
   - The token comes from POST /v1/identity/token. It lasts 15 minutes and is
     renewed at refreshAfter. The key is XBRIDGE_V1_KEY_ID / XBRIDGE_V1_SECRET,
     else XBRIDGE_KEY_ID / XBRIDGE_SECRET. Card needs collection:write; reads
     need collection:read.
   - An error is { statusCode, code, message }. XbridgeV1Error carries the
     status and the code, so a caller can tell a refusal (4xx: nothing was
     taken) from a network failure.

   MOCK mode applies when xbridge.ts says so (no key, or XBRIDGE_MOCK=true).
   The status read then uses the same mock seams as collectionStatus(), so
   one status file steers both. */

import { readFileSync } from 'node:fs';
import { xbridgeConfig, mockCollectionStatus, collectionStatus, type CollectionStatusResponse } from './xbridge';

export interface XbridgeV1Config {
  baseUrl: string;
  keyId?: string;
  secret?: string;
  mock: boolean;
}

export function xbridgeV1Config(env: NodeJS.ProcessEnv = process.env): XbridgeV1Config {
  const legacy = xbridgeConfig(env);
  const base = (env.XBRIDGE_V1_BASE_URL || legacy.baseUrl).replace(/\/+$/, '').replace(/\/api$/, '');
  return {
    baseUrl: base,
    keyId: env.XBRIDGE_V1_KEY_ID || legacy.keyId,
    secret: env.XBRIDGE_V1_SECRET || legacy.secret,
    mock: legacy.mock,
  };
}

/** A /v1 refusal or failure, with x-bridge's code when it sent one. */
export class XbridgeV1Error extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly code: string | null,
    public readonly detail: string,
    public readonly body: string,
  ) {
    super(`x-bridge ${path} failed: ${status} ${body}`);
    this.name = 'XbridgeV1Error';
  }
  /** 4xx: x-bridge understood the request and refused it; nothing was taken. */
  get refused(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

function parseError(status: number, path: string, text: string): XbridgeV1Error {
  let code: string | null = null;
  let detail = text;
  try {
    const j = JSON.parse(text);
    if (j && typeof j.code === 'string') code = j.code;
    const m = j?.message;
    detail = Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : text;
  } catch { /* not JSON: keep the text */ }
  return new XbridgeV1Error(status, path, code, String(detail).slice(0, 300), text.slice(0, 2000));
}

/* ── token ───────────────────────────────────────────────────────────── */

let _tok: { token: string; refreshAt: number; expiresAt: number } | null = null;
let _tokInflight: Promise<string> | null = null;

export function __resetV1TokenCache(): void {
  _tok = null;
  _tokInflight = null;
}

async function fetchV1Token(cfg: XbridgeV1Config): Promise<string> {
  const path = '/v1/identity/token';
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: cfg.keyId, secret: cfg.secret }),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw parseError(res.status, path, text);
  const j = JSON.parse(text) as { accessToken: string; expiresAt?: string; refreshAfter?: string; expiresIn?: number };
  const now = Date.now();
  const expiresAt = j.expiresAt ? Date.parse(j.expiresAt) : now + (j.expiresIn ?? 900) * 1000;
  const refreshAt = j.refreshAfter ? Date.parse(j.refreshAfter) : expiresAt - 180_000;
  _tok = { token: j.accessToken, refreshAt, expiresAt };
  return j.accessToken;
}

async function v1Token(cfg: XbridgeV1Config): Promise<string> {
  const now = Date.now();
  if (_tok && now < _tok.refreshAt) return _tok.token;
  if (!_tokInflight) {
    _tokInflight = fetchV1Token(cfg).finally(() => { _tokInflight = null; });
  }
  // A failed refresh still has a token that works until expiresAt.
  if (_tok && now < _tok.expiresAt - 30_000) return _tokInflight.catch(() => _tok!.token);
  return _tokInflight;
}

/** One authed /v1 call. Non-2xx throws XbridgeV1Error. */
export async function v1Request(
  path: string,
  init: { method: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal },
  cfg = xbridgeV1Config(),
): Promise<any> {
  const token = await v1Token(cfg);
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    ...(init.signal ? { signal: init.signal } : {}),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw parseError(res.status, path, text);
  return text ? JSON.parse(text) : {};
}

/* ── methods ─────────────────────────────────────────────────────────── */

export interface XbridgeMethod {
  method: string;
  currencies: string[];
  billing_address_required?: string[];
  via?: string;
}

export interface CardAvailability {
  /** x-bridge can take card in this currency for us right now. */
  available: boolean;
  /** x-bridge needs the payer's billing address for this currency. */
  billingRequired: boolean;
  /** Where the answer came from: x-bridge, a cached answer, the mock, or a failed read. */
  source: 'xbridge' | 'cache' | 'mock' | 'unreachable';
}

const METHODS_TTL_MS = 5 * 60_000;
let _methods: { at: number; list: XbridgeMethod[] } | null = null;

export function __resetMethodsCache(): void {
  _methods = null;
}

function mockMethods(env: NodeJS.ProcessEnv): XbridgeMethod[] {
  const list: XbridgeMethod[] = [{ method: 'mobile_money', currencies: ['TZS'] }];
  // XBRIDGE_MOCK_CARD=0 makes the mock answer as if card were not set up.
  if (env.XBRIDGE_MOCK_CARD !== '0') list.push({ method: 'card', currencies: ['TZS'], billing_address_required: ['TZS'] });
  return list;
}

/** GET /v1/payments/methods, cached for 5 minutes. */
export async function paymentMethodsV1(cfg = xbridgeV1Config(), env: NodeJS.ProcessEnv = process.env): Promise<XbridgeMethod[]> {
  if (cfg.mock) return mockMethods(env);
  if (_methods && Date.now() - _methods.at < METHODS_TTL_MS) return _methods.list;
  const j = await v1Request('/v1/payments/methods', { method: 'GET' }, cfg);
  const list: XbridgeMethod[] = Array.isArray(j?.methods) ? j.methods : [];
  _methods = { at: Date.now(), list };
  return list;
}

/** Whether checkout may offer card in `currency`. A failed read hides card
    (we never offer a method x-bridge may refuse), but a cached answer is used
    for up to an hour while x-bridge can't be reached. */
export async function cardAvailability(currency = 'TZS', cfg = xbridgeV1Config()): Promise<CardAvailability> {
  const pick = (list: XbridgeMethod[], source: CardAvailability['source']): CardAvailability => {
    const card = list.find((m) => m.method === 'card' && Array.isArray(m.currencies) && m.currencies.includes(currency));
    return {
      available: !!card,
      billingRequired: !!card && Array.isArray(card.billing_address_required) && card.billing_address_required.includes(currency),
      source,
    };
  };
  if (cfg.mock) return pick(await paymentMethodsV1(cfg), 'mock');
  const fresh = _methods && Date.now() - _methods.at < METHODS_TTL_MS;
  try {
    return pick(await paymentMethodsV1(cfg), fresh ? 'cache' : 'xbridge');
  } catch (e) {
    if (_methods && Date.now() - _methods.at < 60 * 60_000) return pick(_methods.list, 'cache');
    console.error('x-bridge methods read failed', (e as Error)?.message ?? e);
    return { available: false, billingRequired: true, source: 'unreachable' };
  }
}

/* ── card checkout ───────────────────────────────────────────────────── */

export interface CardBilling {
  firstname: string;
  lastname: string;
  address1: string;
  address2?: string;
  city: string;
  stateOrRegion: string;
  postcodeOrPobox: string;
  /** 2-letter country code, e.g. TZ. */
  country: string;
  phone: string;
}

export interface CreateCardInput {
  transactionId: string;
  amount: number;
  currency?: string;
  noOfItems?: number;
  buyer: { name: string; email: string; phone: string };
  billing?: CardBilling | null;
  redirectUrl: string;
  cancelUrl: string;
}

export interface CreateCardResponse {
  transactionId: string;
  orderReference: string | null;
  /** The hosted card page. Null in x-bridge's test mode (simulated). */
  paymentUrl: string | null;
  expiresAt: string | null;
  simulated: boolean;
  /** x-bridge answered an earlier identical request again (Idempotent-Replayed). */
  replayed?: boolean;
}

export const BILLING_FIELDS: readonly (keyof CardBilling)[] = [
  'firstname', 'lastname', 'address1', 'city', 'stateOrRegion', 'postcodeOrPobox', 'country', 'phone',
];

/** The billing fields that are missing or blank (address2 is optional). */
export function missingBillingFields(b: Partial<CardBilling> | null | undefined): string[] {
  if (!b) return [...BILLING_FIELDS];
  return BILLING_FIELDS.filter((k) => !String(b[k] ?? '').trim()).map(String)
    .concat(b.country && !/^[A-Za-z]{2}$/.test(String(b.country).trim()) ? ['country'] : []);
}

/** POST /v1/payments/collections/card. The Idempotency-Key is our attempt id,
    so a retry of the same attempt can never open a second checkout. */
export async function createCardCheckout(input: CreateCardInput, cfg = xbridgeV1Config()): Promise<CreateCardResponse> {
  const currency = input.currency ?? 'TZS';
  if (cfg.mock) {
    // The mock refuses a TZS card without a full billing address, like x-bridge.
    const missing = missingBillingFields(input.billing);
    if (!input.billing) {
      throw new XbridgeV1Error(400, '/v1/payments/collections/card', 'BILLING_ADDRESS_REQUIRED',
        `Card payments in ${currency} need the payer's billing address (billing).`,
        JSON.stringify({ statusCode: 400, code: 'BILLING_ADDRESS_REQUIRED' }));
    }
    if (missing.length) {
      throw new XbridgeV1Error(422, '/v1/payments/collections/card', 'CARD_HOLDER_DETAILS_REQUIRED',
        `Card payments need the card holder's ${missing.join(', ')}.`,
        JSON.stringify({ statusCode: 422, code: 'CARD_HOLDER_DETAILS_REQUIRED' }));
    }
    if (process.env.XBRIDGE_MOCK_CARD === '0') {
      throw new XbridgeV1Error(422, '/v1/payments/collections/card', 'NO_PROVIDER_FOR_METHOD',
        'No provider is set up for card collections.', JSON.stringify({ statusCode: 422, code: 'NO_PROVIDER_FOR_METHOD' }));
    }
    // XBRIDGE_MOCK_CARD_SIMULATED=1 answers like x-bridge's test mode (no page).
    const simulated = process.env.XBRIDGE_MOCK_CARD_SIMULATED === '1';
    const sep = input.redirectUrl.includes('?') ? '&' : '?';
    return {
      transactionId: input.transactionId,
      orderReference: 'MOCK-CARD-' + input.transactionId,
      // The mock's "hosted page" sends the buyer straight back to our return page.
      paymentUrl: simulated ? null : `${input.redirectUrl}${sep}mockcard=1`,
      expiresAt: simulated ? null : new Date(Date.now() + 60 * 60_000).toISOString(),
      simulated,
    };
  }
  const body: Record<string, unknown> = {
    amount: input.amount,
    currency,
    transactionId: input.transactionId,
    noOfItems: Math.max(1, Math.floor(input.noOfItems ?? 1)),
    redirectUrl: input.redirectUrl,
    cancelUrl: input.cancelUrl,
    buyer: input.buyer,
    ...(input.billing ? { billing: input.billing } : {}),
  };
  const j = await v1Request('/v1/payments/collections/card', {
    method: 'POST', body, headers: { 'Idempotency-Key': input.transactionId },
  }, cfg);
  return {
    transactionId: String(j?.transactionId ?? input.transactionId),
    orderReference: j?.orderReference ? String(j.orderReference) : null,
    paymentUrl: j?.paymentUrl ? String(j.paymentUrl) : null,
    expiresAt: j?.expiresAt ? String(j.expiresAt) : null,
    simulated: j?.simulated === true,
  };
}

/* ── status read ─────────────────────────────────────────────────────── */

/** GET /v1/payments/collections/status?transactionId= (ours or the
    orderReference). Same shape as the /collection/status answer plus
    EXPIRED / AUTH_PENDING_REVIEW, which are not final. A 404 throws. */
export async function collectionStatusV1(
  transactionId: string, cfg = xbridgeV1Config(), signal?: AbortSignal,
): Promise<CollectionStatusResponse> {
  if (cfg.mock) return mockCollectionStatus(transactionId);
  const path = `/v1/payments/collections/status?transactionId=${encodeURIComponent(transactionId)}`;
  return v1Request(path, { method: 'GET', signal }, cfg);
}

/* ── list ────────────────────────────────────────────────────────────── */

export interface ListedCollection {
  transactionId: string;
  orderReference: string | null;
  paymentMethod: string | null;
  status: string;
  amount: string | null;
  collectedAmount: string | null;
  currency: string | null;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function toListed(r: any): ListedCollection {
  return {
    transactionId: String(r?.transactionId ?? ''),
    orderReference: r?.orderReference ? String(r.orderReference) : null,
    paymentMethod: r?.paymentMethod ? String(r.paymentMethod) : null,
    status: String(r?.status ?? ''),
    amount: r?.amount != null ? String(r.amount) : null,
    collectedAmount: r?.collectedAmount != null ? String(r.collectedAmount) : null,
    currency: r?.currency ? String(r.currency) : null,
    failureReason: r?.failureReason ?? null,
    createdAt: r?.createdAt ? String(r.createdAt) : null,
    updatedAt: r?.updatedAt ? String(r.updatedAt) : null,
  };
}

/** Every collection x-bridge created between `from` and `to` (createdAt,
    UTC), newest first, 100 a page, at most maxPages pages. The mock reads
    XBRIDGE_MOCK_LIST_FILE (a JSON array of rows), else returns nothing. */
export async function listCollectionsV1(
  opts: { from: Date; to: Date; maxPages?: number; status?: string },
  cfg = xbridgeV1Config(),
): Promise<{ rows: ListedCollection[]; complete: boolean }> {
  if (cfg.mock) {
    const file = process.env.XBRIDGE_MOCK_LIST_FILE;
    if (!file) return { rows: [], complete: true };
    try {
      const arr = JSON.parse(readFileSync(file, 'utf8'));
      return { rows: (Array.isArray(arr) ? arr : []).map(toListed), complete: true };
    } catch {
      return { rows: [], complete: true };
    }
  }
  const maxPages = opts.maxPages ?? 30;
  const rows: ListedCollection[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      page: String(page), limit: '100', from: opts.from.toISOString(), to: opts.to.toISOString(),
      ...(opts.status ? { status: opts.status } : {}),
    });
    const j = await v1Request(`/v1/payments/collections/transactions?${qs}`, { method: 'GET' }, cfg);
    const data: any[] = Array.isArray(j?.data) ? j.data : [];
    rows.push(...data.map(toListed));
    const totalPages = Number(j?.totalPages ?? 0);
    if (!data.length || page >= totalPages) return { rows, complete: true };
  }
  return { rows, complete: false };
}

/* ── which status route an attempt uses ──────────────────────────────── */

/** payment_transaction.provider for an attempt created on a /v1 collection
    route (card today). Its status is read from /v1; every other attempt
    keeps /collection/status. ('xbridge_v1' is an installment receivable.) */
export const V1_COLLECTION_PROVIDER = 'xbridge_v1c';

/** Read an attempt's status on the route that created it. */
export function statusForAttempt(
  transactionId: string, provider: string | null | undefined, signal?: AbortSignal,
): Promise<CollectionStatusResponse> {
  return provider === V1_COLLECTION_PROVIDER
    ? collectionStatusV1(transactionId, undefined, signal)
    : collectionStatus(transactionId, undefined, signal);
}
