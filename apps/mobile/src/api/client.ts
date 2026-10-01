import * as SecureStore from 'expo-secure-store';

const DEFAULT_API_URL = 'http://localhost:4101';
const SESSION_COOKIE_KEY = 'zora.mobile.sessionCookie';

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
  auth?: boolean;
};

export const getSessionCookie = () => SecureStore.getItemAsync(SESSION_COOKIE_KEY);
export const saveSessionCookie = (cookie: string) => SecureStore.setItemAsync(SESSION_COOKIE_KEY, cookie);
export const clearSessionCookie = () => SecureStore.deleteItemAsync(SESSION_COOKIE_KEY);

function extractSessionCookie(headers: Headers): string | null {
  const raw = headers.get('set-cookie');
  if (!raw) return null;
  const match = raw.match(/zora_session=[^;,]+/);
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
    const cookie = await getSessionCookie();
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

    const sessionCookie = extractSessionCookie(res.headers);
    if (sessionCookie) await saveSessionCookie(sessionCookie);

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
