'use client';

/* PR-MT4 — the organizer dashboard HOME, rebuilt as idiomatic React.
   Replaces the wrap-and-run demo (fake sales sim + `toast('Demo…')`) with real,
   org-scoped data from the `/api/org/*` surface (proxied same-origin — see
   next.config rewrites). Three fetches drive the page:
     GET /api/org/me      -> org identity header + impersonation + KYC status
     GET /api/org/summary -> KPI cards + per-drop performance
     GET /api/org/events  -> MY DROPS list with NEW / EDIT / DELETE actions
   Each fetch owns real loading / empty / error states. The look is ported from
   the demo's control-room palette (paper/card, IBM Plex Mono labels) — only the
   data is now real. NEW/EDIT route to the drop editor (MT6); DELETE calls the
   API with a confirm and refetches, surfacing 409 (has_paid_orders) and 403
   (kyc_required) as clear messages. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ── Contract types (from mt-dashboard-plan.md "API contract"; local until backend lands) ──

type Impersonating = boolean | { name?: string; handle?: string } | null;

type OrgMe = {
  actingHandle: string;
  name: string;
  role: string;
  impersonating?: Impersonating;
  kycStatus?: string;
};

type SummaryEvent = {
  id: string;
  name: string;
  status?: string;
  sold: number;
  capacity: number;
  revenue: number;
  currency: string;
};

type OrgSummary = {
  totals: { revenue: number; sold: number; orders: number; currency: string };
  events: SummaryEvent[];
};

type OrgEventTier = {
  tierId?: string;
  name: string;
  unitPrice: number;
  capacity: number;
  sold: number;
  available: number;
  currency: string;
};

type OrgEvent = {
  id: string;
  name: string;
  category?: string;
  city?: string;
  venue?: string;
  dateLabel?: string;
  time?: string;
  priceFrom?: number;
  seated?: boolean;
  status?: string;
  sellable?: boolean;
  tiers?: OrgEventTier[];
};

// ── async-state helper: every fetch section tracks loading / error / data ──
type Async<T> = { loading: boolean; error: string | null; data: T | null };
const idle = <T,>(): Async<T> => ({ loading: true, error: null, data: null });

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      if (d && d.error) detail = String(d.error);
    } catch {
      /* non-JSON body — keep the status */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

const fmt = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('en-US');
const money = (n: number, cur: string) => `${fmt(n)} ${cur || ''}`.trim();
const pct = (num: number, den: number) => (den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0);

const STATUS_LABEL: Record<string, string> = {
  published: 'ON SALE',
  draft: 'DRAFT',
  archived: 'ARCHIVED',
};

function statusClass(status?: string): string {
  if (status === 'published') return 'tag live';
  if (status === 'archived') return 'tag arch';
  return 'tag draft';
}

