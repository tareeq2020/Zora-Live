import { apiFetch } from './client';

export interface ConsumerTicket {
  publicRef: string;
  tier: string;
  eventId?: string;
  eventName: string;
  venue?: string | null;
  dateLabel?: string | null;
  seatIndex?: number | null;
  tableNo?: string | null;
  state?: string;
  issuedAt?: string;
  code: string;
  qr: string;
}

export async function requestConsumerOtp(phone: string) {
  return apiFetch<{ ok: boolean; expiresInSec: number; code?: string }>('/api/otp/request', {
    method: 'POST',
    auth: false,
    body: { phone },
  });
}

export async function verifyConsumerOtp(phone: string, code: string) {
  return apiFetch<{ ok: boolean; role: 'consumer'; phone: string }>('/api/otp/verify', {
    method: 'POST',
    auth: false,
    body: { phone, code },
  });
}

export async function listMyTickets() {
  const data = await apiFetch<{ tickets: ConsumerTicket[] }>('/api/me/tickets', { auth: 'consumer' });
  return data.tickets ?? [];
}
