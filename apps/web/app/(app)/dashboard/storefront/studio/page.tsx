'use client';

/* PR-F6/F7 — the white-label storefront customizer (studio.html) at
   /dashboard/storefront/studio, rebranded from bare "STUDIO" to the
   "Storefront Studio" mode of the dashboard. Faithful port: page-scoped styles +
   markup via dangerouslySetInnerHTML, original script (live postMessage preview,
   drag-drop CDN uploads, PUT /api/storefront-theme) run once on mount. Styles
   scoped under `.zora-studio`; the DASHBOARD breadcrumb points to /dashboard and
   the preview iframe to the React storefront index at /@<the acting organizer's
   own handle> (BS47 — resolved from /api/org/me on mount, previously hardcoded
   to /@thebrunchcity for every organizer; PR-F5's storefront still listens for
   the same `zora-theme` postMessage for live preview). */

import { useEffect, useRef, useState } from 'react';
import { CrShell } from '@/app/components/cr';
import { ORG_NAV, ORG_BRAND } from '../../components/org-nav';

// BS76 (Lane —): re-skinned to the Control-Room v2 token language. The studio's
// own dark palette (--black/--ink/--bone…) is now REMAPPED onto the shared
// `--cr-*` tokens (light default · flips with the CrShell theme toggle) so the
// editor reads as the same product as Overview/Sales. Chrome only — .device /
// .device iframe keep their #fff background on purpose: that's the organizer's
// OWN live storefront preview rendering through, not platform chrome, and
// changing it would make the preview lie about what buyers actually see. The
// checkerboard behind the device frame (.pv-stage) IS chrome (a transparency
// indicator) so it's rebuilt from the theme tokens and flips with the theme.
// NOTE: only the CSS token values change here — every id/class the SCRIPT and
// the state-driven class toggles (`open`/`filled`/`drag`/`on`/`mobile`/`up`/
// `toast`) rely on is preserved, so behaviour is byte-for-byte identical.
const STYLE = `
.zora-studio{--black:var(--cr-paper);--ink:var(--cr-card2);--hair:var(--cr-hair);
  --hair2:color-mix(in srgb, var(--cr-ink) 14%, var(--cr-hair));
  --bone:var(--cr-ink);--mut:var(--cr-mut);--blue:var(--cr-blue);--teal:var(--cr-cyan);
  --sans:var(--cr-sans);--mono:var(--cr-mono);
  background:var(--cr-card);color:var(--cr-ink);font-family:var(--sans);font-size:14px;-webkit-font-smoothing:antialiased;height:calc(100dvh - 104px);overflow:hidden;border:1px solid var(--cr-hair);border-radius:18px}
.zora-studio *{margin:0;padding:0;box-sizing:border-box}
.zora-studio a{color:inherit;text-decoration:none}
.zora-studio .mono{font-family:var(--mono)}
.zora-studio button{font-family:inherit}
.zora-studio .studio{display:flex;flex-direction:column;height:100%}
.zora-studio .top{display:flex;align-items:center;gap:16px;padding:12px 20px;border-bottom:1px solid var(--hair);background:var(--ink);flex-shrink:0}
.zora-studio .top .url{font-family:var(--mono);font-size:12px;color:var(--mut);background:var(--cr-card);border:1px solid var(--hair);border-radius:8px;padding:8px 14px}
.zora-studio .top .url b{color:var(--bone);font-weight:500}
.zora-studio .top .save-state{margin-left:auto;font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;color:var(--mut)}
.zora-studio .publish{background:var(--blue);color:#fff;border:1px solid var(--blue);border-radius:9px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.14em;padding:11px 24px;cursor:pointer;transition:background .2s,border-color .2s,opacity .2s}
.zora-studio .publish:hover{background:color-mix(in srgb,var(--blue) 84%,#000);border-color:color-mix(in srgb,var(--blue) 84%,#000)}
.zora-studio .publish:disabled{opacity:.5;cursor:wait}
.zora-studio .workspace{display:flex;flex:1;min-height:0}
.zora-studio .controls{width:35%;min-width:340px;max-width:460px;border-right:1px solid var(--hair);overflow-y:auto;background:var(--ink)}
.zora-studio .preview{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--black)}
@media(max-width:820px){.zora-studio .workspace{flex-direction:column}.zora-studio .controls{width:100%;max-width:none;height:auto}}
.zora-studio .acc{border-bottom:1px solid var(--hair)}
.zora-studio .acc-h{width:100%;display:flex;align-items:center;justify-content:space-between;padding:18px 22px;background:none;border:none;cursor:pointer;text-align:left}
.zora-studio .acc-h .t{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--bone)}
.zora-studio .acc-h .n{font-family:var(--mono);font-size:10px;color:var(--mut);margin-right:10px}
.zora-studio .acc-h .chev{color:var(--mut);transition:transform .2s;font-size:12px}
.zora-studio .acc.open .acc-h .chev{transform:rotate(180deg);color:var(--blue)}
.zora-studio .acc-body{display:none;padding:4px 22px 26px}
.zora-studio .acc.open .acc-body{display:block}
.zora-studio label{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.18em;color:var(--mut);margin-bottom:8px}
.zora-studio .field{margin-bottom:20px}
.zora-studio .in{width:100%;background:var(--cr-card);border:1px solid var(--hair);border-radius:9px;color:var(--bone);font-family:var(--sans);font-size:14px;padding:11px 13px;outline:none;transition:border-color .2s}
.zora-studio .in:hover{border-color:color-mix(in srgb,var(--blue) 40%,var(--hair))}
.zora-studio .in:focus{border-color:var(--blue)}
.zora-studio select.in{-webkit-appearance:none;appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238A8778'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 13px center}
.zora-studio .handle-wrap{display:flex;align-items:stretch;border:1px solid var(--hair);border-radius:9px;overflow:hidden;background:var(--cr-card)}
.zora-studio .handle-wrap:focus-within{border-color:var(--blue)}
.zora-studio .handle-wrap input{flex:1;border:none;outline:none;font-family:var(--mono);font-size:13.5px;padding:11px 13px 11px 4px;background:none;text-align:left;color:var(--bone)}
.zora-studio .handle-wrap .pre{display:flex;align-items:center;padding:0 0 0 13px;font-family:var(--mono);font-size:13.5px;color:var(--mut)}
.zora-studio .dz{border:2px dashed var(--hair);border-radius:12px;background:var(--cr-card);min-height:104px;display:flex;align-items:center;gap:14px;padding:14px;cursor:pointer;transition:border-color .2s,background .2s;position:relative}
.zora-studio .dz:hover{border-color:var(--hair2)}
.zora-studio .dz.drag{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 10%,transparent)}
.zora-studio .dz .thumb{width:76px;height:76px;border-radius:10px;background:var(--ink) center/contain no-repeat;border:1px solid var(--hair);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--mut);font-family:var(--mono);font-size:9px;overflow:hidden}
.zora-studio .dz .dz-txt{flex:1;min-width:0}
.zora-studio .dz .dz-txt .tt{font-size:13px;font-weight:500;color:var(--bone)}
.zora-studio .dz .dz-txt .tt b{color:var(--blue)}
.zora-studio .dz .dz-txt .dd{font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;color:var(--mut);margin-top:5px;line-height:1.6}
.zora-studio .dz .dz-txt .up{font-family:var(--mono);font-size:9.5px;color:var(--teal);margin-top:5px}
.zora-studio .dz .dz-txt .up.err{color:var(--cr-red)}
.zora-studio .dz .rm{position:absolute;top:8px;right:8px;background:var(--cr-ink);color:var(--cr-card);border:none;width:22px;height:22px;border-radius:50%;font-size:13px;cursor:pointer;display:none}
.zora-studio .dz.filled .rm{display:block}
.zora-studio .color-row{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.zora-studio .color-row .cl{flex:1;font-size:13px;color:var(--bone)}
.zora-studio .color-row .cl small{display:block;font-family:var(--mono);font-size:9px;letter-spacing:.06em;color:var(--mut);margin-top:2px}
.zora-studio .color-row .hex{width:96px;font-family:var(--mono);font-size:12.5px;text-transform:uppercase;background:var(--cr-card);color:var(--bone);border:1px solid var(--hair);border-radius:8px;padding:9px 10px;outline:none}
.zora-studio .color-row .hex:focus{border-color:var(--blue)}
.zora-studio .swatch{width:38px;height:38px;border-radius:9px;border:1px solid var(--hair);padding:0;cursor:pointer;overflow:hidden;background:var(--cr-card)}
.zora-studio .swatch::-webkit-color-swatch-wrapper{padding:0}
.zora-studio .swatch::-webkit-color-swatch{border:none;border-radius:8px}
.zora-studio .pv-bar{display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--hair);flex-shrink:0}
.zora-studio .seg{display:flex;background:var(--ink);border:1px solid var(--hair);border-radius:9px;padding:4px;gap:4px}
.zora-studio .seg button{border:none;background:none;border-radius:6px;padding:8px 16px;font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--mut);cursor:pointer;display:flex;align-items:center;gap:7px}
.zora-studio .seg button.on{background:color-mix(in srgb,var(--blue) 14%,transparent);color:var(--blue)}
.zora-studio .seg button svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2}
.zora-studio .pv-url{font-family:var(--mono);font-size:11.5px;color:var(--mut);background:var(--ink);border:1px solid var(--hair);border-radius:8px;padding:8px 14px}
.zora-studio .pv-reload{margin-left:auto;background:var(--cr-card);border:1px solid var(--hair);border-radius:8px;color:var(--mut);font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;padding:9px 14px;cursor:pointer}
.zora-studio .pv-reload:hover{border-color:var(--blue);color:var(--blue)}
.zora-studio .pv-stage{flex:1;min-height:0;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:26px;background:repeating-conic-gradient(var(--cr-card2) 0% 25%, var(--cr-paper) 0% 50%) 50% / 22px 22px}
.zora-studio .device{background:#fff;border-radius:14px;overflow:hidden;box-shadow:var(--cr-shadow);transition:width .3s,max-width .3s;width:100%;max-width:1200px;height:calc(100dvh - 300px)}
.zora-studio .device.mobile{width:390px;max-width:390px;border-radius:34px;border:9px solid #111;height:780px;max-height:calc(100dvh - 320px)}
.zora-studio .device iframe{width:100%;height:100%;border:none;display:block;background:#fff}
.zora-studio .toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--cr-ink);color:var(--cr-paper);font-family:var(--mono);font-size:12px;letter-spacing:.08em;padding:13px 26px;border-radius:9px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:99}
.zora-studio .toast.err{background:var(--cr-red);color:#fff}
.zora-studio .toast.show{opacity:1}
`;

