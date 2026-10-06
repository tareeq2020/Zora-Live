import { apiFetch } from './client';

export type PayoutStatus = 'requested' | 'approved' | 'rejected';
export type PayoutMethod = 'mobile_money' | 'bank';

export interface PayoutDestination {
  method: PayoutMethod;
  provider: string;
  providerName: string;
  account: string;
  accountName: string | null;
}

export interface PayoutBalance {
  currency: string;
  earned: number;
  reserved: number;
  paidOut: number;
  available: number;
  minimum: number;
}

export interface PayoutRecord {
  id: string;
  organizerHandle: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  reference: string | null;
  fxNote: string | null;
  note: string | null;
  reason: string | null;
  destination: PayoutDestination | null;
}

export interface PayoutsView {
  balances: PayoutBalance[];
  payouts: PayoutRecord[];
  verified: boolean;
  commissionRate: number;
  pendingCount: number;
}

export interface PayoutDestinationCatalog {
  methods: { id: PayoutMethod; label: string }[];
  banks: { code: string; name: string }[];
  mnos: { code: string; name: string }[];
}

export interface RequestPayoutInput {
  amount: number;
  currency: string;
  note?: string | null;
  destination: {
    method: PayoutMethod;
    provider: string;
    account: string;
    accountName?: string | null;
  };
}

export interface RequestPayoutResponse {
  ok: true;
  payout: PayoutRecord;
  balance: PayoutBalance;
}

export const getOrgPayouts = () => apiFetch<PayoutsView>('/api/org/payouts');
export const getPayoutMethods = () => apiFetch<PayoutDestinationCatalog>('/api/org/payouts/methods');
export const requestOrgPayout = (input: RequestPayoutInput) =>
  apiFetch<RequestPayoutResponse>('/api/org/payouts', { method: 'POST', body: input });
