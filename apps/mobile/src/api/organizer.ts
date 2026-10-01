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

export const getOrgEvents = () => apiFetch<OrgEvent[]>('/api/org/events');
export const getOrgSummary = () => apiFetch<OrgSummary>('/api/org/summary');
