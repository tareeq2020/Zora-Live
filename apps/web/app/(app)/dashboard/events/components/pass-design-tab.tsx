'use client';

/* BS131 (F6) — the organizer "Pass design" tab (OrgPassDesign mockup).

   GET  /api/org/events/:id/ticket-design           → draft + what it inherits
   PUT  /api/org/events/:id/ticket-design           → Save draft
   POST /api/org/events/:id/ticket-design/publish   → PUBLISH DESIGN
   GET  …/ticket-design/preview.svg?design=<json>   → live preview of the
        unsaved form state (debounced), so the organizer sees every change
        before saving. Buyers only ever see the published design.

   The QR, pass ID, date and venue are fixed on the pass (DD4) — this tab only
   changes the header band, colours, logos, sponsors and optional fields. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadImage } from '../lib/media-upload';

type Template = 'artwork_top' | 'classic_black' | 'full_colour';
type ShowField = 'guest_name' | 'seat' | 'pass_type' | 'dress_code';

type Design = {
  template: Template;
  accent: string | null;
  bgColor: string | null;
  bgImage: string | null;
  logoUrl: string | null;
  organizerLogoUrl: string | null;
  sponsorLogos: string[];
  showFields: ShowField[];
  inheritStorefront: boolean;
};

type Loaded = {
  enabled: boolean;
  status: 'draft' | 'published';
  draft: Partial<Design> | null;
  publishedAt: string | null;
  inherited: { accent: string; logoUrl: string; artworkUrl: string; brandName: string };
};

const TEMPLATES: { id: Template; label: string }[] = [
  { id: 'artwork_top', label: 'Artwork top' },
  { id: 'classic_black', label: 'Classic black' },
  { id: 'full_colour', label: 'Full colour' },
];
const SWATCHES: { hex: string; name: string }[] = [
  { hex: '#F4A259', name: 'apricot' },
  { hex: '#FFD21F', name: 'yellow' },
  { hex: '#7FD1AE', name: 'mint' },
  { hex: '#F7F5EE', name: 'bone' },
];
const FIELDS: { id: ShowField; label: string }[] = [
  { id: 'guest_name', label: 'Guest name' },
  { id: 'seat', label: 'Seat or table' },
  { id: 'pass_type', label: 'Pass type' },
  { id: 'dress_code', label: 'Dress code' },
];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const PASS_IMG = /^image\/(png|jpe?g)$/;

function fromDraft(d: Partial<Design> | null): Design {
  return {
    template: (d?.template as Template) || 'artwork_top',
    accent: d?.accent ?? null,
    bgColor: d?.bgColor ?? null,
    bgImage: d?.bgImage ?? null,
    logoUrl: d?.logoUrl ?? null,
    organizerLogoUrl: d?.organizerLogoUrl ?? null,
    sponsorLogos: Array.isArray(d?.sponsorLogos) ? d!.sponsorLogos!.slice(0, 4) : [],
    showFields: Array.isArray(d?.showFields) ? (d!.showFields as ShowField[]) : ['guest_name', 'seat', 'pass_type'],
    inheritStorefront: d?.inheritStorefront !== false,
  };
}

const errorCopy: Record<string, string> = {
  invalid_colour: 'Use a hex colour like #F4A259.',
  invalid_url: 'Images must be uploaded here or be an https link.',
  too_many_sponsors: 'Up to 4 sponsor logos.',
  invalid_template: 'Pick one of the three templates.',
  feature_off: 'Pass design is not switched on for this event yet.',
  no_draft: 'Save a draft first.',
};

export default function PassDesignTab({ eventId, eventName, eventCover }: { eventId: string; eventName: string; eventCover?: string }) {
  const base = `/api/org/events/${encodeURIComponent(eventId)}/ticket-design`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [design, setDesign] = useState<Design>(fromDraft(null));
  const [hexInput, setHexInput] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'publish' | 'upload'>('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [previewSrc, setPreviewSrc] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(base, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !d) { setErr('Could not load the pass design. Try again.'); return; }
        setLoaded(d);
        const ds = fromDraft(d.draft);
        setDesign(ds);
        setHexInput(ds.accent || d.inherited?.accent || '');
        setStatus(d.status === 'published' && d.publishedAt ? 'published' : 'draft');
      })
      .catch(() => alive && setErr('Could not load the pass design. Try again.'));
    return () => { alive = false; };
  }, [base]);

  // Live preview of the unsaved state, debounced.
  const designJson = useMemo(() => JSON.stringify(design), [design]);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      setPreviewSrc(`${base}/preview.svg?design=${encodeURIComponent(designJson)}`);
    }, 350);
    return () => clearTimeout(t);
  }, [designJson, base, loaded]);

  const update = (patch: Partial<Design>) => {
    setDesign((d) => ({ ...d, ...patch }));
    setDirty(true);
    setMsg('');
    setErr('');
  };

  const effectiveAccent = design.accent || loaded?.inherited.accent || '';

  async function upload(file: File, apply: (url: string) => void, label: string) {
    setBusy('upload'); setErr('');
    try {
      apply(await uploadImage(file, { types: PASS_IMG, typesLabel: 'PNG or JPEG', label }));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy('');
    }
  }

  async function save(): Promise<boolean> {
    setBusy('save'); setErr(''); setMsg('');
    try {
      const r = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: designJson });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(errorCopy[d.error] || 'That didn’t save. Try again.'); return false; }
      setDirty(false);
      setStatus('draft');
      setMsg('Draft saved. Buyers still see the published design.');
      return true;
    } catch {
      setErr('That didn’t save. Check your connection and try again.');
      return false;
    } finally {
      setBusy('');
    }
  }

  async function publish() {
    if (!(await save())) return;
    setBusy('publish');
    try {
      const r = await fetch(`${base}/publish`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(errorCopy[d.error] || 'That didn’t publish. Try again.'); return; }
      setStatus('published');
      setMsg('Published. Every pass for this event now uses this design.');
    } catch {
      setErr('That didn’t publish. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  }

  if (!loaded) {
    return (
      <div className="zp-pd">
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
        <p className="pd-note">{err || 'Loading…'}</p>
      </div>
    );
  }

  const inh = loaded.inherited;
  const toggleField = (f: ShowField) =>
    update({ showFields: design.showFields.includes(f) ? design.showFields.filter((x) => x !== f) : [...design.showFields, f] });

  return (
    <div className="zp-pd">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <header className="pd-head">
        <h2>{eventName || 'Pass design'}</h2>
        <span className="pd-chip">DESIGN · {status === 'published' && !dirty ? 'PUBLISHED' : 'DRAFT'}</span>
        <button type="button" className="pd-ghost" onClick={save} disabled={!!busy}>
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" className="pd-publish" onClick={publish} disabled={!!busy}>
          {busy === 'publish' ? 'PUBLISHING…' : 'PUBLISH DESIGN'}
        </button>
      </header>
      {err ? <p className="pd-err" role="alert">{err}</p> : null}
      {msg ? <p className="pd-ok" role="status">{msg}</p> : null}

      <div className="pd-grid">
        <section className="pd-form">
          <div className="pd-sec">
            <span className="pd-label">1 · TEMPLATE</span>
            <div className="pd-tpls">
              {TEMPLATES.map((t) => {
                const on = design.template === t.id;
                return (
                  <button key={t.id} type="button" className={'pd-tpl' + (on ? ' on' : '')} aria-pressed={on} onClick={() => update({ template: t.id })}>
                    <span className={'pd-tpl-ic ' + t.id} style={{ ['--acc' as any]: effectiveAccent || '#F4A259' }} />
                    {t.label}{on ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="pd-card pd-inherit">
            <input type="checkbox" checked={design.inheritStorefront} onChange={(e) => update({ inheritStorefront: e.target.checked })} />
            <span>
              <b>Use my storefront branding</b>
              <span>Colours, logo and fonts come from your storefront. Change anything below for this event only.</span>
            </span>
          </label>

          <div className="pd-sec">
            <span className="pd-label">2 · COLOURS</span>
            <div className="pd-colours">
              {SWATCHES.map((s) => {
                const on = (design.accent || '').toUpperCase() === s.hex;
                return (
                  <button
                    key={s.hex}
                    type="button"
                    className={'pd-sw' + (on ? ' on' : '')}
                    style={{ background: s.hex }}
                    aria-label={`Accent ${s.name}${on ? ', selected' : ''}`}
                    aria-pressed={on}
                    onClick={() => { update({ accent: s.hex }); setHexInput(s.hex); }}
                  />
                );
              })}
              <label className="pd-hex">
                <span>CUSTOM HEX</span>
                <input
                  value={hexInput}
                  maxLength={7}
                  spellCheck={false}
                  aria-invalid={hexInput !== '' && !HEX.test(hexInput)}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setHexInput(v);
                    if (v === '') update({ accent: null });
                    else if (HEX.test(v)) update({ accent: v.toUpperCase() });
                  }}
                />
              </label>
              <span className="pd-hint">Text colour picked for you so it stays readable.</span>
            </div>
          </div>

          <div className="pd-sec">
            <span className="pd-label">3 · IMAGES AND LOGOS</span>
            <div className="pd-imgs">
              <ImageTile
                title="Event artwork"
                url={design.bgImage}
                fallback={!design.bgImage && (eventCover || inh.artworkUrl) ? 'Using event cover ✓' : 'PNG or JPEG'}
                busy={busy === 'upload'}
                onFile={(f) => upload(f, (u) => update({ bgImage: u }), 'Artwork')}
                onClear={() => update({ bgImage: null })}
              />
              <ImageTile
                title="Organizer logo"
                url={design.organizerLogoUrl}
                fallback={!design.organizerLogoUrl && design.inheritStorefront && inh.logoUrl ? 'From storefront ✓' : 'PNG or JPEG'}
                busy={busy === 'upload'}
                onFile={(f) => upload(f, (u) => update({ organizerLogoUrl: u }), 'Logo')}
                onClear={() => update({ organizerLogoUrl: null })}
              />
              <ImageTile
                title="Event logo"
                url={design.logoUrl}
                fallback="PNG or JPEG"
                busy={busy === 'upload'}
                onFile={(f) => upload(f, (u) => update({ logoUrl: u }), 'Logo')}
                onClear={() => update({ logoUrl: null })}
              />
            </div>
            <div className="pd-card pd-sponsors">
              <span className="pd-sp-t">
                <b>Sponsor logos</b> · {design.sponsorLogos.length} of 4
              </span>
              {design.sponsorLogos.map((u, i) => (
                <span key={u + i} className="pd-sp">
                  <img src={u} alt={`Sponsor ${i + 1}`} />
                  <button type="button" aria-label={`Remove sponsor ${i + 1}`} onClick={() => update({ sponsorLogos: design.sponsorLogos.filter((_, j) => j !== i) })}>×</button>
                </span>
              ))}
              {design.sponsorLogos.length < 4 ? (
                <FileButton
                  className="pd-add"
                  label="+ Add"
                  disabled={busy === 'upload'}
                  onFile={(f) => upload(f, (u) => update({ sponsorLogos: [...design.sponsorLogos, u].slice(0, 4) }), 'Sponsor logo')}
                />
              ) : null}
            </div>
          </div>

          <div className="pd-sec">
            <span className="pd-label">4 · WHAT THE PASS SHOWS</span>
            <div className="pd-fields">
              {FIELDS.map((f) => (
                <label key={f.id}>
                  <input type="checkbox" checked={design.showFields.includes(f.id)} onChange={() => toggleField(f.id)} />
                  {f.label}
                </label>
              ))}
            </div>
            <span className="pd-note">Date, venue, QR code and pass ID always show, in the same place, so every pass scans at the door.</span>
          </div>
        </section>

        <aside className="pd-aside">
          <span className="pd-pvtab">PASS</span>
          <div className="pd-pv">
            {previewSrc ? <img src={previewSrc} alt="Live preview of the pass with a sample guest" /> : null}
          </div>
          <span className="pd-note pd-center">Live preview with sample guest. Buyers see the new design only after you publish.</span>
        </aside>
      </div>
    </div>
  );
}

function FileButton({ label, onFile, disabled, className }: { label: React.ReactNode; onFile: (f: File) => void; disabled?: boolean; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

function ImageTile({
  title, url, fallback, busy, onFile, onClear,
}: { title: string; url: string | null; fallback: string; busy: boolean; onFile: (f: File) => void; onClear: () => void }) {
  return (
    <div className="pd-tile">
      <FileButton
        className="pd-tile-btn"
        disabled={busy}
        onFile={onFile}
        label={
          <>
            {url ? <img src={url} alt="" /> : null}
            <b>{title}</b>
            <span>{url ? 'Uploaded ✓' : fallback}</span>
          </>
        }
      />
      {url ? (
        <button type="button" className="pd-tile-x" aria-label={`Remove ${title.toLowerCase()}`} onClick={onClear}>×</button>
      ) : null}
    </div>
  );
}

// Fixed light ZoraPass surface (the mockup), scoped to .zp-pd.
const STYLE = `
.zp-pd{--pd-ink:#111111;--pd-paper:#F7F5EE;--pd-card:#FFFFFF;--pd-line:#D9D6CC;--pd-mut:#4A4A4A;
  max-width:1200px;margin:16px auto 40px;background:var(--pd-paper);color:var(--pd-ink);border-radius:16px;padding:24px 28px;
  font-family:var(--zp-font-sans);box-sizing:border-box}
.zp-pd *{box-sizing:border-box}
.zp-pd .pd-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.zp-pd .pd-head h2{margin:0;font-size:28px;font-weight:800;letter-spacing:-.02em;flex:1 1 240px;min-width:0}
.zp-pd .pd-chip{font-family:var(--zp-font-mono);font-size:12px;letter-spacing:.12em;border:2px solid var(--pd-ink);border-radius:999px;padding:6px 12px}
.zp-pd .pd-ghost{height:48px;padding:0 20px;border-radius:16px;border:2px solid var(--pd-ink);background:transparent;color:var(--pd-ink);font-family:var(--zp-font-sans);font-weight:700;font-size:15px;cursor:pointer}
.zp-pd .pd-publish{height:48px;padding:0 20px;border-radius:16px;border:none;background:var(--pd-ink);color:#FFD21F;font-family:var(--zp-font-display);font-size:20px;cursor:pointer}
.zp-pd button:disabled{opacity:.6;cursor:default}
.zp-pd button:focus-visible,.zp-pd input:focus-visible{outline:3px solid #1597D4;outline-offset:2px}
.zp-pd .pd-err,.zp-pd .pd-ok{margin:14px 0 0;padding:10px 14px;border-radius:12px;font-size:14px;background:var(--pd-card);border-left:4px solid #B42318}
.zp-pd .pd-ok{border-left-color:#0F7B3F}
.zp-pd .pd-grid{display:flex;gap:40px;align-items:flex-start;margin-top:28px}
.zp-pd .pd-form{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:22px}
.zp-pd .pd-sec{display:flex;flex-direction:column;gap:10px}
.zp-pd .pd-label{font-family:var(--zp-font-mono);font-size:12px;letter-spacing:.12em}
.zp-pd .pd-tpls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.zp-pd .pd-tpl{height:120px;border-radius:16px;border:1px solid var(--pd-line);background:var(--pd-card);color:var(--pd-ink);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;font-family:var(--zp-font-sans);font-weight:700;font-size:15px;cursor:pointer}
.zp-pd .pd-tpl.on{border:3px solid var(--pd-ink)}
.zp-pd .pd-tpl-ic{width:44px;height:56px;border-radius:6px;background:#111111}
.zp-pd .pd-tpl-ic.artwork_top{background:var(--acc);border-bottom:22px solid #111111}
.zp-pd .pd-tpl-ic.full_colour{background:var(--acc)}
.zp-pd .pd-card{display:flex;gap:14px;align-items:center;background:var(--pd-card);border:1px solid var(--pd-line);border-radius:16px;padding:14px 18px}
.zp-pd .pd-inherit input{width:22px;height:22px;accent-color:var(--pd-ink);flex:none}
.zp-pd .pd-inherit>span{flex:1;display:flex;flex-direction:column}
.zp-pd .pd-inherit>span>span{font-size:14px;color:var(--pd-mut)}
.zp-pd .pd-colours{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.zp-pd .pd-sw{width:48px;height:48px;border-radius:12px;border:1px solid var(--pd-line);cursor:pointer}
.zp-pd .pd-sw.on{border:3px solid var(--pd-ink)}
.zp-pd .pd-hex{display:flex;flex-direction:column;gap:4px;margin-left:12px}
.zp-pd .pd-hex span{font-family:var(--zp-font-mono);font-size:11px;letter-spacing:.12em}
.zp-pd .pd-hex input{height:44px;width:120px;border-radius:12px;border:2px solid var(--pd-line);padding:0 12px;font-family:var(--zp-font-mono);font-size:16px;background:var(--pd-card);color:var(--pd-ink)}
.zp-pd .pd-hex input[aria-invalid="true"]{border-color:#B42318}
.zp-pd .pd-hint{font-size:13px;color:#3A3A3A;max-width:200px}
.zp-pd .pd-imgs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.zp-pd .pd-tile{position:relative}
.zp-pd .pd-tile-btn{width:100%;height:96px;border-radius:16px;border:2px dashed var(--pd-ink);background:var(--pd-card);color:var(--pd-ink);font-family:var(--zp-font-sans);font-size:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;overflow:hidden;position:relative}
.zp-pd .pd-tile-btn img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.25}
.zp-pd .pd-tile-btn b,.zp-pd .pd-tile-btn span{position:relative}
.zp-pd .pd-tile-btn span{font-weight:400;color:var(--pd-mut);font-size:13px}
.zp-pd .pd-tile-x{position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:999px;border:1px solid var(--pd-line);background:var(--pd-card);cursor:pointer;font-size:16px;line-height:1}
.zp-pd .pd-sponsors{flex-wrap:wrap}
.zp-pd .pd-sp-t{flex-grow:1}
.zp-pd .pd-sp-t b{font-weight:700}
.zp-pd .pd-sp{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--pd-line);border-radius:8px;padding:4px 8px}
.zp-pd .pd-sp img{height:28px;max-width:72px;object-fit:contain}
.zp-pd .pd-sp button{border:0;background:none;font-size:16px;cursor:pointer;padding:0 2px}
.zp-pd .pd-add{height:40px;padding:0 14px;border-radius:12px;border:2px solid var(--pd-ink);background:transparent;color:var(--pd-ink);font-weight:700;font-family:var(--zp-font-sans);cursor:pointer}
.zp-pd .pd-fields{display:flex;gap:20px;flex-wrap:wrap;font-size:15px}
.zp-pd .pd-fields label{display:flex;gap:8px;align-items:center}
.zp-pd .pd-fields input{width:20px;height:20px;accent-color:var(--pd-ink)}
.zp-pd .pd-note{font-size:13px;color:var(--pd-mut)}
.zp-pd .pd-center{text-align:center}
.zp-pd .pd-aside{width:420px;flex:none;display:flex;flex-direction:column;gap:12px;align-items:center;position:sticky;top:16px}
.zp-pd .pd-pvtab{align-self:stretch;height:40px;border-radius:999px;border:2px solid var(--pd-ink);background:var(--pd-ink);color:#FFD21F;font-family:var(--zp-font-mono);font-size:12px;display:flex;align-items:center;justify-content:center}
.zp-pd .pd-pv{width:330px;min-height:560px}
.zp-pd .pd-pv img{display:block;width:100%;height:auto}
@media (max-width:960px){
  .zp-pd{padding:16px}
  .zp-pd .pd-grid{flex-direction:column}
  .zp-pd .pd-aside{width:100%;position:static}
  .zp-pd .pd-tpls,.zp-pd .pd-imgs{grid-template-columns:1fr}
  .zp-pd .pd-pv{width:min(330px,100%)}
}
`;
