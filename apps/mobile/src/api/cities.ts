import { useEffect, useState } from 'react';
import { apiFetch } from './client';

/* BS168: cities come from GET /api/cities (the `city` table): the cities that
   have upcoming events, busiest first. No list lives in the app. */

export interface City {
  id: string;
  name: string;
  country: string;
  currency: string;
  upcoming: number;
}

export const listCities = async (): Promise<City[]> => {
  const d = await apiFetch<{ cities?: City[] }>('/api/cities', { auth: false });
  return Array.isArray(d?.cities) ? d.cities : [];
};

export function useCities() {
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    listCities()
      .then((c) => { if (alive) setCities(c); })
      .catch(() => { if (alive) setCities([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { cities, loading };
}
