/* BS134: "Pay in installments" note in the event page purchase panel (Event /
   EventPhone mockups). Server component: the offer is read server-side from
   GET /api/events/:id/installments, which answers { offered:false } when the
   zp_installments flag is off for the organizer, and 404s on an API that predates
   it — both render nothing. */

import { dayLabel, moneyLabel } from '../lib/installments';

const API_URL = process.env.API_URL || 'http://localhost:4101';

export type EventInstallmentOffer = { count: number; perPayment: number; currency: string; finalDue: string };

export async function fetchInstallmentOffer(eventId: string): Promise<EventInstallmentOffer | null> {
  try {
    const r = await fetch(`${API_URL}/api/events/${encodeURIComponent(eventId)}/installments`, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || d.offered !== true || !Number.isInteger(d.count) || typeof d.perPayment !== 'number') return null;
    return { count: d.count, perPayment: d.perPayment, currency: d.currency || 'TZS', finalDue: String(d.finalDue || '') };
  } catch {
    return null;
  }
}

export function InstallmentOfferNote({ offer }: { offer: EventInstallmentOffer | null }) {
  if (!offer) return null;
  const last = offer.finalDue ? dayLabel(offer.finalDue).split(' ').slice(1).join(' ') : '';
  return (
    <div className="zp-inst-note">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <span className="zp-inst-note-h">Pay in installments</span>
      <span className="zp-inst-note-p">Pay a deposit today, the rest before the event. Your pass arrives when it&apos;s paid in full.</span>
      <span className="zp-inst-note-m">
        {offer.count} × {moneyLabel(offer.perPayment, offer.currency)}
        {last ? ` · LAST PAYMENT ${last}` : ''}
      </span>
    </div>
  );
}

const STYLE = `
.zp-inst-note{background:var(--zp-color-bone,#F7F5EE);color:var(--zp-color-board-black,#111111);border:1px solid var(--zp-color-line-light,#D9D6CC);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;text-align:left}
.zp-inst-note-h{font-weight:700;font-size:16px}
.zp-inst-note-p{font-size:14px;color:var(--zp-color-ink-600,#3A3A3A)}
.zp-inst-note-m{font-family:var(--zp-font-family-mono);font-size:14px;margin-top:4px}
`;
