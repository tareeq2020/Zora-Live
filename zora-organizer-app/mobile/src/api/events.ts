// Events data layer — the single source of truth is the shared Supabase `events`
// table (same rows the website reads). Each row carries the full canonical event
// object in `props`; useEvents() subscribes to realtime, so anything created on
// the website appears here instantly (and vice-versa).
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

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
  id: string;               // uuid
  name: string;
  city: string | null;      // code, mirrored for querying
  status: string;
  cover: string | null;
  props: EventProps;
}

export const listEvents = (cityCode?: string) => {
  let q = supabase.from('events').select('*').eq('status', 'published');
  if (cityCode) q = q.eq('city', cityCode);
  return q;
};

export const getEvent = (id: string) => supabase.from('events').select('*').eq('id', id).single();

/** Live list of published events for a city code, kept current via realtime. */
export function useEvents(cityCode?: string) {
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listEvents(cityCode).then(({ data }) => {
        if (alive) { setEvents((data ?? []) as RemoteEvent[]); setLoading(false); }
      });
    load();

    const channel = supabase
      .channel('public:events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, load)
      .subscribe();

    return () => { alive = false; supabase.removeChannel(channel); };
  }, [cityCode]);

  return { events, loading };
}
