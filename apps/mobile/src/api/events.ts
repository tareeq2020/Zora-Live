import { useEffect, useState } from 'react';
import { apiFetch } from './client';

// The full canonical event body (matches the site's events.json shape).
export interface EventProps {
  id: string;
  name: string;
  tagline?: string;
  category?: string;
  city?: string;            // code: dar | nairobi | lagos …
  venue?: string;
  dateLabel?: string;
  time?: string;
  priceFrom?: number;
  weekend?: boolean;
  mega?: boolean;
  seated?: boolean;
  organizerHandle?: string;
}

export interface RemoteEvent {
  id: string;
  name: string;
  city: string | null;
  status: string;
  cover: string | null;
  props: EventProps;
}

function normalizeEvent(e: any): RemoteEvent {
  const props: EventProps = {
    id: String(e?.id ?? ''),
    name: String(e?.name ?? 'Untitled event'),
    tagline: e?.tagline,
    category: e?.category,
    city: e?.city,
    venue: e?.venue,
    dateLabel: e?.dateLabel ?? e?.date,
    time: e?.time,
    priceFrom: typeof e?.priceFrom === 'number' ? e.priceFrom : undefined,
    weekend: Boolean(e?.weekend),
    mega: Boolean(e?.mega),
    seated: Boolean(e?.seated),
    organizerHandle: e?.organizerHandle,
  };
  return {
    id: props.id,
    name: props.name,
    city: props.city ?? null,
    status: String(e?.status ?? 'published'),
    cover: e?.cover ?? e?.theme?.posterColor ?? null,
    props,
  };
};

export const listEvents = async (cityCode?: string) => {
  const q = cityCode ? `?city=${encodeURIComponent(cityCode)}` : '';
  const rows = await apiFetch<any[]>(`/api/events${q}`, { auth: false });
  return rows.map(normalizeEvent);
};

export const getEvent = async (id: string) => normalizeEvent(await apiFetch<any>(`/api/events/${encodeURIComponent(id)}`, { auth: false }));

/** Published event list for a city code. Realtime comes later via the Nest API. */
export function useEvents(cityCode?: string) {
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => listEvents(cityCode)
      .then((data) => { if (alive) setEvents(data); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setLoading(false); });
    load();
    return () => { alive = false; };
  }, [cityCode]);

  return { events, loading };
}
