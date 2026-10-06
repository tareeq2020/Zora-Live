import { apiFetch } from './client';

export interface OrgTier {
  tierId: string | null;
  name: string;
  unitPrice: number;
  capacity: number;
  sold: number;
  available: number;
  currency: string;
}

export interface OrgEvent {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  venue: string | null;
  date: string | null;
  dateLabel: string | null;
  time: string | null;
  priceFrom: number | null;
  seated: boolean;
  status: 'published' | 'draft' | 'archived' | string;
  sellable: boolean;
  tiers: OrgTier[];
}

export interface OrgSummary {
  totals: {
    revenue: number;
    netRevenue: number;
    sold: number;
    orders: number;
    currency: string | null;
  };
  events: Array<{
    id: string;
    name: string;
    revenue: number;
    netRevenue: number;
    sold: number;
    orders: number;
    currency: string | null;
  }>;
}

export interface OrgOrderRow {
  orderId: string;
  eventId: string;
  eventName: string | null;
  tier: string;
  qty: number;
  amount: number;
  currency: string;
  status: string;
  buyer: { phone: string | null; email: string | null };
  credentials: string[];
  createdAt: string;
}

export interface OrgOrdersPage {
  rows: OrgOrderRow[];
  nextCursor: string | null;
}

export interface OrgScanAuditRow {
  credentialId: string;
  publicRef: string;
  state: 'issued' | 'scanned' | 'wristband_issued' | 'used' | 'revoked' | string;
  eventId: string;
  eventName: string;
  scannedAt: string | null;
  scannedByName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
}

export interface OrgScanAudit {
  totals: {
    issued: number;
    scanned: number;
    wristband_issued: number;
    used: number;
    revoked: number;
  };
  rows: OrgScanAuditRow[];
}

export const getOrgEvents = () => apiFetch<OrgEvent[]>('/api/org/events');
export const getOrgSummary = () => apiFetch<OrgSummary>('/api/org/summary');
export const getOrgOrders = (params: { limit?: number; q?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.q?.trim()) q.set('q', params.q.trim());
  return apiFetch<OrgOrdersPage>(`/api/org/orders${q.toString() ? `?${q.toString()}` : ''}`);
};
export const getOrgScanAudit = () => apiFetch<OrgScanAudit>('/api/org/scanners/audit');