const MARKUP = `
<div class="studio">
  <div class="top">
    <span class="url" id="live-url">zorapass.com/thebrunchcity</span>
    <span class="save-state" id="save-state">All changes staged</span>
    <button class="publish" id="publish">PUBLISH TO WEB</button>
  </div>

  <div class="workspace">
    <!-- LEFT: control panel -->
    <aside class="controls" id="controls">

      <div class="acc open" data-acc>
        <button class="acc-h"><span><span class="n">01</span><span class="t">IDENTITY</span></span><span class="chev">&#9662;</span></button>
        <div class="acc-body">
          <div class="field">
            <label>YOUR STORE ADDRESS</label>
            <div class="handle-wrap"><span class="pre">zorapass.com/</span><input id="f-handle" autocomplete="off" spellcheck="false" readonly placeholder="organizer"></div>
          </div>
          <div class="field">
            <label>BRAND NAME</label>
            <input class="in" id="f-brand" placeholder="The Brunch City">
          </div>
          <div class="field">
            <label>LOGO</label>
            <div class="dz" id="dz-logo" data-accept="png,jpg,jpeg,svg">
              <div class="thumb" id="thumb-logo">LOGO</div>
              <div class="dz-txt"><p class="tt">Drop a logo or <b>browse</b></p><p class="dd">PNG · JPEG · SVG · high-res, transparent best</p><p class="up" id="up-logo"></p></div>
              <button class="rm" data-rm="logoUrl" aria-label="Remove">&times;</button>
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" hidden>
            </div>
          </div>
          <div class="field">
            <label>FAVICON</label>
            <div class="dz" id="dz-favicon" data-accept="png,jpg,jpeg,svg" style="min-height:88px">
              <div class="thumb" id="thumb-favicon" style="width:56px;height:56px">ICON</div>
              <div class="dz-txt"><p class="tt">Drop a favicon or <b>browse</b></p><p class="dd">Square · PNG or SVG · 512×512</p><p class="up" id="up-favicon"></p></div>
              <button class="rm" data-rm="faviconUrl" aria-label="Remove">&times;</button>
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" hidden>
            </div>
          </div>
        </div>
      </div>

      <div class="acc" data-acc>
        <button class="acc-h"><span><span class="n">02</span><span class="t">HERO SECTIONS</span></span><span class="chev">&#9662;</span></button>
        <div class="acc-body">
          <div class="field">
            <label>DESKTOP BANNER</label>
            <div class="dz" id="dz-banner" data-accept="png,jpg,jpeg">
              <div class="thumb" id="thumb-banner" style="width:104px;height:60px">16:9</div>
              <div class="dz-txt"><p class="tt">Drop a banner or <b>browse</b></p><p class="dd">PNG · JPEG · 1600×900 · under 8MB</p><p class="up" id="up-banner"></p></div>
              <button class="rm" data-rm="bannerUrl" aria-label="Remove">&times;</button>
              <input type="file" accept="image/png,image/jpeg" hidden>
            </div>
          </div>
          <p class="dd" style="font-family:var(--mono);font-size:10px;color:var(--mut);line-height:1.7;letter-spacing:.03em">Zora auto-crops a mobile-optimized 4:5 version of your banner for phone screens — no separate upload needed.</p>
        </div>
      </div>

      <div class="acc open" data-acc>
        <button class="acc-h"><span><span class="n">03</span><span class="t">STYLING ENGINE</span></span><span class="chev">&#9662;</span></button>
        <div class="acc-body">
          <div class="color-row">
            <div class="cl">Primary<small>ACCENT · BUTTONS</small></div>
            <input class="hex" id="hex-accent" maxlength="7"><input class="swatch" type="color" id="sw-accent">
          </div>
          <div class="color-row">
            <div class="cl">Secondary<small>SUPPORTING</small></div>
            <input class="hex" id="hex-secondary" maxlength="7"><input class="swatch" type="color" id="sw-secondary">
          </div>
          <div class="color-row">
            <div class="cl">Background<small>PAGE</small></div>
            <input class="hex" id="hex-bg" maxlength="7"><input class="swatch" type="color" id="sw-bg">
          </div>
          <div class="color-row" style="margin-bottom:22px">
            <div class="cl">Cards<small>SURFACES</small></div>
            <input class="hex" id="hex-card" maxlength="7"><input class="swatch" type="color" id="sw-card">
          </div>
          <div class="field" style="margin-bottom:0">
            <label>TYPOGRAPHY</label>
            <select class="in" id="f-type">
              <option value="editorial">Editorial — serif display + grotesque</option>
              <option value="grotesque">Grotesque — all sans, tight</option>
              <option value="monoforward">Mono-forward — technical</option>
            </select>
          </div>
        </div>
      </div>

    </aside>

    <!-- RIGHT: live preview -->
    <main class="preview">
      <div class="pv-bar">
        <div class="seg" id="viewport-seg">
          <button class="on" data-vp="desktop"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>Desktop</button>
          <button data-vp="mobile"><svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>Mobile</button>
        </div>
        <span class="pv-url" id="pv-url">zorapass.com/thebrunchcity</span>
        <button class="pv-reload" id="pv-reload">RELOAD</button>
      </div>
      <div class="pv-stage">
        <div class="device" id="device">
          <iframe id="preview-frame" src="about:blank" title="Storefront preview"></iframe>
        </div>
      </div>
    </main>
  </div>
</div>

<p class="toast" id="toast"></p>
`;

