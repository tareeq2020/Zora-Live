import { apiFetch } from './client';

export interface ConsumerTicket {
  publicRef: string;
  tier: string;
  eventName: string;
  seatIndex?: number | null;
  tableNo?: string | null;
  code: string;
  qr: string;
}

export async function listMyTickets() {
  const data = await apiFetch<{ tickets: ConsumerTicket[] }>('/api/me/tickets', { auth: 'consumer' });
  return data.tickets ?? [];
}

