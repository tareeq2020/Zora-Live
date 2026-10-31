'use client';

/* BS136 (F7, owner decision 3) — super-admin INSTALLMENT REFUNDS.

   A missed plan is released and the buyer is owed what they paid, minus the
   service fee. x-bridge has no reversal Zora can call, so ops pays the buyer by
   hand, then records it here with the payment reference:

   GET  /api/admin/installments/refunds
   POST /api/admin/installments/:orderId/refund-recorded { reference }

   Recording books the debit on the order (refunded_amount) and is audited. An
   API without these endpoints shows the error state (redeploy pending). */

import { useCallback, useState } from 'react';
import { adminApi, errText, useAdminResource, AdminSkeleton, AdminError, AdminEmpty } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { crPrimaryBtn } from '../console-kit';

type Refund = {
  orderId: string; ref: string; eventId: string; eventName: string; orgHandle: string | null;
  buyerPhone: string | null; buyerName: string | null; paid: number; serviceFee: number; refundDue: number;
  currency: string; closedAt: string | null;
};
type Payload = { refunds: Refund[] };

const money = (n: number, c: string) => `${c === 'TZS' ? 'TSh' : c} ${Number(n).toLocaleString('en-US')}`;

export default function AdminInstallmentsClient() {
  const load = useCallback(() => adminApi<Payload>('/api/admin/installments/refunds'), []);
  const res = useAdminResource<Payload>(load);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function record(r: Refund) {
    const reference = (refs[r.orderId] || '').trim();
    if (!reference) { setNote({ ok: false, text: `Add the payment reference for ${r.ref} first.` }); return; }
    setBusy(r.orderId);
    setNote(null);
    try {
      await adminApi(`/api/admin/installments/${encodeURIComponent(r.orderId)}/refund-recorded`, {
        method: 'POST', body: JSON.stringify({ reference }),
      });
      setNote({ ok: true, text: `${r.ref}: ${money(r.refundDue, r.currency)} recorded as refunded.` });
      if (res.data) res.set({ refunds: res.data.refunds.filter((x) => x.orderId !== r.orderId) });
    } catch (e) {
      setNote({ ok: false, text: `${r.ref}: ${errText(e) === 'no_refund_pending' ? 'already recorded.' : errText(e)}` });
    } finally {
      setBusy(null);
    }
  }

  const rows = res.data?.refunds ?? [];
  return (
    <AdminConsoleShell title="Installment refunds">
      <section className="cr-panel">
        <div className="cr-panel-head"><h2 className="cr-section-h">Refunds to pay back</h2></div>
        <p style={{ fontSize: 14, color: 'var(--cr-ink2)', margin: '0 0 12px' }}>
          Plans released after a missed payment. Pay the buyer what they paid minus the service fee, then record the reference.
        </p>
        {note ? <p role={note.ok ? 'status' : 'alert'} style={{ fontSize: 14, color: note.ok ? 'var(--cr-ink)' : 'var(--cr-red)' }}>{note.text}</p> : null}
        {res.status === 'loading' && !res.loaded ? <AdminSkeleton rows={3} /> : null}
        {res.status === 'error' ? <AdminError message={`Couldn't load refunds (${res.error}). The API may need a redeploy.`} onRetry={res.reload} /> : null}
        {res.loaded && !rows.length ? <AdminEmpty line="No refunds waiting." sub="Released plans show up here until their refund is recorded." /> : null}
        {rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', fontFamily: 'var(--cr-mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--cr-mut)' }}>
                  <th style={{ padding: '10px 8px 10px 0' }}>ORDER</th><th>EVENT</th><th>BUYER</th><th>PAID</th><th>FEE KEPT</th><th>REFUND DUE</th><th>REFERENCE</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.orderId} style={{ borderTop: '1px solid var(--cr-hair)' }}>
                    <td style={{ padding: '12px 8px 12px 0', fontFamily: 'var(--cr-mono)', fontSize: 12 }} title={r.orderId}>{r.ref}</td>
                    <td style={{ paddingRight: 8 }}>{r.eventName}{r.orgHandle ? <><br /><span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>{r.orgHandle}</span></> : null}</td>
                    <td style={{ paddingRight: 8 }}>{r.buyerName || '—'}<br /><span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12 }}>{r.buyerPhone ? `+${r.buyerPhone.replace(/^\+/, '')}` : 'no phone'}</span></td>
                    <td style={{ fontFamily: 'var(--cr-mono)', paddingRight: 8 }}>{money(r.paid, r.currency)}</td>
                    <td style={{ fontFamily: 'var(--cr-mono)', paddingRight: 8 }}>{money(r.serviceFee, r.currency)}</td>
                    <td style={{ fontFamily: 'var(--cr-mono)', fontWeight: 600, paddingRight: 8 }}>{money(r.refundDue, r.currency)}</td>
                    <td style={{ paddingRight: 8 }}>
                      <input
                        className="cr-input"
                        aria-label={`Payment reference for ${r.ref}`}
                        placeholder="M-Pesa / bank ref"
                        maxLength={120}
                        value={refs[r.orderId] || ''}
                        onChange={(e) => setRefs((m) => ({ ...m, [r.orderId]: e.target.value }))}
                        style={{ minWidth: 160 }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="cr-btn" style={crPrimaryBtn} disabled={busy === r.orderId} onClick={() => record(r)}>
                        {busy === r.orderId ? 'Saving…' : 'Mark refunded'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </AdminConsoleShell>
  );
}