const SCRIPT = String.raw`
  const $ = id => document.getElementById(id);
  function toast(m, err){ const t=$('toast'); t.textContent=m; t.className='toast show'+(err?' err':''); clearTimeout(t._h); t._h=setTimeout(()=>t.className='toast'+(err?' err':''),2600); }

  /* BS47: the acting organizer's real handle, set by the component before this
     script runs (fetched from /api/org/me) — no more hardcoded thebrunchcity. */
  const ORG_HANDLE = (window.__ZORA_STUDIO_HANDLE__ || '');

  /* ── theme state (the single source of truth) ── */
  const theme = {
    handle: ORG_HANDLE, brandName:'',
    accent:'#C46A28', secondary:'#1D6E56', bg:'#F7F1E7', card:'#FFFDF8',
    typography:'editorial', logoUrl:'', faviconUrl:'', bannerUrl:''
  };

  const frame = $('preview-frame');
  frame.src = '/@' + ORG_HANDLE + '?preview=1';
  $('f-handle').value = ORG_HANDLE;
  $('live-url').innerHTML = 'zorapass.com/<b>'+ORG_HANDLE+'</b>';
  $('pv-url').textContent = 'zorapass.com/'+ORG_HANDLE;
  let frameReady = false;
  function pushToPreview(){
    if (!frameReady) return;
    frame.contentWindow.postMessage({ type:'zora-theme', theme }, '*');
  }
  frame.addEventListener('load', ()=>{ frameReady = true; pushToPreview(); });

  function setField(k, v){ theme[k]=v; markStaged(); pushToPreview(); }
  let dirty=false;
  function markStaged(){ dirty=true; $('save-state').textContent='Unpublished changes'; }

  /* ── identity ──
     f-handle is read-only: it's the real, immutable signup handle (BS47 — this
     field used to write into the theme blob and do nothing to actual routing). */
  $('f-brand').addEventListener('input', e=> setField('brandName', e.target.value));

  /* ── styling engine: hex <-> native color, live CSS vars ── */
  const COLORS=[['accent','Primary'],['secondary','Secondary'],['bg','Background'],['card','Cards']];
  function syncColor(key){
    const hex=$('hex-'+key), sw=$('sw-'+key);
    function apply(v){ if(/^#([0-9a-f]{6})$/i.test(v)){ hex.value=v.toUpperCase(); sw.value=v; setField(key, v); } }
    hex.addEventListener('input', ()=>{ let v=hex.value.trim(); if(v[0]!=='#')v='#'+v; if(/^#([0-9a-f]{6})$/i.test(v)) apply(v); });
    sw.addEventListener('input', ()=> apply(sw.value));
  }
  COLORS.forEach(([k])=>syncColor(k));
  $('f-type').addEventListener('change', e=> setField('typography', e.target.value));

  /* ── HTML5 drag-drop upload (validate -> instant thumbnail -> CDN) ── */
  function humanExt(f){ return (f.name.split('.').pop()||'').toLowerCase(); }
  function makeDrop(dzId, field, thumbId, upId){
    const dz=$(dzId), input=dz.querySelector('input[type=file]'), thumb=$(thumbId), up=$(upId);
    const accept=dz.dataset.accept.split(',');
    function validate(f){
      if(!f) return 'No file';
      const ext=humanExt(f), okType=/^image\/(png|jpe?g|svg\+xml)$/.test(f.type)||['png','jpg','jpeg','svg'].includes(ext);
      if(!accept.includes(ext) || !okType) return 'Use '+accept.join(' / ').toUpperCase();
      if(f.size>8*1024*1024) return 'Over 8MB';
      return null;
    }
    async function handle(f){
      const err=validate(f);
      if(err){ up.textContent=err; up.className='up err'; return; }
      const reader=new FileReader();
      reader.onload=async ev=>{
        thumb.style.backgroundImage='url('+ev.target.result+')'; thumb.textContent=''; dz.classList.add('filled');
        up.textContent='Uploading to CDN…'; up.className='up';
        try{
          const r=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,dataUrl:ev.target.result})});
          const d=await r.json(); if(!r.ok) throw new Error(d.error||'Upload failed');
          setField(field, d.url); up.textContent='On CDN ✓'; up.className='up';
        }catch(ex){ up.textContent=String(ex.message||ex); up.className='up err'; }
      };
      reader.readAsDataURL(f);
    }
    dz.addEventListener('click', e=>{ if(!e.target.closest('.rm')) input.click(); });
    input.addEventListener('change', ()=> input.files[0] && handle(input.files[0]));
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); if(ev==='dragleave'&&dz.contains(e.relatedTarget))return; dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e=>{ const f=e.dataTransfer.files[0]; if(f) handle(f); });
    dz.querySelector('.rm').addEventListener('click', e=>{ e.stopPropagation(); thumb.style.backgroundImage=''; thumb.textContent=field==='logoUrl'?'LOGO':field==='faviconUrl'?'ICON':'16:9'; dz.classList.remove('filled'); up.textContent=''; input.value=''; setField(field,''); });
  }
  makeDrop('dz-logo','logoUrl','thumb-logo','up-logo');
  makeDrop('dz-favicon','faviconUrl','thumb-favicon','up-favicon');
  makeDrop('dz-banner','bannerUrl','thumb-banner','up-banner');

  /* ── accordion ── */
  document.querySelectorAll('[data-acc] .acc-h').forEach(h=> h.addEventListener('click', ()=> h.parentElement.classList.toggle('open')));

  /* ── viewport toggle ── */
  $('viewport-seg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b)return;
    document.querySelectorAll('#viewport-seg button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
    $('device').classList.toggle('mobile', b.dataset.vp==='mobile');
  });
  $('pv-reload').addEventListener('click', ()=>{ frameReady=false; frame.src=frame.src; });

  /* ── publish: one PUT updates the live store page ── */
  $('publish').addEventListener('click', async ()=>{
    const btn=$('publish'); btn.disabled=true; const old=btn.textContent; btn.textContent='PUBLISHING…';
    try{
      const r=await fetch('/api/storefront-theme',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(theme)});
      const d=await r.json(); if(!r.ok) throw new Error(d.error||'Publish failed');
      dirty=false; $('save-state').textContent='Published just now';
      toast('Published to zorapass.com/'+theme.handle);
    }catch(ex){ toast(String(ex.message||ex), true); }
    finally{ btn.disabled=false; btn.textContent=old; }
  });

  /* ── boot: load the current theme into the controls ── */
  fetch('/api/storefront-theme?handle='+encodeURIComponent(ORG_HANDLE)).then(r=>r.ok?r.json():null).then(t=>{
    if(!t) return; Object.assign(theme, t);
    $('f-handle').value=theme.handle; $('f-brand').value=theme.brandName;
    $('live-url').innerHTML='zorapass.com/<b>'+theme.handle+'</b>'; $('pv-url').textContent='zorapass.com/'+theme.handle;
    COLORS.forEach(([k])=>{ if(theme[k]){ $('hex-'+k).value=theme[k].toUpperCase(); $('sw-'+k).value=theme[k]; } });
    $('f-type').value=theme.typography;
    [['logoUrl','thumb-logo','dz-logo'],['faviconUrl','thumb-favicon','dz-favicon'],['bannerUrl','thumb-banner','dz-banner']].forEach(([f,th,dz])=>{
      if(theme[f]){ $(th).style.backgroundImage='url('+theme[f]+')'; $(th).textContent=''; $(dz).classList.add('filled'); }
    });
    pushToPreview();
  }).catch(()=>{});
`;