export default function DashboardClient() {
  const [me, setMe] = useState<Async<OrgMe>>(idle);
  const [summary, setSummary] = useState<Async<OrgSummary>>(idle);
  const [events, setEvents] = useState<Async<OrgEvent[]>>(idle);

  // per-row delete state + a page-level action message (delete outcomes).
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadMe = useCallback(async () => {
    setMe((s) => ({ ...s, loading: true, error: null }));
    try {
      setMe({ loading: false, error: null, data: await fetchJson<OrgMe>('/api/org/me') });
    } catch (e) {
      setMe({ loading: false, error: (e as Error).message, data: null });
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      setSummary({ loading: false, error: null, data: await fetchJson<OrgSummary>('/api/org/summary') });
    } catch (e) {
      setSummary({ loading: false, error: (e as Error).message, data: null });
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEvents((s) => ({ ...s, loading: true, error: null }));
    try {
      setEvents({ loading: false, error: null, data: await fetchJson<OrgEvent[]>('/api/org/events') });
    } catch (e) {
      setEvents({ loading: false, error: (e as Error).message, data: null });
    }
  }, []);

  useEffect(() => {
    loadMe();
    loadSummary();
    loadEvents();
  }, [loadMe, loadSummary, loadEvents]);

  const onDelete = useCallback(
    async (ev: OrgEvent) => {
      if (deleting) return;
      const confirmed = window.confirm(
        `Delete "${ev.name}"? It will be archived and removed from your public storefront. This cannot be undone from here.`,
      );
      if (!confirmed) return;
      setDeleting(ev.id);
      setActionMsg(null);
      try {
        const res = await fetch(`/api/org/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' });
        if (res.status === 409) {
          setActionMsg({
            kind: 'err',
            text: `"${ev.name}" has paid orders, so it can't be deleted — archive it or contact support to reconcile.`,
          });
          return;
        }
        if (res.status === 403) {
          setActionMsg({
            kind: 'err',
            text: 'Identity verification (KYC) is required before you can delete a drop. Verify to continue.',
          });
          return;
        }
        if (res.status === 404) {
          setActionMsg({ kind: 'err', text: `"${ev.name}" no longer exists — the list has been refreshed.` });
          await Promise.all([loadEvents(), loadSummary()]);
          return;
        }
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const d = await res.json();
            if (d && d.error) detail = String(d.error);
          } catch {
            /* keep status */
          }
          throw new Error(detail);
        }
        setActionMsg({ kind: 'ok', text: `"${ev.name}" was deleted.` });
        await Promise.all([loadEvents(), loadSummary()]);
      } catch (e) {
        setActionMsg({ kind: 'err', text: `Couldn't delete "${ev.name}" — ${(e as Error).message}. Please try again.` });
      } finally {
        setDeleting(null);
      }
    },
    [deleting, loadEvents, loadSummary],
  );

  // ── derived identity + gates ──
  const orgName = me.data?.name || (me.loading ? '' : 'Your organization');
  const kycApproved = me.data?.kycStatus === 'approved';
  const impersonating = me.data?.impersonating;
  const impName =
    impersonating && typeof impersonating === 'object' ? impersonating.name || me.data?.name : me.data?.name;
  const impHandle =
    impersonating && typeof impersonating === 'object' ? impersonating.handle : me.data?.actingHandle;

  async function exitImpersonation() {
    try {
      await fetch('/api/impersonate/exit', { method: 'POST' });
    } catch {
      /* best-effort */
    }
    window.location.href = '/admin';
  }

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />

      {/* Admin "act on behalf" bar — mirrors the demo's exit-impersonation affordance. */}
      {impersonating ? (
        <div className="imp-bar">
          <span>
            ADMIN MODE — acting on behalf of <b>{impName}</b>
            {impHandle ? ` (${impHandle}.zora.com)` : ''}. Every action is logged.
          </span>
          <button onClick={exitImpersonation}>EXIT ADMIN MODE</button>
        </div>
      ) : null}

      <div className="zora-dash">
        <div className="shell">
          <aside className="rail">
            <p className="brand">
              z<span className="o">o</span>ra dashboard<small>THE ORGANIZER SIDE</small>
            </p>
            {me.data && !kycApproved ? (
              <span className="verif-pill">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                VERIFICATION PENDING
              </span>
            ) : null}
            <Link className="nav-item on" href="/dashboard">
              <span className="dot" />
              Home
            </Link>
            <Link className="nav-item" href="/dashboard/sales">
              <span className="dot" />
              Sales
            </Link>
            <Link className="nav-item" href="/dashboard/events/new" style={{ color: 'var(--blue)', fontWeight: 500 }}>
              <span className="dot" />+ New drop
            </Link>
            <p className="foot">
              <a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a>
              <br />
              <br />
              {orgName ? orgName.toUpperCase() : 'ORGANIZER DASHBOARD'}
            </p>
          </aside>

          <main>
            <p className="crumb">DASHBOARD / HOME</p>

            {/* ── org identity header ── */}
            {me.loading ? (
              <>
                <h1 className="skel-h1" aria-busy="true" />
                <p className="sub">Loading your organization…</p>
              </>
            ) : me.error ? (
              <div className="state err">
                Couldn&apos;t load your organization — {me.error}.
                <button className="btn ghost sm" onClick={loadMe}>
                  RETRY
                </button>
              </div>
            ) : (
              <>
                <h1>{orgName}</h1>
                <p className="sub">
                  Your control room. Real numbers, your drops, your money — from your side of the counter.
                </p>
              </>
            )}

            {/* ── KYC-locked notice (preserved from the demo's page.tsx:164 affordance) ── */}
            {me.data && !kycApproved ? (
              <div className="verif-banner">
                <div className="vb-ic">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </div>
                <div className="vb-body">
                  <p className="vb-t">
                    Verification {me.data.kycStatus === 'rejected' ? 'needs attention' : 'in progress'}
                    <span className="vb-badge">
                      {me.data.kycStatus === 'rejected' ? 'ACTION NEEDED' : 'PENDING'}
                    </span>
                  </p>
                  <p className="vb-d">
                    You can <b>draft drops and explore everything</b> right now. Your <b>public listing</b> and{' '}
                    <b>ticket payouts</b> stay locked until your identity is approved — this keeps scammers off the
                    marketplace and protects your buyers.
                  </p>
                  <div className="vb-actions">
                    <a className="vb-btn" href="/dashboard/onboarding">
                      {me.data.kycStatus === 'rejected' ? 'RESUBMIT ID' : 'VERIFY NOW'}
                    </a>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── KPI cards (revenue / tickets sold / orders) ── */}
            <section className="block">
              <p className="bh">OVERVIEW</p>
              {summary.loading ? (
                <div className="cards">
                  {[0, 1, 2].map((i) => (
                    <div className="card skel" key={i} aria-busy="true" />
                  ))}
                </div>
              ) : summary.error ? (
                <div className="state err">
                  Couldn&apos;t load your numbers — {summary.error}.
                  <button className="btn ghost sm" onClick={loadSummary}>
                    RETRY
                  </button>
                </div>
              ) : summary.data ? (
                <div className="cards">
                  <div className="card">
                    <p className="k">NET REVENUE</p>
                    <p className="v">
                      {fmt(summary.data.totals.revenue)}{' '}
                      <small>{summary.data.totals.currency}</small>
                    </p>
                    <p className="d">Paid orders only — what&apos;s yours</p>
                  </div>
                  <div className="card">
                    <p className="k">TICKETS SOLD</p>
                    <p className="v">{fmt(summary.data.totals.sold)}</p>
                    <p className="d">Across all your drops</p>
                  </div>
                  <div className="card">
                    <p className="k">ORDERS</p>
                    <p className="v blue">{fmt(summary.data.totals.orders)}</p>
                    <p className="d">Completed checkouts</p>
                  </div>
                </div>
              ) : null}
            </section>

            {/* ── per-drop performance (from /summary.events) ── */}
            {summary.data && !summary.error ? (
              <section className="block">
                <div className="box">
                  <p className="bh">DROP PERFORMANCE</p>
                  {summary.data.events.length === 0 ? (
                    <p className="muted">No sales yet — your drops will show sell-through here once they go live.</p>
                  ) : (
                    summary.data.events.map((ev) => (
                      <div className="wave" key={ev.id}>
                        <div className="wr">
                          <span>
                            {ev.name}
                            {ev.status && ev.status !== 'published' ? (
                              <span className="inline-tag">{STATUS_LABEL[ev.status] || ev.status.toUpperCase()}</span>
                            ) : null}
                          </span>
                          <span className="mono">
                            {fmt(ev.sold)} / {fmt(ev.capacity)} · {money(ev.revenue, ev.currency)}
                          </span>
                        </div>
                        <div className="bar">
                          <i
                            className={ev.capacity > 0 && ev.sold >= ev.capacity ? 'done' : ''}
                            style={{ width: `${pct(ev.sold, ev.capacity)}%` }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ) : null}

            {/* ── MY DROPS (from /api/org/events) with NEW / EDIT / DELETE ── */}
            <section className="block">
              <div className="drops-head">
                <p className="bh" style={{ marginBottom: 0 }}>
                  MY DROPS
                </p>
                <Link className="btn blue" href="/dashboard/events/new">
                  NEW DROP
                </Link>
              </div>

              {actionMsg ? (
                <div className={`state ${actionMsg.kind === 'ok' ? 'ok' : 'err'}`} role="status">
                  {actionMsg.text}
                  {actionMsg.kind === 'err' && !kycApproved ? (
                    <a className="btn ghost sm" href="/dashboard/onboarding">
                      VERIFY
                    </a>
                  ) : null}
                </div>
              ) : null}

              {events.loading ? (
                <>
                  <div className="drop-row skel-row" aria-busy="true" />
                  <div className="drop-row skel-row" aria-busy="true" />
                </>
              ) : events.error ? (
                <div className="state err">
                  Couldn&apos;t load your drops — {events.error}.
                  <button className="btn ghost sm" onClick={loadEvents}>
                    RETRY
                  </button>
                </div>
              ) : events.data && events.data.length === 0 ? (
                <div className="empty-drops">
                  <p className="ed-t">No drops yet.</p>
                  <p className="ed-d">
                    Create your first drop — name it, set your tiers, and it gets its own countdown page on your
                    storefront automatically.
                  </p>
                  <Link className="btn blue" href="/dashboard/events/new">
                    CREATE YOUR FIRST DROP
                  </Link>
                </div>
              ) : events.data ? (
                events.data.map((ev) => {
                  const totalCap = ev.tiers?.reduce((a, t) => a + (t.capacity || 0), 0) ?? 0;
                  const totalSold = ev.tiers?.reduce((a, t) => a + (t.sold || 0), 0) ?? 0;
                  const meta = [
                    ev.dateLabel,
                    ev.city,
                    ev.venue,
                    ev.tiers && ev.tiers.length ? `${ev.tiers.length} TIER${ev.tiers.length === 1 ? '' : 'S'}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                    .toUpperCase();
                  return (
                    <div className="drop-row" key={ev.id}>
                      <div className="dr-main">
                        <p className={`dn${ev.status === 'archived' ? ' dim' : ''}`}>{ev.name}</p>
                        <p className="dm">
                          {meta || 'DRAFT'}
                          {totalCap > 0 ? ` · ${fmt(totalSold)}/${fmt(totalCap)} SOLD` : ''}
                        </p>
                      </div>
                      <div className="dr-actions">
                        <span className={statusClass(ev.status)}>
                          {STATUS_LABEL[ev.status || 'draft'] || (ev.status || 'DRAFT').toUpperCase()}
                        </span>
                        <Link className="btn ghost" href={`/dashboard/events/${encodeURIComponent(ev.id)}/edit`}>
                          EDIT
                        </Link>
                        <button
                          className="btn ghost danger"
                          onClick={() => onDelete(ev)}
                          disabled={deleting === ev.id}
                        >
                          {deleting === ev.id ? 'DELETING…' : 'DELETE'}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : null}
            </section>
          </main>
        </div>
      </div>
    </>
  );
}

const STYLE = `
.zora-dash{--paper:#F4F1EA;--card:#FBF9F4;--ink:#0A0A0B;--hair:#DDD8CB;--mut:#8A877E;--blue:#3D5AFE;--bluewash:#E8EBFE;--sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;min-height:100vh}
.zora-dash *{margin:0;padding:0;box-sizing:border-box}
.zora-dash a{color:inherit;text-decoration:none}
.zora-dash .mono{font-family:var(--mono)}
.zora-dash ::selection{background:var(--blue);color:#fff}
.zora-dash .shell{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
@media(max-width:820px){.zora-dash .shell{grid-template-columns:1fr}}
.zora-dash .rail{border-right:1px solid var(--hair);padding:26px 0;position:sticky;top:0;height:100vh;display:flex;flex-direction:column}
@media(max-width:820px){.zora-dash .rail{position:static;height:auto;flex-direction:row;align-items:center;overflow-x:auto;border-right:none;border-bottom:1px solid var(--hair);padding:14px 16px;gap:6px}}
.zora-dash .rail .brand{padding:0 24px 26px;font-weight:600;font-size:19px;letter-spacing:-.02em;white-space:nowrap}
@media(max-width:820px){.zora-dash .rail .brand{padding:0 12px 0 0}}
.zora-dash .rail .brand .o{color:var(--blue)}
.zora-dash .rail .brand small{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.35em;color:var(--mut);font-weight:400;margin-top:2px}
.zora-dash .nav-item{display:flex;align-items:center;gap:12px;padding:11px 24px;font-size:13.5px;color:var(--mut);cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:var(--sans);letter-spacing:.02em}
@media(max-width:820px){.zora-dash .nav-item{width:auto;padding:8px 12px;white-space:nowrap}}
.zora-dash .nav-item:hover{color:var(--ink)}
.zora-dash .nav-item.on{color:var(--blue);background:var(--bluewash);font-weight:500}
.zora-dash .nav-item .dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
.zora-dash .rail .foot{margin-top:auto;padding:20px 24px 0;font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;color:var(--mut)}
@media(max-width:820px){.zora-dash .rail .foot{display:none}}
.zora-dash .rail .foot a:hover{color:var(--ink)}
.zora-dash main{padding:34px 40px 80px;max-width:1060px}
@media(max-width:820px){.zora-dash main{padding:24px 18px 60px}}
.zora-dash .crumb{font-family:var(--mono);font-size:10.5px;letter-spacing:.3em;color:var(--mut);margin-bottom:8px}
.zora-dash h1{font-size:26px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px}
.zora-dash .skel-h1{height:32px;width:280px;max-width:70%;background:linear-gradient(90deg,var(--hair),var(--card),var(--hair));background-size:200% 100%;animation:shimmer 1.3s infinite;border-radius:6px;margin-bottom:8px}
.zora-dash .sub{color:var(--mut);font-size:13.5px;margin-bottom:30px}
.zora-dash .block{margin-bottom:28px}
.zora-dash .bh{font-family:var(--mono);font-size:10px;letter-spacing:.25em;color:var(--mut);margin-bottom:16px}
.zora-dash .muted{color:var(--mut);font-size:13px}
.zora-dash .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}
.zora-dash .card{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:18px 20px;min-height:104px}
.zora-dash .card.skel{animation:shimmer 1.3s infinite;background:linear-gradient(90deg,var(--card),var(--paper),var(--card));background-size:200% 100%}
.zora-dash .card .k{font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--mut)}
.zora-dash .card .v{font-family:var(--mono);font-size:26px;font-weight:500;margin-top:8px;letter-spacing:-.01em}
.zora-dash .card .v small{font-size:13px;color:var(--mut)}
.zora-dash .card .v.blue{color:var(--blue)}
.zora-dash .card .d{font-size:12px;color:var(--mut);margin-top:6px}
.zora-dash .box{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:22px 24px}
.zora-dash .wave{margin-bottom:16px}
.zora-dash .wave:last-child{margin-bottom:0}
.zora-dash .wave .wr{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;margin-bottom:6px}
.zora-dash .wave .wr .mono{color:var(--mut);font-size:12px;white-space:nowrap}
.zora-dash .inline-tag{font-family:var(--mono);font-size:9px;letter-spacing:.14em;color:var(--mut);border:1px solid var(--hair);border-radius:99px;padding:2px 7px;margin-left:8px}
.zora-dash .bar{height:7px;background:var(--paper);border:1px solid var(--hair);border-radius:4px;overflow:hidden}
.zora-dash .bar i{display:block;height:100%;background:var(--blue);transition:width .6s}
.zora-dash .bar i.done{background:var(--ink)}
.zora-dash .drops-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap}
.zora-dash .drop-row{display:flex;justify-content:space-between;align-items:center;gap:18px;background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:22px 24px;margin-bottom:14px;flex-wrap:wrap}
.zora-dash .drop-row.skel-row{min-height:82px;animation:shimmer 1.3s infinite;background:linear-gradient(90deg,var(--card),var(--paper),var(--card));background-size:200% 100%}
.zora-dash .drop-row .dr-main{min-width:0}
.zora-dash .drop-row .dn{font-weight:600;font-size:17px}
.zora-dash .drop-row .dn.dim{color:var(--mut)}
.zora-dash .drop-row .dm{font-family:var(--mono);font-size:11.5px;color:var(--mut);letter-spacing:.06em;margin-top:4px}
.zora-dash .dr-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.zora-dash .tag{font-family:var(--mono);font-size:10px;letter-spacing:.2em;padding:5px 12px;border-radius:99px;border:1px solid;white-space:nowrap}
.zora-dash .tag.live{color:var(--blue);border-color:var(--blue)}
.zora-dash .tag.draft{color:var(--mut);border-color:var(--hair)}
.zora-dash .tag.arch{color:#9a5b1e;border-color:#e2b483}
.zora-dash .btn{background:var(--ink);color:var(--paper);border:none;font-family:var(--mono);font-size:11.5px;font-weight:500;letter-spacing:.16em;padding:12px 24px;border-radius:8px;cursor:pointer;transition:background .2s;display:inline-flex;align-items:center;justify-content:center}
.zora-dash .btn:hover{background:var(--blue)}
.zora-dash .btn:disabled{opacity:.5;cursor:progress}
.zora-dash .btn.ghost{background:none;border:1px solid var(--hair);color:var(--ink)}
.zora-dash .btn.ghost:hover{border-color:var(--blue);color:var(--blue);background:none}
.zora-dash .btn.ghost.danger:hover{border-color:#D9503B;color:#D9503B}
.zora-dash .btn.blue{background:var(--blue)}
.zora-dash .btn.blue:hover{background:var(--ink)}
.zora-dash .btn.sm{padding:8px 16px;font-size:10.5px;margin-left:12px}
.zora-dash .state{font-family:var(--mono);font-size:12px;letter-spacing:.04em;padding:14px 16px;border-radius:9px;line-height:1.6;display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.zora-dash .state.err{color:#7a2317;background:#FBEAE7;border:1px solid #D9503B}
.zora-dash .state.ok{color:#0f5230;background:#E7F4EC;border:1px solid #39A06B}
.zora-dash .empty-drops{background:var(--card);border:1px dashed var(--hair);border-radius:10px;padding:34px 26px;text-align:center}
.zora-dash .empty-drops .ed-t{font-weight:600;font-size:18px}
.zora-dash .empty-drops .ed-d{color:var(--mut);font-size:13px;margin:8px auto 20px;max-width:44ch}
.zora-dash .imp-bar{position:sticky;top:0;z-index:200;display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:#241a05;border-bottom:1px solid #BA7517;color:#F0C674;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.04em;padding:12px 20px}
.zora-dash .imp-bar b{color:#FFD98A}
.zora-dash .imp-bar button{margin-left:auto;background:#F0C674;color:#241a05;border:none;border-radius:8px;font-family:inherit;font-size:11px;font-weight:600;letter-spacing:.1em;padding:9px 18px;cursor:pointer}
.zora-dash .verif-pill{display:inline-flex;align-items:center;gap:6px;margin:0 24px 16px;background:#FAEEDA;border:1px solid #EF9F27;color:#854F0B;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;padding:6px 11px;border-radius:99px;align-self:flex-start}
.zora-dash .verif-pill svg{width:11px;height:11px;stroke:#854F0B;fill:none;stroke-width:2}
@media(max-width:820px){.zora-dash .verif-pill{margin:0 0 0 4px;flex-shrink:0}}
.zora-dash .verif-banner{display:flex;align-items:flex-start;gap:14px;background:#FAEEDA;border:1px solid #EF9F27;border-radius:12px;padding:16px 18px;margin-bottom:26px}
.zora-dash .verif-banner .vb-ic{width:38px;height:38px;border-radius:10px;background:#fff;border:1px solid #EF9F27;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.zora-dash .verif-banner .vb-ic svg{width:18px;height:18px;stroke:#854F0B;fill:none;stroke-width:2}
.zora-dash .verif-banner .vb-body{flex:1;min-width:0}
.zora-dash .verif-banner .vb-t{font-weight:500;font-size:14.5px;color:#5A340A;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.zora-dash .verif-banner .vb-badge{font-family:var(--mono);font-size:9px;letter-spacing:.12em;background:#EF9F27;color:#3a2405;padding:3px 9px;border-radius:99px}
.zora-dash .verif-banner .vb-d{font-size:13px;color:#7a5212;margin-top:5px;line-height:1.55}
.zora-dash .verif-banner .vb-d b{color:#5A340A;font-weight:500}
.zora-dash .verif-banner .vb-actions{display:flex;gap:10px;margin-top:13px;flex-wrap:wrap}
.zora-dash .verif-banner .vb-btn{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;padding:9px 16px;border-radius:8px;cursor:pointer;border:1px solid #EF9F27;background:#fff;color:#854F0B}
.zora-dash .verif-banner .vb-btn:hover{background:#854F0B;color:#fff;border-color:#854F0B}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
`;
