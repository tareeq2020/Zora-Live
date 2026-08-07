/* Canonical event-city list. Event.city must be one of these ids — discover's
   city filter and the organizer's event-city select both read off this exact
   list, so a freetext mismatch (e.g. "Dar Es Salaam" vs the filter's "dar")
   can never again silently hide an event from its own city page (BS47).
   Mirrors apps/api/src/common/defaults.ts's EVENT_CITIES; keep both in step
   when a city is added. */

export type City = { id: string; city: string; country: string; cur: string };

export const CITIES: City[] = [
  { id: 'dar', city: 'Dar es Salaam', country: 'Tanzania', cur: 'TZS' },
  { id: 'zanzibar', city: 'Zanzibar', country: 'Tanzania', cur: 'TZS' },
  { id: 'nairobi', city: 'Nairobi', country: 'Kenya', cur: 'KES' },
  { id: 'accra', city: 'Accra', country: 'Ghana', cur: 'GHS' },
  { id: 'lagos', city: 'Lagos', country: 'Nigeria', cur: 'NGN' },
];
