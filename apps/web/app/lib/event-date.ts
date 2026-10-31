/* BS147: one source for how an event's date reads on buyer surfaces.
   The organizer's free-text dateLabel ("Sat 13th March 2027") made cards
   inconsistent next to "SAT 14 NOV", so the structured ISO date wins whenever
   it exists: "Sat 14 Nov", plus the year only when it isn't this year
   ("Sat 13 Mar 2027"). Callers uppercase for mono labels. */

function parseIso(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function eventDateLabel(iso: string | null | undefined, fallback?: string | null, now: Date = new Date()): string {
  const d = parseIso(iso);
  if (!d) return (fallback || '').trim();
  const base = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** True when the event's date is before today (local). No date → not past. */
export function isPastEvent(iso: string | null | undefined, now: Date = new Date()): boolean {
  const d = parseIso(iso);
  if (!d) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime() < today.getTime();
}