export default function StorefrontStudioPage() {
  // BS76: the top-bar store label (same /api/org/me name pattern as Overview/Sales).
  const [orgName, setOrgName] = useState<string | null>(null);
  const studioRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // BS78 #2: inject the studio markup IMPERATIVELY into a ref-owned host rather
    // than via React's dangerouslySetInnerHTML. Inside CrShell the theme-provider
    // fires a mount re-render that was re-inserting the dangerouslySetInnerHTML
    // subtree and resetting the preview <iframe> to about:blank (iframes don't
    // survive DOM re-insertion; inputs do — which is why the fields refilled but
    // the preview went blank after the re-skin). A ref-owned subtree is invisible
    // to React reconciliation, so the SCRIPT's <iframe> + listeners persist across
    // every re-render, exactly as they did before the studio was wrapped in CrShell.
    const host = studioRef.current;
    if (host && !host.firstChild) host.innerHTML = MARKUP;
    (async () => {
      // BS47: resolve the acting organizer's own handle before the script runs
      // — it used to assume thebrunchcity for every organizer.
      let handle = '';
      try {
        const r = await fetch('/api/org/me');
        const me = r.ok ? await r.json() : null;
        handle = me?.actingHandle || '';
        if (!cancelled && me && typeof me.name === 'string') setOrgName(me.name);
      } catch {
        // fall through with an empty handle; the script degrades gracefully
      }
      if (cancelled) return;
      (window as unknown as { __ZORA_STUDIO_HANDLE__?: string }).__ZORA_STUDIO_HANDLE__ = handle;
      try {
        // eslint-disable-next-line no-new-func
        new Function(SCRIPT)();
      } catch (e) {
        console.error('[storefront-studio] script error', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <CrShell
        nav={ORG_NAV}
        brand={ORG_BRAND}
        topbarTitle="Storefront"
        topbarExtra={
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>{orgName || ' '}</span>
        }
        footer={
          <>
            <a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORAPASS.COM</a>
          </>
        }
      >
        {/* BS76 visual re-skin. BS78 #2: markup is injected imperatively via the
            ref in the effect (see note) so React never reconciles/resets this
            subtree — the preview <iframe> the SCRIPT points at the storefront
            must survive CrShell's mount re-render. */}
        <div className="zora-studio" ref={studioRef} />
      </CrShell>
    </>
  );
}
