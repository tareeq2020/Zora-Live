'use client';

/* PR-MT6 — the REAL create / edit / delete drop editor.

   Replaces the old wrap-and-run demo (dangerouslySetInnerHTML + new Function)
   with idiomatic React: controlled inputs, useState/useEffect, a live preview
   driven by state, and same-origin /api/org/* calls. One component serves both
   the create route (/dashboard/events/new) and the edit route
   (/dashboard/events/[id]/edit) via `mode`.

   Behavior wired to the contract (mt-dashboard-plan.md "## API contract"):
   - POST /api/org/events with a STABLE idempotencyKey per form instance +
     disable-on-submit → no double-create.
   - PUT /api/org/events/:id on edit; 404 handled as "not yours".
   - DELETE /api/org/events/:id behind a confirm dialog; 409 has_paid_orders and
     403 kyc_required surfaced with human copy.
   - KYC gate: `sellable` (publish a paid, public drop) is locked until
     kycStatus==='approved'. Saving a draft is always allowed.
   - Client validation mirrors the backend; server error messages win. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type ApiError,
  type DropForm,
  type FieldErrors,
  type OrgEvent,
  buildBody,
  archiveDrop,
  createDrop,
  deleteDrop,
  deleteTier,
  emptyForm,
  unarchiveDrop,
  emptyTier,
  fetchEvents,
  fetchMe,
  formFromEvent,
  hasErrors,
  messageForError,
  newIdempotencyKey,
  priceFromOf,
  updateDrop,
  usableTiers,
  validate,
} from '../lib/drops';

const STYLE = `
.zora-dropedit{--paper:#F4F1EA;--card:#FBF9F4;--ink:#0A0A0B;--hair:#DDD8CB;--mut:#8A877E;--blue:#3D5AFE;--bluewash:#E8EBFE;--green:#1D9E75;--red:#D85A30;--amber:#EF9F27;--sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;min-height:100vh}
.zora-dropedit *{margin:0;padding:0;box-sizing:border-box}
.zora-dropedit a{color:inherit;text-decoration:none}
.zora-dropedit .mono{font-family:var(--mono)}
.zora-dropedit ::selection{background:var(--blue);color:#fff}
.zora-dropedit .top{position:sticky;top:0;z-index:30;background:rgba(244,241,234,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--hair)}
.zora-dropedit .top-in{max-width:1080px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.zora-dropedit .back{font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;color:var(--mut)}
.zora-dropedit .back:hover{color:var(--ink)}
.zora-dropedit .top .brand{font-weight:600;font-size:17px;letter-spacing:-.02em}
.zora-dropedit .top .brand .o{color:var(--blue)}
.zora-dropedit .top-actions{display:flex;gap:10px;align-items:center}
.zora-dropedit .ghost{background:none;border:1px solid var(--hair);border-radius:9px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--mut);padding:11px 18px;cursor:pointer;transition:border-color .2s,color .2s}
.zora-dropedit .ghost:hover:not(:disabled){border-color:var(--mut);color:var(--ink)}
.zora-dropedit .publish{background:var(--ink);color:var(--paper);border:none;border-radius:9px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.14em;padding:11px 24px;cursor:pointer;transition:background .2s}
.zora-dropedit .publish:hover:not(:disabled){background:var(--blue)}
.zora-dropedit button:disabled{opacity:.45;cursor:not-allowed}
.zora-dropedit .grid{max-width:1080px;margin:0 auto;padding:34px 28px 90px;display:grid;grid-template-columns:1fr 380px;gap:40px;align-items:start}
@media(max-width:900px){.zora-dropedit .grid{grid-template-columns:1fr;gap:26px}}
.zora-dropedit h1{font-size:27px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px}
.zora-dropedit .sub{color:var(--mut);font-size:14px;margin-bottom:26px}
.zora-dropedit .block{margin-bottom:34px}
.zora-dropedit .block-h{font-family:var(--mono);font-size:10.5px;letter-spacing:.24em;color:var(--mut);margin-bottom:16px;display:flex;align-items:center;gap:10px}
.zora-dropedit .block-h .n{width:20px;height:20px;border-radius:50%;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;font-size:10px}
.zora-dropedit label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--mut);margin-bottom:8px}
.zora-dropedit .in{width:100%;background:#fff;border:1px solid var(--hair);border-radius:10px;font-family:var(--sans);font-size:15px;padding:13px 15px;outline:none;transition:border-color .2s;color:var(--ink)}
.zora-dropedit .coverdz{position:relative;width:100%;height:150px;border:1px dashed var(--hair);border-radius:12px;background:#fff center/cover no-repeat;display:flex;align-items:center;justify-content:center;text-align:center;cursor:pointer;transition:border-color .2s;overflow:hidden}
.zora-dropedit .coverdz:hover{border-color:var(--blue)}
.zora-dropedit .coverdz.filled{border-style:solid}
.zora-dropedit .coverdz-txt{font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--mut);padding:0 24px;line-height:1.7}
.zora-dropedit .coverdz-rm{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:8px;border:none;background:rgba(10,10,11,.7);color:#fff;font-size:18px;line-height:1;cursor:pointer}
.zora-dropedit .hint{font-family:var(--mono);font-size:10px;letter-spacing:.03em;color:var(--mut);margin-top:8px;line-height:1.6}
.zora-dropedit .in:focus{border-color:var(--blue)}
.zora-dropedit .in.err{border-color:var(--red)}
.zora-dropedit .in.big{font-size:19px;font-weight:500;padding:15px}
.zora-dropedit .field{margin-bottom:18px}
.zora-dropedit .row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:520px){.zora-dropedit .row2{grid-template-columns:1fr}}
.zora-dropedit .field-err{font-family:var(--mono);font-size:10.5px;letter-spacing:.03em;color:var(--red);margin-top:7px}
.zora-dropedit .tier{background:#fff;border:1px solid var(--hair);border-radius:12px;padding:14px;margin-bottom:12px}
.zora-dropedit .tier.err{border-color:var(--red)}
.zora-dropedit .tier.off{background:var(--card);border-style:dashed}
.zora-dropedit .tier-badge{display:inline-block;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--mut);border:1px solid var(--hair);border-radius:99px;padding:3px 10px;margin-bottom:10px}
.zora-dropedit .tier-note{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.02em;margin-top:8px;line-height:1.5}
.zora-dropedit .tiers-hidden-note{font-family:var(--mono);font-size:11.5px;color:#9a5b1e;background:#fbf1e6;border:1px solid #e2b483;border-radius:9px;padding:11px 14px;letter-spacing:.02em;line-height:1.5;margin-bottom:14px}
.zora-dropedit .tier-grid{display:grid;grid-template-columns:1.6fr 1fr 1fr auto;gap:10px;align-items:end}
@media(max-width:620px){.zora-dropedit .tier-grid{grid-template-columns:1fr 1fr;gap:10px}}
.zora-dropedit .tier label{margin-bottom:6px}
.zora-dropedit .tier .in{padding:11px 12px;font-size:14px}
.zora-dropedit .tier .del{width:38px;height:42px;border:1px solid var(--hair);border-radius:9px;background:none;color:var(--mut);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center}
.zora-dropedit .tier .del:hover{border-color:var(--red);color:var(--red)}
@media(max-width:620px){.zora-dropedit .tier .del{width:100%;height:40px}}
.zora-dropedit .add-tier{width:100%;background:none;border:1px dashed var(--hair);border-radius:12px;padding:14px;font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;color:var(--mut);cursor:pointer;transition:border-color .2s,color .2s}
.zora-dropedit .add-tier:hover{border-color:var(--blue);color:var(--blue)}
.zora-dropedit .capbar{display:flex;justify-content:space-between;align-items:center;background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:14px 16px;margin-top:14px;font-family:var(--mono);font-size:12px;letter-spacing:.04em}
.zora-dropedit .capbar b{font-size:15px}
.zora-dropedit .togglebar{border:1px solid var(--hair);border-radius:12px;padding:16px 18px;display:flex;align-items:center;gap:14px;background:#fff}
.zora-dropedit .togglebar.locked{background:var(--card)}
.zora-dropedit .togglebar .tg-body{flex:1;min-width:0}
.zora-dropedit .togglebar .tg-t{font-weight:500;font-size:14.5px}
.zora-dropedit .togglebar .tg-d{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.03em;margin-top:4px;line-height:1.5}
.zora-dropedit .switch{width:44px;height:26px;border-radius:99px;background:var(--hair);position:relative;flex-shrink:0;transition:background .2s;border:none;cursor:pointer;padding:0}
.zora-dropedit .switch.on{background:var(--blue)}
.zora-dropedit .switch:disabled{cursor:not-allowed;opacity:.6}
.zora-dropedit .switch .knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s}
.zora-dropedit .switch.on .knob{transform:translateX(18px)}
.zora-dropedit .notice{display:flex;align-items:flex-start;gap:12px;border-radius:12px;padding:14px 16px;margin-top:14px;font-size:13px;line-height:1.55}
.zora-dropedit .notice.kyc{background:#FAEEDA;border:1px solid var(--amber);color:#7a5212}
.zora-dropedit .notice.kyc b{color:#5A340A;font-weight:500}
.zora-dropedit .notice .ic{width:18px;height:18px;flex-shrink:0;margin-top:1px}
.zora-dropedit .notice.kyc .ic{stroke:#854F0B}
.zora-dropedit .banner{display:flex;align-items:flex-start;gap:12px;border-radius:12px;padding:14px 16px;margin-bottom:24px;font-size:13.5px;line-height:1.55}
.zora-dropedit .banner.error{background:#FBEAE7;border:1px solid var(--red);color:#7a2317}
.zora-dropedit .banner.error b{color:#5a1a10}
.zora-dropedit .side{position:sticky;top:88px}
@media(max-width:900px){.zora-dropedit .side{position:static}}
.zora-dropedit .side-h{font-family:var(--mono);font-size:10px;letter-spacing:.24em;color:var(--mut);margin-bottom:12px}
.zora-dropedit .pv{background:#fff;border:1px solid var(--hair);border-radius:16px;overflow:hidden}
.zora-dropedit .pv .pv-url{font-family:var(--mono);font-size:10.5px;color:var(--mut);padding:9px 14px;border-bottom:1px solid var(--hair);background:var(--card)}
.zora-dropedit .pv .pv-banner{height:120px;background:var(--bluewash);display:flex;align-items:center;justify-content:center}
.zora-dropedit .pv .pv-banner .ph{font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--blue)}
.zora-dropedit .pv .pv-body{padding:18px}
.zora-dropedit .pv .pv-status{display:inline-block;font-family:var(--mono);font-size:9px;letter-spacing:.16em;padding:4px 10px;border-radius:99px;margin-bottom:12px}
.zora-dropedit .pv .pv-status.live{background:var(--bluewash);color:var(--blue)}
.zora-dropedit .pv .pv-status.draft{background:var(--card);color:var(--mut);border:1px solid var(--hair)}
.zora-dropedit .pv .pv-title{font-size:19px;font-weight:600;letter-spacing:-.01em;line-height:1.15}
.zora-dropedit .pv .pv-meta{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.05em;margin-top:8px;line-height:1.8}
.zora-dropedit .pv .pv-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--hair);margin-top:16px;padding-top:14px}
.zora-dropedit .pv .pv-from{font-family:var(--mono);font-size:10px;color:var(--mut);letter-spacing:.1em}
.zora-dropedit .pv .pv-price{font-size:20px;font-weight:600}
.zora-dropedit .pv .pv-cta{background:var(--blue);color:#fff;font-family:var(--mono);font-size:10px;letter-spacing:.12em;padding:9px 16px;border-radius:99px}
.zora-dropedit .side-note{font-family:var(--mono);font-size:10.5px;color:var(--mut);letter-spacing:.04em;line-height:1.7;margin-top:16px;text-align:center}
.zora-dropedit .danger-zone{border:1px solid var(--hair);border-radius:12px;padding:18px 20px;margin-top:20px}
.zora-dropedit .danger-zone .dz-h{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--red);margin-bottom:6px}
.zora-dropedit .danger-zone .dz-d{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.03em;line-height:1.6;margin-bottom:14px}
.zora-dropedit .danger-zone .dz-actions{display:flex;gap:10px;flex-wrap:wrap}
.zora-dropedit .del-btn{background:none;border:1px solid var(--hair);border-radius:9px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--red);padding:11px 18px;cursor:pointer;transition:background .2s,border-color .2s}
.zora-dropedit .del-btn:hover:not(:disabled){background:var(--red);border-color:var(--red);color:#fff}
.zora-dropedit .overlay{position:fixed;inset:0;background:rgba(244,241,234,.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:60;padding:24px}
.zora-dropedit .modal{background:#fff;border:1px solid var(--hair);border-radius:18px;max-width:440px;width:100%;padding:32px;box-shadow:0 24px 60px rgba(0,0,0,.12)}
.zora-dropedit .modal h2{font-size:20px;font-weight:600;letter-spacing:-.01em;margin-bottom:10px}
.zora-dropedit .modal p{font-size:13.5px;color:var(--mut);line-height:1.6;margin-bottom:22px}
.zora-dropedit .modal .modal-actions{display:flex;gap:10px;justify-content:flex-end}
.zora-dropedit .modal .confirm-del{background:var(--red);color:#fff;border:none;border-radius:9px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;padding:11px 20px;cursor:pointer}
.zora-dropedit .modal .confirm-del:hover:not(:disabled){background:#b8481f}
.zora-dropedit .loading,.zora-dropedit .fatal{max-width:1080px;margin:0 auto;padding:80px 28px;font-family:var(--mono);font-size:13px;letter-spacing:.06em;color:var(--mut)}
.zora-dropedit .fatal a{color:var(--blue);text-decoration:underline}
.zora-dropedit .spin{display:inline-block;width:12px;height:12px;border:2px solid var(--hair);border-top-color:var(--blue);border-radius:50%;animation:zde-spin .7s linear infinite;vertical-align:-1px;margin-right:8px}
@keyframes zde-spin{to{transform:rotate(360deg)}}
`;

const fmt = (n: number) => n.toLocaleString('en-US');

const LockIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const AlertIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="#D85A30" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

export type DropEditorProps = { mode: 'create'; eventId?: undefined } | { mode: 'edit'; eventId: string };

type LoadState = 'loading' | 'ready' | 'not_found' | 'load_error';

export default function DropEditor(props: DropEditorProps) {
  const router = useRouter();
  const isEdit = props.mode === 'edit';

  // ── async boot: /api/org/me (+ the event on edit) ──
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadErrMsg, setLoadErrMsg] = useState('');
  const [status, setStatus] = useState<string>(''); // BS24: loaded drop status (drives Archive vs Restore)
  const [kycStatus, setKycStatus] = useState<string>('unverified');
  const [form, setForm] = useState<DropForm>(emptyForm);

  // Stable idempotency key for the lifetime of this form instance (create).
  const idemKeyRef = useRef<string>('');
  if (!idemKeyRef.current) idemKeyRef.current = newIdempotencyKey();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mePromise = fetchMe();
        if (isEdit) {
          const [me, events] = await Promise.all([mePromise, fetchEvents()]);
          if (!alive) return;
          setKycStatus(me.kycStatus);
          const ev: OrgEvent | undefined = events.find((e) => String(e.id) === String((props as { eventId: string }).eventId));
          if (!ev) {
            setLoadState('not_found');
            return;
          }
          setForm(formFromEvent(ev));
          setStatus(ev.status || '');
          setLoadState('ready');
        } else {
          const me = await mePromise;
          if (!alive) return;
          setKycStatus(me.kycStatus);
          setLoadState('ready');
        }
      } catch (e) {
        if (!alive) return;
        const err = e as ApiError;
        setLoadErrMsg(err.status === 401 ? 'You need to sign in as an organizer to manage drops.' : 'Could not load your account. Check your connection and try again.');
        setLoadState('load_error');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kycApproved = kycStatus === 'approved';

  // ── submit / delete UI state ──
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // BS23: which tier row is pending a delete-confirm, and whether that call is in flight.
  const [tierDelIdx, setTierDelIdx] = useState<number | null>(null);
  const [tierDeleting, setTierDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false); // BS24: archive/restore in flight
  const [serverError, setServerError] = useState('');
  const [showValidation, setShowValidation] = useState(false);

  const errors: FieldErrors = useMemo(() => validate(form), [form]);
  const invalid = hasErrors(errors);

  // ── field setters ──
  const set = <K extends keyof DropForm>(key: K, value: DropForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Per-event cover image → base64 → POST /api/upload (same CDN path the studio
  // uses) → store the returned URL on form.cover.
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  async function uploadCover(file: File) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setServerError('Cover must be a PNG, JPEG, or WebP image.'); return; }
    if (file.size > 8 * 1024 * 1024) { setServerError('Cover image must be under 8MB.'); return; }
    setCoverBusy(true); setServerError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file);
      });
      const resp = await fetch('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, dataUrl }),
      });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(d.error || 'Upload failed');
      set('cover', d.url);
    } catch (e: any) { setServerError(String(e?.message || e)); }
    finally { setCoverBusy(false); }
  }

  const setTier = (i: number, key: keyof DropForm['tiers'][number], value: string | boolean) =>
    setForm((f) => ({ ...f, tiers: f.tiers.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)) }));

  const addTier = () => setForm((f) => ({ ...f, tiers: [...f.tiers, emptyTier()] }));
  const removeTier = (i: number) =>
    setForm((f) => ({ ...f, tiers: f.tiers.length > 1 ? f.tiers.filter((_, idx) => idx !== i) : f.tiers }));

  // BS23: a NEW (unsaved) row is dropped locally; an EXISTING tier (has tierId) is
  // deleted server-side behind a confirm, since it may already have sales.
  const requestRemoveTier = (i: number) => {
    setServerError('');
    if (form.tiers[i]?.tierId) setTierDelIdx(i);
    else removeTier(i);
  };
  async function handleDeleteTier() {
    if (tierDeleting || tierDelIdx == null) return;
    const row = form.tiers[tierDelIdx];
    if (!row?.tierId) { removeTier(tierDelIdx); setTierDelIdx(null); return; }
    setServerError('');
    setTierDeleting(true);
    try {
      await deleteTier((props as { eventId: string }).eventId, row.tierId);
      removeTier(tierDelIdx);
      setTierDelIdx(null);
    } catch (e) {
      setServerError(messageForError(e as ApiError, 'delete'));
      setTierDelIdx(null);
    } finally {
      setTierDeleting(false);
    }
  }

  const toggleSellable = () => {
    if (!kycApproved) return; // locked — publishing a paid drop needs verification
    set('sellable', !form.sellable);
  };

  // ── derived preview values ──
  const tiersForBody = usableTiers(form);
  const priceFrom = priceFromOf(tiersForBody);
  const totalCap = tiersForBody.reduce((sum, t) => sum + (Number.isFinite(t.capacity) ? t.capacity : 0), 0);
  // BS25: a sellable drop with real tiers but none on sale is hidden from the
  // storefront — warn here (matches the dashboard flag) so it's never a surprise.
  const realTierRows = form.tiers.filter((t) => t.tierId || t.name.trim());
  const noneOnSale = form.sellable && realTierRows.length > 0 && realTierRows.every((t) => t.disabled);
  const whenLabel = [form.dateLabel, form.time].filter(Boolean).join(' · ').toUpperCase();
  const locLabel = [form.venue, form.city].filter(Boolean).join(' — ').toUpperCase();

  async function handleSubmit() {
    if (submitting) return; // disable-on-submit guard (belt + braces with disabled attr)
    setShowValidation(true);
    setServerError('');
    if (invalid) return;
    setSubmitting(true);
    try {
      const body = buildBody(form, idemKeyRef.current);
      if (isEdit) await updateDrop((props as { eventId: string }).eventId, body);
      else await createDrop(body);
      // Success → back to the dashboard (MT4 owns the drops list refresh).
      router.push('/dashboard');
    } catch (e) {
      const err = e as ApiError;
      // A 403 kyc_required means the org lost/never had approval — reflect it.
      if (err.error === 'kyc_required') {
        setKycStatus('unverified');
        setForm((f) => ({ ...f, sellable: false }));
      }
      setServerError(messageForError(err, 'save'));
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setServerError('');
    setDeleting(true);
    try {
      await deleteDrop((props as { eventId: string }).eventId);
      router.push('/dashboard');
    } catch (e) {
      const err = e as ApiError;
      if (err.error === 'kyc_required') setKycStatus('unverified');
      setServerError(messageForError(err, 'delete'));
      setConfirmOpen(false);
      setDeleting(false);
    }
  }

  // BS24: archive/restore from the editor. Both return to the dashboard on success.
  async function handleArchive() {
    if (archiving) return;
    setServerError('');
    setArchiving(true);
    try {
      await archiveDrop((props as { eventId: string }).eventId);
      router.push('/dashboard');
    } catch (e) {
      setServerError(messageForError(e as ApiError, 'save'));
      setArchiving(false);
    }
  }
  async function handleRestore() {
    if (archiving) return;
    setServerError('');
    setArchiving(true);
    try {
      await unarchiveDrop((props as { eventId: string }).eventId);
      router.push('/dashboard');
    } catch (e) {
      setServerError(messageForError(e as ApiError, 'save'));
      setArchiving(false);
    }
  }

  // ── non-ready render states ──
  if (loadState === 'loading') {
    return (
      <Shell>
        <div className="loading">
          <span className="spin" />
          LOADING…
        </div>
      </Shell>
    );
  }
  if (loadState === 'load_error') {
    return (
      <Shell>
        <div className="fatal">
          {loadErrMsg} <a href="/dashboard">Back to dashboard →</a>
        </div>
      </Shell>
    );
  }
  if (loadState === 'not_found') {
    return (
      <Shell>
        <div className="fatal">
          That drop no longer exists, or it isn&apos;t yours. <a href="/dashboard">Back to dashboard →</a>
        </div>
      </Shell>
    );
  }

  const submitLabel = form.sellable ? 'PUBLISH DROP' : 'SAVE DRAFT';
  const submitBusy = submitting;

  return (
    <Shell>
      <div className="top">
        <div className="top-in">
          <a className="back" href="/dashboard">
            ← DASHBOARD
          </a>
          <span className="brand">
            z<span className="o">o</span>ra dashboard
          </span>
          <div className="top-actions">
            <button className="publish" onClick={handleSubmit} disabled={submitBusy}>
              {submitBusy ? (
                <>
                  <span className="spin" />
                  SAVING…
                </>
              ) : (
                submitLabel
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="grid">
        <div>
          <h1>{isEdit ? 'Edit drop' : 'Create a drop'}</h1>
          <p className="sub">
            One page. Fill what you know, publish when you&apos;re ready. Drafts are always allowed — a public, paid drop
            needs a verified account.
          </p>

          {serverError ? (
            <div className="banner error">
              <AlertIcon />
              <span>{serverError}</span>
            </div>
          ) : null}

          {/* 1 · details */}
          <div className="block">
            <p className="block-h">
              <span className="n">1</span>THE DETAILS
            </p>
            <div className="field">
              <label>DROP TITLE</label>
              <input
                className={'in big' + (showValidation && errors.name ? ' err' : '')}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Garden Brunch — Vol. 10"
                maxLength={80}
              />
              {showValidation && errors.name ? <p className="field-err">{errors.name}</p> : null}
            </div>
            <div className="row2">
              <div className="field">
                <label>DATE</label>
                <input
                  className="in"
                  value={form.dateLabel}
                  onChange={(e) => set('dateLabel', e.target.value)}
                  placeholder="Sat 15 Aug 2026"
                />
              </div>
              <div className="field">
                <label>START TIME</label>
                <input
                  className="in"
                  type="time"
                  value={form.time}
                  onChange={(e) => set('time', e.target.value)}
                />
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label>CITY</label>
                <input
                  className="in"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  placeholder="Dar es Salaam"
                />
              </div>
              <div className="field">
                <label>CATEGORY</label>
                <input
                  className="in"
                  value={form.category}
                  onChange={(e) => set('category', e.target.value)}
                  placeholder="Brunch · Daytime"
                />
              </div>
            </div>
            <div className="field">
              <label>VENUE</label>
              <input
                className="in"
                value={form.venue}
                onChange={(e) => set('venue', e.target.value)}
                placeholder="The Secret Garden, Oysterbay"
              />
            </div>
            <div className="field">
              <label>EVENT COVER IMAGE</label>
              <div
                className={'coverdz' + (form.cover ? ' filled' : '')}
                onClick={() => coverInputRef.current?.click()}
                style={form.cover ? { backgroundImage: `url(${form.cover})` } : undefined}
                role="button"
                tabIndex={0}
              >
                {!form.cover ? (
                  <span className="coverdz-txt">{coverBusy ? 'Uploading to CDN…' : 'Drop a hero image or browse · PNG/JPEG · 1600×900 · under 8MB'}</span>
                ) : (
                  <button
                    type="button"
                    className="coverdz-rm"
                    onClick={(e) => { e.stopPropagation(); set('cover', ''); }}
                    aria-label="Remove cover"
                  >
                    &times;
                  </button>
                )}
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])}
              />
              <p className="hint">Shows as the hero on your public event page. A wide 16:9 image looks best.</p>
            </div>
          </div>

          {/* 2 · tiers */}
          <div className="block">
            <p className="block-h">
              <span className="n">2</span>TICKETS &amp; PRICING
            </p>
            {noneOnSale ? (
              <p className="tiers-hidden-note">
                ⚠ Every tier is off, so this drop is hidden from your storefront. Turn at least one “On sale” back on to
                sell it.
              </p>
            ) : null}
            {form.tiers.map((t, i) => {
              const rowErr = showValidation ? errors.tierRows?.[i] : undefined;
              const hasSales = (t.sold ?? 0) > 0;
              return (
                <div className={'tier' + (rowErr ? ' err' : '') + (t.disabled ? ' off' : '')} key={i}>
                  {t.disabled ? <span className="tier-badge">HIDDEN — NOT ON SALE</span> : null}
                  <div className="tier-grid">
                    <div>
                      <label>TIER NAME</label>
                      <input
                        className="in"
                        value={t.name}
                        onChange={(e) => setTier(i, 'name', e.target.value)}
                        placeholder="General"
                      />
                    </div>
                    <div>
                      <label>PRICE (TZS)</label>
                      <input
                        className="in"
                        type="number"
                        min={0}
                        value={t.price}
                        onChange={(e) => setTier(i, 'price', e.target.value)}
                        placeholder="45000"
                      />
                    </div>
                    <div>
                      <label>CAPACITY</label>
                      <input
                        className="in"
                        type="number"
                        min={0}
                        value={t.capacity}
                        onChange={(e) => setTier(i, 'capacity', e.target.value)}
                        placeholder="220"
                      />
                    </div>
                    <button
                      className="del"
                      title={hasSales ? 'This tier has sales — disable it instead of deleting' : 'Remove tier'}
                      onClick={() => requestRemoveTier(i)}
                      disabled={form.tiers.length <= 1 || hasSales}
                      aria-label="Remove tier"
                    >
                      ×
                    </button>
                  </div>
                  {/* BS23 — on-sale toggle: hide a tier from the storefront (and block
                      new purchases) without deleting it. The one lever that works even
                      after a tier has sold. */}
                  <div className="togglebar" style={{ marginTop: 10 }}>
                    <div className="tg-body">
                      <p className="tg-t">On sale</p>
                      <p className="tg-d">
                        {t.disabled
                          ? 'Hidden from your storefront and not purchasable. Turn on to sell it again.'
                          : 'Shown on your storefront and open for sale. Turn off to stop new sales (existing tickets stay valid).'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={'switch' + (!t.disabled ? ' on' : '')}
                      onClick={() => setTier(i, 'disabled', !t.disabled)}
                      role="switch"
                      aria-checked={!t.disabled}
                      aria-label="Tier on sale"
                    >
                      <span className="knob" />
                    </button>
                  </div>
                  <div className="togglebar" style={{ marginTop: 10 }}>
                    <div className="tg-body">
                      <p className="tg-t">Let guests split this table</p>
                      <p className="tg-d">Buyers invite their crew; each pays a share; the table holds until it fills. Use on table tiers.</p>
                    </div>
                    <button
                      type="button"
                      className={'switch' + (t.splitEnabled ? ' on' : '')}
                      onClick={() => setTier(i, 'splitEnabled', !t.splitEnabled)}
                      role="switch"
                      aria-checked={!!t.splitEnabled}
                      aria-label="Let guests split this table"
                    >
                      <span className="knob" />
                    </button>
                  </div>
                  {t.splitEnabled ? (
                    <div className="field" style={{ marginTop: 10, maxWidth: 240 }}>
                      <label>MAX PEOPLE PER TABLE</label>
                      <input
                        className="in"
                        type="number"
                        min={2}
                        step={1}
                        value={t.seats ?? ''}
                        onChange={(e) => setTier(i, 'seats', e.target.value)}
                        placeholder="8"
                      />
                      <p className="tier-note" style={{ marginTop: 6 }}>
                        The biggest crew that can split this table. Buyers choose any size up to this (default 8).
                      </p>
                    </div>
                  ) : null}
                  {hasSales ? (
                    <p className="tier-note">This tier has sales — it can’t be deleted. Turn off “On sale” to stop new sales.</p>
                  ) : null}
                  {rowErr ? <p className="field-err">{rowErr}</p> : null}
                </div>
              );
            })}
            <button className="add-tier" onClick={addTier}>
              + ADD ANOTHER TIER
            </button>
            {showValidation && errors.tiers ? <p className="field-err">{errors.tiers}</p> : null}
            <div className="capbar">
              <span>
                TOTAL CAPACITY <span style={{ color: 'var(--mut)' }}>— sum of all tiers</span>
              </span>
              <b className="mono">{fmt(totalCap)}</b>
            </div>
          </div>

          {/* 3 · sellable + seated */}
          <div className="block">
            <p className="block-h">
              <span className="n">3</span>VISIBILITY &amp; SEATING
            </p>

            <div className={'togglebar' + (kycApproved ? '' : ' locked')} style={{ marginBottom: 12 }}>
              <div className="tg-body">
                <p className="tg-t">Sell to the public</p>
                <p className="tg-d">
                  {kycApproved
                    ? 'On = a public, paid drop with live checkout. Off = a private draft you can finish later.'
                    : 'Locked until your account is verified. You can still save this as a draft.'}
                </p>
              </div>
              <button
                type="button"
                className={'switch' + (form.sellable ? ' on' : '')}
                onClick={toggleSellable}
                disabled={!kycApproved}
                role="switch"
                aria-checked={form.sellable}
                aria-label="Sell to the public"
              >
                <span className="knob" />
              </button>
            </div>

            {!kycApproved ? (
              <div className="notice kyc">
                <LockIcon />
                <span>
                  <b>Verification required to publish.</b> Ticket sales and your public listing stay locked until our
                  team approves your ID. Saving a draft works right now —{' '}
                  <a href="/dashboard/onboarding" style={{ color: '#854F0B', textDecoration: 'underline' }}>
                    verify your account →
                  </a>
                </span>
              </div>
            ) : null}

            <div className="togglebar" style={{ marginTop: 12 }}>
              <div className="tg-body">
                <p className="tg-t">This is a large / seated event</p>
                <p className="tg-d">Stadiums, arenas, and festivals with assigned seats or standing zones.</p>
              </div>
              <button
                type="button"
                className={'switch' + (form.seated ? ' on' : '')}
                onClick={() => set('seated', !form.seated)}
                role="switch"
                aria-checked={form.seated}
                aria-label="Seated event"
              >
                <span className="knob" />
              </button>
            </div>
          </div>

          {/* BS24 — manage drop: archive (reversible, works even with sales) or, for
              a clean drop, delete. Archived drops show Restore. */}
          {isEdit ? (
            <div className="danger-zone">
              <p className="dz-h">MANAGE DROP</p>
              {status === 'archived' ? (
                <>
                  <p className="dz-d">This drop is archived — hidden from your storefront. Restore it to sell again.</p>
                  <button className="publish" onClick={handleRestore} disabled={archiving}>
                    {archiving ? 'RESTORING…' : 'RESTORE DROP'}
                  </button>
                </>
              ) : (
                <>
                  <p className="dz-d">
                    Archive takes this drop off your storefront and stops new sales — reversible anytime, and works even
                    after it has sold. Delete removes a drop that has no sales.
                  </p>
                  <div className="dz-actions">
                    <button className="ghost" onClick={handleArchive} disabled={archiving}>
                      {archiving ? 'ARCHIVING…' : 'ARCHIVE DROP'}
                    </button>
                    <button className="del-btn" onClick={() => setConfirmOpen(true)} disabled={deleting}>
                      DELETE DROP
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* live preview */}
        <div>
          <div className="side">
            <p className="side-h">LIVE PREVIEW — HOW YOUR CROWD SEES IT</p>
            <div className="pv">
              <p className="pv-url">yourname.zora.com</p>
              <div className="pv-banner">
                <span className="ph">YOUR BANNER APPEARS HERE</span>
              </div>
              <div className="pv-body">
                <span className={'pv-status ' + (form.sellable ? 'live' : 'draft')}>
                  {form.sellable ? 'ON SALE' : 'DRAFT'}
                </span>
                <p className="pv-title">{form.name.trim() || 'Your drop title'}</p>
                <p className="pv-meta">
                  {whenLabel || 'DATE · TIME'}
                  <br />
                  {locLabel || 'VENUE — CITY'}
                </p>
                <div className="pv-foot">
                  <div>
                    <p className="pv-from">FROM</p>
                    <p className="pv-price">{priceFrom > 0 ? `${fmt(priceFrom)} TZS` : '—'}</p>
                  </div>
                  <span className="pv-cta">GET PASSES</span>
                </div>
              </div>
            </div>
            <p className="side-note">
              Buyers pay the price you set — Zora adds no booking fee.
              <br />
              Your payout is that price net of your Zora commission.
            </p>
          </div>
        </div>
      </div>

      {/* delete confirm dialog */}
      {confirmOpen ? (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !deleting && setConfirmOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true">
            <h2>Delete this drop?</h2>
            <p>
              {form.name.trim() ? `“${form.name.trim()}” ` : 'This drop '}
              will be archived and removed from your storefront. This can&apos;t be undone from here. Drops that already
              have sales can&apos;t be deleted.
            </p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirmOpen(false)} disabled={deleting}>
                CANCEL
              </button>
              <button className="confirm-del" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'DELETING…' : 'DELETE DROP'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* BS23 — delete-tier confirm (existing tiers only; new rows drop instantly) */}
      {tierDelIdx != null ? (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !tierDeleting && setTierDelIdx(null)}>
          <div className="modal" role="dialog" aria-modal="true">
            <h2>Delete this tier?</h2>
            <p>
              {form.tiers[tierDelIdx]?.name.trim() ? `“${form.tiers[tierDelIdx].name.trim()}” ` : 'This tier '}
              will be removed from your drop. This can&apos;t be undone. A tier that already has sales or held seats
              can&apos;t be deleted — turn off “On sale” to stop new sales instead.
            </p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setTierDelIdx(null)} disabled={tierDeleting}>
                CANCEL
              </button>
              <button className="confirm-del" onClick={handleDeleteTier} disabled={tierDeleting}>
                {tierDeleting ? 'DELETING…' : 'DELETE TIER'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

// Scoped shell: fonts + page-scoped styles + the palette root class.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="zora-dropedit">{children}</div>
    </>
  );
}
