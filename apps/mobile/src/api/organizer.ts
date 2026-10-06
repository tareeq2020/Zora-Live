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

export interface OrgEventTierPatch {
  tierId?: string | null;
  name: string;
  price: number;
  capacity: number;
  currency?: string;
}

export interface OrgScanner {
  id: string;
  name: string;
  contact: string;
  via: string;
  event: string;
  eventScope: string | null;
  role: 'agent' | 'supervisor' | string;
  code: string;
  status: 'active' | 'revoked' | string;
  organizerHandle: string | null;
  canSell: boolean;
  createdAt: string;
  expiresAt: string | null;
  lastSeenAt: string | null;
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
export const updateOrgEvent = (id: string, body: { tiers?: OrgEventTierPatch[] }) =>
  apiFetch<OrgEvent>(`/api/org/events/${encodeURIComponent(id)}`, { method: 'PUT', body });
export const getOrgScanners = () => apiFetch<OrgScanner[]>('/api/org/scanners');
export const createOrgScanner = (body: { name: string; contact: string; eventId: string; role: 'agent' | 'supervisor'; canSell: boolean }) =>
  apiFetch<OrgScanner>('/api/org/scanners', { method: 'POST', body });
export const rotateOrgScanner = (id: string) =>
  apiFetch<OrgScanner>(`/api/org/scanners/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
export const revokeOrgScanner = (id: string) =>
  apiFetch<OrgScanner>(`/api/org/scanners/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
