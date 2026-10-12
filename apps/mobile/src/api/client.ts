import * as SecureStore from 'expo-secure-store';

const DEFAULT_API_URL = 'http://localhost:4101';
const SESSION_COOKIE_KEY = 'zora.mobile.sessionCookie';
const CONSUMER_COOKIE_KEY = 'zora.mobile.consumerCookie';
const CHECKOUT_COOKIE_KEY = 'zora.mobile.checkoutCookie';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  timeoutMs?: number;
  auth?: boolean | 'organizer' | 'consumer' | 'checkout';
};

export const getSessionCookie = () => SecureStore.getItemAsync(SESSION_COOKIE_KEY);
export const saveSessionCookie = (cookie: string) => SecureStore.setItemAsync(SESSION_COOKIE_KEY, cookie);
export const clearSessionCookie = () => SecureStore.deleteItemAsync(SESSION_COOKIE_KEY);
export const getConsumerCookie = () => SecureStore.getItemAsync(CONSUMER_COOKIE_KEY);
export const saveConsumerCookie = (cookie: string) => SecureStore.setItemAsync(CONSUMER_COOKIE_KEY, cookie);
export const clearConsumerCookie = () => SecureStore.deleteItemAsync(CONSUMER_COOKIE_KEY);
export const getCheckoutCookie = () => SecureStore.getItemAsync(CHECKOUT_COOKIE_KEY);
export const saveCheckoutCookie = (cookie: string) => SecureStore.setItemAsync(CHECKOUT_COOKIE_KEY, cookie);
export const clearCheckoutCookie = () => SecureStore.deleteItemAsync(CHECKOUT_COOKIE_KEY);
export const clearApiCookies = () => Promise.all([clearSessionCookie(), clearConsumerCookie(), clearCheckoutCookie()]);

function extractCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('set-cookie');
  if (!raw) return null;
  const match = raw.match(new RegExp(`${name}=[^;,]+`));
  return match ? match[0] : null;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12000);
  const headers = new Headers(options.headers);

  if (options.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.auth !== false && !headers.has('Cookie')) {
    const cookie = options.auth === 'consumer'
      ? await getConsumerCookie()
      : options.auth === 'checkout'
        ? await getCheckoutCookie()
        : await getSessionCookie();
    if (cookie) headers.set('Cookie', cookie);
  }

  try {
    const res = await fetch(`${API_URL}${path.startsWith('/') ? path : `/${path}`}`, {
      ...options,
      headers,
      body: options.body == null ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'include',
    });

    const sessionCookie = extractCookie(res.headers, 'zora_session');
    const consumerCookie = extractCookie(res.headers, 'zora_buyer');
    const checkoutCookie = extractCookie(res.headers, 'zora_checkout');
    if (sessionCookie) await saveSessionCookie(sessionCookie);
    if (consumerCookie) await saveConsumerCookie(consumerCookie);
    if (checkoutCookie) await saveCheckoutCookie(checkoutCookie);

    if (!res.ok) {
      let message = `API responded ${res.status}`;
      try {
        const data = await res.json();
        message = data?.message || data?.error || message;
      } catch {
        /* keep generic message */
      }
      throw new ApiError(res.status, message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
