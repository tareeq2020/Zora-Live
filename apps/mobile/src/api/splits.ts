import { apiFetch } from './client';

export interface SplitShare {
  index: number;
  amount: number;
  isHost: boolean;
  token: string | null;
}

export interface CreatedSplit {
  splitId: string;
  target: number;
  hostShare: number;
  inviteeShare: number;
  shares: SplitShare[];
}

export async function createTableSplit(input: { tierId: string; capacityN: number }) {
  return apiFetch<CreatedSplit>('/api/splits', {
    method: 'POST',
    auth: 'consumer',
    body: input,
  });
}

export async function payMySplitShare(splitId: string) {
  return apiFetch<{ orderId: string; amount: number }>(`/api/splits/${encodeURIComponent(splitId)}/pay-mine`, {
    method: 'POST',
    auth: 'consumer',
  });
}
