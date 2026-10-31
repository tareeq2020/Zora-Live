'use client';

/* PR-F6 — the no-code floor-plan builder (dashboard-seatbuilder.html) at
   /dashboard/events/new/floor-plan. The interactive SVG canvas (pointer
   draw/select zones, sample stadium, PUT /api/events/:id/floorplan when an
   event id is present) is preserved.
   Same faithful pattern: page-scoped styles + markup via
   dangerouslySetInnerHTML, original script run once on mount. Styles scoped
   under `.zora-seatbuilder`; the DASHBOARD breadcrumb points to /dashboard. */

import { useEffect, useRef, useState } from 'react';
import { CrShell } from '@/app/components/cr';
import { ORG_NAV, ORG_BRAND } from '../../../components/org-nav';

// BS75 (Lane) — RE-SKIN onto Control-Room v2: this builder is now wrapped in the
// shared <CrShell> and every local palette var aliases to the theme-aware
// `--cr-*` token set, so it reads as the same product and flips light↔dark with
// the rest of the organizer console. The interactive SVG canvas + imperative
// script stays as a faithful port while the publish/preview endpoints now know
// about event-scoped seat maps. .ztext/.zsub fill stays the fixed dark ink on
// purpose — that text sits ON TOP of a zone's own bright swatch color, not on
// the page background, so it's content-plane, not chrome.
const STYLE = `
.zora-seatbuilder{--black:var(--cr-paper);--ink:var(--cr-card);--hair:var(--cr-hair);--bone:var(--cr-ink);--mut:var(--cr-mut);
  --blue:var(--cr-blue);--teal:var(--cr-green);--amber:var(--cr-amber);
  --sans:var(--cr-sans);--mono:var(--cr-mono);
  color:var(--cr-ink);font-family:var(--cr-sans);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.zora-seatbuilder *{margin:0;padding:0;box-sizing:border-box}
:where(.zora-seatbuilder) a{color:inherit;text-decoration:none}
.zora-seatbuilder .mono{font-family:var(--mono)}
.zora-seatbuilder button{font-family:inherit}
.zora-seatbuilder .top{display:flex;align-items:center;gap:14px;margin-bottom:16px}
.zora-seatbuilder .top-in{display:flex;align-items:center;gap:14px;width:100%}
.zora-seatbuilder .top .title{font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--mut)}
.zora-seatbuilder .top-actions{margin-left:auto;display:flex;gap:10px}
.zora-seatbuilder .ghost{background:var(--cr-card);border:1px solid var(--hair);border-radius:9px;font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--mut);padding:11px 16px;cursor:pointer}
.zora-seatbuilder .ghost:hover{border-color:var(--mut);color:var(--bone)}
.zora-seatbuilder .pub{background:var(--bone);color:var(--cr-paper);border:1px solid var(--bone);border-radius:9px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.14em;padding:11px 22px;cursor:pointer;transition:background .18s,color .18s,border-color .18s}
.zora-seatbuilder .pub:hover{background:var(--blue);border-color:var(--blue);color:#fff}
.zora-seatbuilder .grid{display:grid;grid-template-columns:1fr 330px;gap:0;min-height:0;border:1px solid var(--hair);border-radius:16px;overflow:hidden}
@media(max-width:900px){.zora-seatbuilder .grid{grid-template-columns:1fr}}
.zora-seatbuilder .stage{padding:20px;display:flex;flex-direction:column;gap:14px}
.zora-seatbuilder .toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.zora-seatbuilder .tool{display:flex;align-items:center;gap:7px;background:var(--ink);border:1px solid var(--hair);border-radius:10px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--mut);padding:10px 14px;cursor:pointer}
.zora-seatbuilder .tool.on{background:var(--bone);color:var(--black);border-color:var(--bone)}
.zora-seatbuilder .tool svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2}
.zora-seatbuilder .tool-sep{width:1px;height:22px;background:var(--hair);margin:0 4px}
.zora-seatbuilder .canvas-wrap{position:relative;border:1px solid var(--hair);border-radius:14px;overflow:hidden;background:var(--ink);aspect-ratio:16/9}
.zora-seatbuilder .canvas-wrap.grid-on{background-image:linear-gradient(var(--hair) 1px,transparent 1px),linear-gradient(90deg,var(--hair) 1px,transparent 1px);background-size:5% 8.9%}
.zora-seatbuilder .map-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:.3}
.zora-seatbuilder .empty-map{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--mut);gap:8px;pointer-events:none}
.zora-seatbuilder .empty-map svg{width:34px;height:34px;stroke:var(--mut);fill:none;stroke-width:1.6}
.zora-seatbuilder .empty-map .et{font-size:14px;font-weight:500;color:var(--bone)}
.zora-seatbuilder .empty-map .ed{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em}
.zora-seatbuilder #overlay{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
.zora-seatbuilder #overlay.select{cursor:default}
.zora-seatbuilder .zrect{cursor:pointer}
.zora-seatbuilder .ztext{font-family:var(--mono);fill:#0A0A0B;font-weight:600;pointer-events:none}
.zora-seatbuilder .zsub{font-family:var(--mono);fill:#0A0A0B;opacity:.7;pointer-events:none}
.zora-seatbuilder .upload-row{display:flex;gap:10px;flex-wrap:wrap}
.zora-seatbuilder .up-btn{display:inline-flex;align-items:center;gap:9px;background:var(--ink);border:1px dashed var(--hair);border-radius:10px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--mut);padding:11px 16px;cursor:pointer}
.zora-seatbuilder .up-btn:hover{border-color:var(--blue);color:var(--blue)}
.zora-seatbuilder .up-btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2}
.zora-seatbuilder .up-name{font-family:var(--mono);font-size:11px;color:var(--teal);align-self:center}
.zora-seatbuilder .panel{border-left:1px solid var(--hair);background:var(--ink);padding:20px;display:flex;flex-direction:column;gap:18px}
@media(max-width:900px){.zora-seatbuilder .panel{border-left:none;border-top:1px solid var(--hair)}}
.zora-seatbuilder .p-h{font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--mut)}
.zora-seatbuilder label{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.2em;color:var(--mut);margin-bottom:7px}
.zora-seatbuilder .in{width:100%;background:var(--black);border:1px solid var(--hair);border-radius:9px;color:var(--bone);font-family:var(--sans);font-size:14px;padding:11px 12px;outline:none}
.zora-seatbuilder .in:focus{border-color:var(--blue)}
.zora-seatbuilder select.in{-webkit-appearance:none;appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238A877E'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 13px center}
.zora-seatbuilder .field{margin-bottom:14px}
.zora-seatbuilder .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.zora-seatbuilder .swatches{display:flex;gap:8px}
.zora-seatbuilder .sw{width:26px;height:26px;border-radius:7px;cursor:pointer;border:2px solid transparent}
.zora-seatbuilder .sw.on{border-color:var(--bone)}
.zora-seatbuilder .cap-pill{background:var(--cr-wash-blue);border-radius:9px;padding:12px 14px;font-family:var(--mono);font-size:12px;color:var(--cr-on-wash-blue);display:flex;justify-content:space-between}
.zora-seatbuilder .cap-pill b{font-size:15px}
.zora-seatbuilder .no-sel{color:var(--mut);font-family:var(--mono);font-size:12px;line-height:1.7;letter-spacing:.03em}
.zora-seatbuilder .zlist{display:flex;flex-direction:column;gap:8px}
.zora-seatbuilder .zitem{display:flex;align-items:center;gap:10px;border:1px solid var(--hair);border-radius:10px;padding:10px 12px;cursor:pointer;background:var(--black)}
.zora-seatbuilder .zitem.on{border-color:var(--blue);background:var(--cr-wash-blue)}
.zora-seatbuilder .zitem .dot{width:12px;height:12px;border-radius:4px;flex-shrink:0}
.zora-seatbuilder .zitem .zn{font-size:13px;font-weight:500;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zora-seatbuilder .zitem .zc{font-family:var(--mono);font-size:10px;color:var(--mut)}
.zora-seatbuilder .zitem .del{background:none;border:none;color:var(--mut);cursor:pointer;font-size:15px}
.zora-seatbuilder .zitem .del:hover{color:var(--cr-red)}
.zora-seatbuilder .summary{border-top:1px solid var(--hair);padding-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.zora-seatbuilder .stat{background:var(--black);border:1px solid var(--hair);border-radius:9px;padding:12px}
.zora-seatbuilder .stat .sv{font-family:var(--mono);font-size:18px;font-weight:500}
.zora-seatbuilder .stat .sl{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;color:var(--mut);margin-top:3px}
.zora-seatbuilder .btn-row{display:grid;gap:8px}
.zora-seatbuilder .btn{background:var(--bone);color:var(--black);border:1px solid var(--bone);border-radius:10px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.12em;padding:13px;cursor:pointer;text-align:center;transition:background .18s,color .18s,border-color .18s}
.zora-seatbuilder .btn:hover{background:var(--blue);border-color:var(--blue);color:var(--bone)}
.zora-seatbuilder .btn.sec{background:none;border:1px solid var(--hair);color:var(--mut)}
.zora-seatbuilder .btn.sec:hover{border-color:var(--blue);color:var(--blue);background:none}
/* BS127 — publish state, conflict banner, live seat manager (OrgFloorPlan mockup). */
.zora-seatbuilder .livever{font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--mut);align-self:center}
.zora-seatbuilder .pub-lg{background:var(--zp-color-board-black);color:var(--zp-color-signal-yellow);border:none;border-radius:16px;font-family:var(--zp-font-family-display);font-size:20px;height:48px;padding:0 20px;cursor:pointer}
.zora-seatbuilder .pub-lg:hover{background:#262626}
.zora-seatbuilder .pub-lg:disabled{opacity:.5;cursor:wait}
.zora-seatbuilder button:focus-visible,.zora-seatbuilder input:focus-visible{outline:3px solid var(--cr-ink);outline-offset:2px}
.zora-seatbuilder .conflict{background:#FFFFFF;color:#111111;border:2px solid #B42318;border-radius:12px;padding:10px 14px;font-size:14px;line-height:1.45}
.zora-seatbuilder .conflict strong{color:#B42318}
.zora-seatbuilder .conflict[hidden]{display:none}
.zora-seatbuilder .seatpane{display:flex;flex-direction:column;gap:10px}
.zora-seatbuilder .seltool{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#111111;color:#F7F5EE;border-radius:12px;padding:8px 10px 8px 16px}
.zora-seatbuilder .seltool[hidden]{display:none}
.zora-seatbuilder .seltool .st-sum{font-family:var(--mono);font-size:13px;flex-grow:1}
.zora-seatbuilder .seltool button{height:40px;padding:0 14px;border-radius:10px;border:2px solid #F7F5EE;background:transparent;color:#F7F5EE;font-weight:700;font-size:14px;cursor:pointer}
.zora-seatbuilder .seltool button.yel{background:#FFD21F;border-color:#FFD21F;color:#111111}
.zora-seatbuilder .seltool button:disabled{opacity:.35;cursor:not-allowed}
.zora-seatbuilder .actform{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;background:var(--ink);border:1px solid var(--hair);border-radius:12px;padding:12px}
.zora-seatbuilder .actform[hidden]{display:none}
.zora-seatbuilder .actform .in{width:auto;flex:1 1 160px;min-height:44px}
.zora-seatbuilder .actform .af-lab{flex-basis:100%;font-size:13px;font-weight:700;color:var(--bone)}
.zora-seatbuilder .seatcard{background:#FFFFFF;color:#111111;border:2px solid #111111;border-radius:16px;padding:12px;overflow-x:auto}
.zora-seatbuilder .seatcard .sc-h{font-family:var(--mono);font-size:12px;letter-spacing:.08em;margin-bottom:8px}
.zora-seatbuilder .sm-row{display:flex;gap:4px;align-items:center;margin-bottom:4px}
.zora-seatbuilder .sm-rl{width:16px;flex:none;font-family:var(--mono);font-size:12px}
.zora-seatbuilder .sm{flex:none;width:28px;height:28px;padding:0;border-radius:6px;font-family:var(--mono);font-size:12px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.zora-seatbuilder .sm.tbl{width:auto;min-width:64px;height:48px;border-radius:999px;padding:0 10px}
.zora-seatbuilder .sm-tables{display:flex;flex-wrap:wrap;gap:10px}
.zora-seatbuilder .s-available{border:2px solid #111111;background:#FFFFFF;color:#111111}
.zora-seatbuilder .s-sold{border:2px solid #111111;background:#111111;color:#F7F5EE}
.zora-seatbuilder .s-held{border:2px dashed #4A4A4A;background:#D9D6CC;color:#111111}
.zora-seatbuilder .s-reserved{border:2px solid #4A4A4A;background:#4A4A4A;color:#F7F5EE}
.zora-seatbuilder .s-blocked{border:2px solid #B42318;background:#F7F5EE;color:#B42318}
.zora-seatbuilder .sm.sel{background:#FFD21F;color:#111111;border:2px solid #111111;box-shadow:inset 0 0 0 2px #FFD21F}
.zora-seatbuilder .key{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--bone)}
.zora-seatbuilder .key span{display:flex;gap:6px;align-items:center}
.zora-seatbuilder .key i{width:16px;height:16px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:12px}
.zora-seatbuilder .counts{display:flex;flex-direction:column;gap:6px;font-family:var(--mono);font-size:13px}
.zora-seatbuilder .counts div{display:flex;justify-content:space-between}
.zora-seatbuilder .counts .tot{font-weight:600}
.zora-seatbuilder fieldset.pm{border:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:6px}
.zora-seatbuilder fieldset.pm legend{font-size:13px;font-weight:700;margin-bottom:6px;color:var(--bone)}
.zora-seatbuilder fieldset.pm label{display:flex;gap:8px;align-items:center;font-family:var(--sans);font-size:15px;letter-spacing:0;color:var(--bone);margin:0;min-height:32px}
.zora-seatbuilder fieldset.pm input{width:18px;height:18px;accent-color:#111111}
.zora-seatbuilder .toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--bone);color:var(--black);font-family:var(--mono);font-size:12px;letter-spacing:.08em;padding:13px 24px;border-radius:9px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:50}
.zora-seatbuilder .toast.show{opacity:1}
`;

const MARKUP = `
<div class="top">
  <div class="top-in">
    <span class="title">FLOOR PLAN BUILDER</span>
    <div class="top-actions">
      <span class="livever" id="livever" aria-live="polite"></span>
      <button class="ghost" id="preview">PREVIEW AS BUYER</button>
      <button class="pub-lg" id="publish">PUBLISH MAP</button>
    </div>
  </div>
</div>

<div class="grid">
  <div class="stage">
    <div class="upload-row">
      <button class="up-btn" id="up-btn"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>UPLOAD VENUE MAP (PNG / JPG / WEBP)</button>
      <input type="file" id="up-file" accept="image/png,image/jpeg,image/webp" hidden>
      <span class="up-name" id="up-name"></span>
    </div>

    <div class="toolbar">
      <button class="tool on" id="t-draw" data-tool="draw"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 4v16"/></svg>DRAW ZONE</button>
      <button class="tool" id="t-select" data-tool="select"><svg viewBox="0 0 24 24"><path d="M4 4l7 16 2-7 7-2z"/></svg>SELECT</button>
      <div class="tool-sep"></div>
      <button class="tool" id="t-grid"><svg viewBox="0 0 24 24"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>GRID</button>
      <button class="tool" id="t-sample">LOAD SAMPLE</button>
      <button class="tool" id="t-clear">CLEAR</button>
    </div>

    <div class="canvas-wrap grid-on" id="canvas">
      <img class="map-img" id="map-img" alt="" style="display:none">
      <div class="empty-map" id="empty-map">
        <svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v16M15 6v16"/></svg>
        <p class="et">Drop your venue map, then draw zones</p>
        <p class="ed">Click and drag on the map to draw a ticket zone</p>
      </div>
      <svg id="overlay" viewBox="0 0 1600 900" preserveAspectRatio="none"></svg>
    </div>

    <div class="conflict" id="conflict" role="alert" hidden></div>

    <div class="seatpane" id="seatpane">
      <div class="seltool" id="seltool" role="toolbar" aria-label="Selected seats" hidden>
        <span class="st-sum" id="st-sum"></span>
        <button id="a-block">Block</button>
        <button id="a-reserve" class="yel">Reserve for…</button>
        <button id="a-comp">Give as comps</button>
        <button id="a-release">Release</button>
      </div>
      <div class="actform" id="actform" hidden></div>
      <div class="seatcard" id="seatcard"><p class="sc-h">SEATS</p><p class="no-sel" style="color:#4A4A4A">Pick a seated or table zone to manage its seats.</p></div>
      <div class="key" aria-label="Seat key">
        <span><i class="s-available"></i>Available</span>
        <span><i class="s-sold"></i>Sold</span>
        <span><i class="s-reserved">R</i>Reserved</span>
        <span><i class="s-held"></i>Held in a checkout</span>
        <span><i class="s-blocked">×</i>Blocked</span>
        <span><i class="s-available" style="background:#FFD21F"></i>Selected</span>
      </div>
    </div>
  </div>

  <div class="panel">
    <div>
      <p class="p-h" style="margin-bottom:14px">ZONE EDITOR</p>
      <div id="editor">
        <p class="no-sel">Draw a zone on the map, or pick one from the list below, to set its name, seating, capacity and price.</p>
      </div>
    </div>

    <div>
      <p class="p-h" style="margin-bottom:12px">ZONES</p>
      <div class="zlist" id="zlist"></div>
    </div>

    <div>
      <p class="p-h" style="margin-bottom:12px">SEATS TODAY</p>
      <div class="counts" id="counts"><p class="no-sel">Publish the map to see live seats.</p></div>
    </div>

    <div class="summary">
      <div class="stat"><p class="sv mono" id="s-zones">0</p><p class="sl">ZONES</p></div>
      <div class="stat"><p class="sv mono" id="s-cap">0</p><p class="sl">TOTAL CAPACITY</p></div>
    </div>
    <div class="btn-row">
      <button class="btn" id="publish2">PUBLISH FLOOR PLAN</button>
      <button class="btn sec" id="preview2">OPEN THE BUYER VIEW</button>
    </div>
  </div>
</div>

<p class="toast" id="toast"></p>
`;

const SCRIPT = String.raw`
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('en-US');
  function toast(m){ const t=$('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2200); }
  const params = new URLSearchParams(location.search);
  const EVENT_ID = params.get('event') || params.get('eventId') || params.get('id') || '';
  const planApi = EVENT_ID ? '/api/events/' + encodeURIComponent(EVENT_ID) + '/floorplan' : '/api/floorplan';
  const buyerHref = EVENT_ID ? '/events/' + encodeURIComponent(EVENT_ID) + '/seats' : '/discover';

  const COLORS = ['#3D5AFE','#2FA9A0','#B98A2E','#7A5AF8','#639922','#D4537E'];
  let tool='draw', zones=[], sel=null, nextId=1, tiers=[];

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function tierLabel(t){ return t.name || t.tierId || 'Ticket tier'; }
  function tierOptions(selected){
    const opts = ['<option value="">Not linked — preview only</option>'];
    tiers.forEach(t => opts.push('<option value="'+esc(t.tierId)+'"'+(selected===t.tierId?' selected':'')+'>'+esc(tierLabel(t))+' · '+fmt(Number(t.unitPrice||t.price||0))+' '+esc(t.currency||'TZS')+'</option>'));
    return opts.join('');
  }
  function defaultTierId(){
    const live = tiers.find(t => t && t.tierId && !t.disabled);
    return live ? live.tierId : '';
  }
  function syncPriceFromTier(z){
    if(!z.tierId) return;
    const t = tiers.find(x => x.tierId === z.tierId);
    if(t && Number.isFinite(Number(t.unitPrice || t.price))) z.price = Number(t.unitPrice || t.price);
  }

  /* ── upload ── */
  $('up-btn').onclick=()=>$('up-file').click();
  // BS127: the venue map goes through the media module (POST /api/upload) and
  // its URL is saved on the plan (plan.mapImageUrl), drawn under the zones at 30%.
  let mapImageUrl='';
  function showMap(url){ if(!url) return; $('map-img').src=url; $('map-img').style.display='block'; $('empty-map').style.display='none'; }
  $('up-file').onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    if(f.size>8*1024*1024){ toast('That image is over 8MB'); return; }
    const rd=new FileReader();
    rd.onload=async ev=>{
      $('up-name').textContent='Uploading '+f.name+'…';
      try{
        const r=await fetch('/api/upload',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,dataUrl:ev.target.result})});
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.url) throw new Error(d.error||d.message||'Upload failed');
        mapImageUrl=d.url; showMap(d.url); $('up-name').textContent='✓ '+f.name; touch();
      }catch(err){ $('up-name').textContent=''; toast('Upload failed: '+(err.message||err)); }
    };
    rd.readAsDataURL(f);
  };

  /* ── BS127: live version + unpublished-edits marker ── */
  let liveVersion=0, dirty=false;
  function renderVer(){
    $('livever').textContent = liveVersion ? ('LIVE VERSION '+liveVersion+(dirty?' · EDITS UNPUBLISHED':'')) : (EVENT_ID ? 'NOT PUBLISHED YET' : '');
  }
  function touch(){ dirty=true; renderVer(); }

  /* ── tools ── */
  function setTool(t){ tool=t; $('t-draw').classList.toggle('on',t==='draw'); $('t-select').classList.toggle('on',t==='select'); $('overlay').classList.toggle('select',t==='select'); }
  $('t-draw').onclick=()=>setTool('draw');
  $('t-select').onclick=()=>setTool('select');
  $('t-grid').onclick=()=>{ $('canvas').classList.toggle('grid-on'); $('t-grid').classList.toggle('on'); };
  $('t-clear').onclick=()=>{ if(zones.length&&!confirm('Remove all zones?'))return; zones=[]; sel=null; render(); renderEditor(); touch(); toast('Cleared'); };
  $('t-sample').onclick=loadSample;

  /* ── draw / select on overlay ── */
  const ov=$('overlay');
  function toSvg(e){ const r=ov.getBoundingClientRect(); return { x:(e.clientX-r.left)/r.width*1600, y:(e.clientY-r.top)/r.height*900 }; }
  let drawing=null;
  ov.addEventListener('pointerdown', e=>{
    const zEl=e.target.closest('.zrect');
    if(tool==='select'||zEl){ if(zEl){ selectZone(zEl.getAttribute('data-z')); } return; }
    ov.setPointerCapture(e.pointerId);
    const p=toSvg(e); drawing={x0:p.x,y0:p.y,x1:p.x,y1:p.y};
  });
  ov.addEventListener('pointermove', e=>{ if(!drawing)return; const p=toSvg(e); drawing.x1=p.x; drawing.y1=p.y; render(); });
  ov.addEventListener('pointerup', e=>{
    if(!drawing) return;
    const x=Math.min(drawing.x0,drawing.x1), y=Math.min(drawing.y0,drawing.y1);
    const w=Math.abs(drawing.x1-drawing.x0), h=Math.abs(drawing.y1-drawing.y0);
    drawing=null;
    if(w<40||h<30){ render(); return; }
    const z={ id:'z'+(nextId++), name:'Zone '+(zones.length+1), type:'seated', x,y,w,h, color:COLORS[zones.length%COLORS.length], tierId:defaultTierId(), price:50000, rows:10, perRow:20, cap:200, tables:16, perTable:8 };
    syncPriceFromTier(z);
    zones.push(z); selectZone(z.id); touch(); toast('Zone added — set its details');
  });

  /* ── render zones on overlay ── */
  function render(){
    ov.innerHTML='';
    const NS='http://www.w3.org/2000/svg';
    zones.forEach(z=>{
      const g=document.createElementNS(NS,'g');
      const r=document.createElementNS(NS,'rect');
      r.setAttribute('class','zrect'); r.setAttribute('data-z',z.id);
      r.setAttribute('x',z.x); r.setAttribute('y',z.y); r.setAttribute('width',z.w); r.setAttribute('height',z.h); r.setAttribute('rx',10);
      r.setAttribute('fill',z.color); r.setAttribute('fill-opacity',sel===z.id?0.45:0.28);
      r.setAttribute('stroke',z.color); r.setAttribute('stroke-width',sel===z.id?4:2);
      g.appendChild(r);
      const t=document.createElementNS(NS,'text'); t.setAttribute('class','ztext'); t.setAttribute('x',z.x+z.w/2); t.setAttribute('y',z.y+z.h/2); t.setAttribute('text-anchor','middle'); t.setAttribute('font-size',22); t.textContent=z.name; g.appendChild(t);
      const s=document.createElementNS(NS,'text'); s.setAttribute('class','zsub'); s.setAttribute('x',z.x+z.w/2); s.setAttribute('y',z.y+z.h/2+22); s.setAttribute('text-anchor','middle'); s.setAttribute('font-size',13);
      s.textContent=(z.type==='ga'?'STANDING · '+fmt(z.cap)+' cap':z.type==='table'?(z.tables+' tables × '+z.perTable):z.rows+'×'+z.perRow+' seats')+' · '+fmt(z.price)+' TZS'; g.appendChild(s);
      ov.appendChild(g);
    });
    if(drawing){
      const r=document.createElementNS(NS,'rect');
      r.setAttribute('x',Math.min(drawing.x0,drawing.x1)); r.setAttribute('y',Math.min(drawing.y0,drawing.y1));
      r.setAttribute('width',Math.abs(drawing.x1-drawing.x0)); r.setAttribute('height',Math.abs(drawing.y1-drawing.y0));
      r.setAttribute('rx',10); r.setAttribute('fill','#3D5AFE'); r.setAttribute('fill-opacity',0.18); r.setAttribute('stroke','#3D5AFE'); r.setAttribute('stroke-dasharray','8 6'); r.setAttribute('stroke-width',2);
      ov.appendChild(r);
    }
    renderList(); renderSummary();
    $('empty-map').style.display = (zones.length || mapImageUrl) ? 'none' : '';
  }

  function capOf(z){ return z.type==='ga' ? (z.cap||0) : z.type==='table' ? ((z.tables||0)*(z.perTable||0)) : (z.rows*z.perRow); }

  /* ── editor ── */
  function selectZone(id){ sel=id; setTool('select'); render(); renderEditor(); if(seatSel.size){ seatSel.clear(); } renderSeats(); }
  function renderEditor(){
    const z=zones.find(x=>x.id===sel);
    const box=$('editor');
    if(!z){ box.innerHTML='<p class="no-sel">Draw a zone on the map, or pick one from the list below, to set its name, seating, capacity and price.</p>'; return; }
    box.innerHTML =
      '<div class="field"><label>ZONE NAME</label><input class="in" id="e-name" value="'+esc(z.name)+'"></div>'+
      '<div class="field"><label>TICKET TIER</label><select class="in" id="e-tier">'+tierOptions(z.tierId||'')+'</select><p class="no-sel" style="font-size:10.5px;margin-top:7px">Link each zone to a sellable ticket tier so buyer checkout can reserve inventory.</p></div>'+
      '<div class="field"><label>ZONE TYPE</label><select class="in" id="e-type">'+
        '<option value="seated"'+(z.type==='seated'?' selected':'')+'>Assigned seating (rows &amp; seats)</option>'+
        '<option value="table"'+(z.type==='table'?' selected':'')+'>Table reservations (whole tables)</option>'+
        '<option value="ga"'+(z.type==='ga'?' selected':'')+'>General admission (standing)</option>'+
      '</select></div>'+
      '<div id="e-seated" style="'+(z.type==='seated'?'':'display:none')+'"><div class="row2">'+
        '<div class="field"><label>ROWS</label><input class="in" id="e-rows" type="number" min="1" value="'+(z.rows||10)+'"></div>'+
        '<div class="field"><label>SEATS / ROW</label><input class="in" id="e-per" type="number" min="1" value="'+(z.perRow||20)+'"></div>'+
      '</div></div>'+
      '<div id="e-table" style="'+(z.type==='table'?'':'display:none')+'"><div class="row2">'+
        '<div class="field"><label>NUMBER OF TABLES</label><input class="in" id="e-tables" type="number" min="1" value="'+(z.tables||16)+'"></div>'+
        '<div class="field"><label>SEATS / TABLE</label><input class="in" id="e-pertable" type="number" min="1" value="'+(z.perTable||8)+'"></div>'+
      '</div></div>'+
      '<div id="e-ga" style="'+(z.type==='ga'?'':'display:none')+'"><div class="field"><label>STANDING CAPACITY</label><input class="in" id="e-cap" type="number" min="0" value="'+(z.cap||0)+'"></div></div>'+
      (z.type==='table'?'<fieldset class="pm"><legend>For tables, charge</legend>'+
        '<label><input type="radio" name="e-pm" value="per_table"'+(z.priceMode!=='per_seat'?' checked':'')+'>Per table</label>'+
        '<label><input type="radio" name="e-pm" value="per_seat"'+(z.priceMode==='per_seat'?' checked':'')+'>Per seat</label></fieldset>':'')+
      '<div class="field"><label>'+(z.type==='table'?(z.priceMode==='per_seat'?'PRICE PER SEAT (TZS)':'PRICE PER TABLE (TZS)'):'PRICE (TZS)')+'</label><input class="in" id="e-price" type="number" min="0" value="'+z.price+'"></div>'+
      '<div class="field"><label>COLOUR</label><div class="swatches" id="e-sw">'+COLORS.map(c=>'<span class="sw'+(c===z.color?' on':'')+'" style="background:'+c+'" data-c="'+c+'"></span>').join('')+'</div></div>'+
      '<div class="cap-pill"><span>'+(z.type==='table'?'Tables · total seats':'This zone holds')+'</span><b>'+(z.type==='table'?(fmt(z.tables||0)+' tables · '+fmt(capOf(z))+' seats'):(fmt(capOf(z))+' tickets'))+'</b></div>';

    const capText=()=>{ const b=$('editor').querySelector('.cap-pill b'); if(b) b.textContent = z.type==='table' ? (fmt(z.tables||0)+' tables · '+fmt(capOf(z))+' seats') : (fmt(capOf(z))+' tickets'); };
    const upd=()=>{ z.name=$('e-name').value||z.name; z.price=parseInt($('e-price').value)||0;
      if(z.type==='seated'){ z.rows=Math.max(1,parseInt($('e-rows').value)||1); z.perRow=Math.max(1,parseInt($('e-per').value)||1); }
      else if(z.type==='table'){ z.tables=Math.max(1,parseInt($('e-tables').value)||1); z.perTable=Math.max(1,parseInt($('e-pertable').value)||1); }
      else { z.cap=parseInt($('e-cap').value)||0; }
      capText(); render(); touch(); };
    $('e-name').oninput=upd; $('e-price').oninput=upd;
    $('e-tier').onchange=()=>{ z.tierId=$('e-tier').value||''; syncPriceFromTier(z); renderEditor(); render(); touch(); };
    box.querySelectorAll('input[name="e-pm"]').forEach(r=>{ r.onchange=()=>{ z.priceMode=r.value==='per_seat'?'per_seat':'per_table'; renderEditor(); render(); touch(); }; });
    $('e-type').onchange=()=>{ z.type=$('e-type').value;
      if(z.type==='table'){ if(!z.tables)z.tables=16; if(!z.perTable)z.perTable=8; }
      if(z.type==='ga'&&!z.cap)z.cap=(z.rows||10)*(z.perRow||20);
      renderEditor(); render(); touch(); };
    if($('e-rows')){ $('e-rows').oninput=upd; $('e-per').oninput=upd; }
    if($('e-tables')){ $('e-tables').oninput=upd; $('e-pertable').oninput=upd; }
    if($('e-cap')) $('e-cap').oninput=upd;
    $('e-sw').onclick=e=>{ const c=e.target.getAttribute('data-c'); if(c){ z.color=c; renderEditor(); render(); touch(); } };
  }

  function renderList(){
    $('zlist').innerHTML = zones.length ? zones.map(z=>
      '<div class="zitem'+(sel===z.id?' on':'')+'" data-z="'+z.id+'">'+
        '<span class="dot" style="background:'+z.color+'"></span>'+
        '<span class="zn">'+esc(z.name)+'</span>'+
        '<span class="zc">'+(z.tierId?'LINKED':'UNMAPPED')+' · '+fmt(capOf(z))+'</span>'+
        '<button class="del" data-del="'+z.id+'" aria-label="Delete">&times;</button>'+
      '</div>').join('') : '<p class="no-sel">No zones yet.</p>';
  }
  $('zlist').addEventListener('click', e=>{
    const del=e.target.getAttribute('data-del');
    if(del){ zones=zones.filter(z=>z.id!==del); if(sel===del)sel=null; render(); renderEditor(); touch(); return; }
    const item=e.target.closest('.zitem'); if(item) selectZone(item.getAttribute('data-z'));
  });

  function renderSummary(){
    $('s-zones').textContent=zones.length;
    $('s-cap').textContent=fmt(zones.reduce((a,z)=>a+capOf(z),0));
  }

  /* ── sample ── */
  function loadSample(){
    zones=[
      {id:'z'+(nextId++),name:'Golden Circle',type:'ga',x:560,y:150,w:480,h:190,color:COLORS[1],tierId:defaultTierId(),price:180000,cap:2000,rows:10,perRow:20},
      {id:'z'+(nextId++),name:'VIP Tables',type:'table',x:560,y:360,w:480,h:120,color:COLORS[5],tierId:defaultTierId(),price:900000,tables:16,perTable:8},
      {id:'z'+(nextId++),name:'Grandstand A',type:'seated',x:150,y:150,w:360,h:520,color:COLORS[0],tierId:defaultTierId(),price:90000,rows:16,perRow:12},
      {id:'z'+(nextId++),name:'Grandstand B',type:'seated',x:1090,y:150,w:360,h:520,color:COLORS[0],tierId:defaultTierId(),price:90000,rows:16,perRow:12},
      {id:'z'+(nextId++),name:'Lawn GA',type:'ga',x:150,y:700,w:1300,h:150,color:COLORS[4],tierId:defaultTierId(),price:55000,cap:5000,rows:10,perRow:20}
    ];
    zones.forEach(syncPriceFromTier);
    sel=zones[0].id; render(); renderEditor(); touch(); toast('Sample stadium loaded — edit any zone');
  }

  /* ── publish / preview ── */
  function conflictCopy(list){
    const removed=list.every(c=>c.reason==='removed');
    const rowOf=l=>{ const m=/^([A-Z]+)\d+$/.exec(l||''); return m?m[1]:null; };
    const rows=Array.from(new Set(list.map(c=>rowOf(c.label))));
    const head = removed && rows.length===1 && rows[0] ? "Can't remove row "+rows[0]+' yet.' : removed ? "Can't remove those seats yet." : "Can't change those seats yet.";
    const WORD={sold:'sold',held:'held in a checkout',reserved:'reserved',blocked:'blocked'};
    const byState={}; list.forEach(c=>{ (byState[c.state]=byState[c.state]||[]).push(c.label); });
    const join=a=>a.length<=1?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];
    const parts=Object.keys(byState).map(st=>{ const ls=byState[st].slice(0,8); const more=byState[st].length-ls.length; return (byState[st].length===1?'Seat ':'Seats ')+join(ls)+(more>0?' and '+more+' more':'')+(byState[st].length===1?' is ':' are ')+(WORD[st]||st)+'.'; });
    const anyGuests=list.some(c=>c.state==='sold'||c.state==='held');
    const tail = anyGuests ? (removed ? ' Move those guests or keep the row.' : ' Move those guests first.') : ' Release them first, or keep them as they are.';
    return '<strong>'+esc(head)+'</strong> '+esc(parts.join(' ')+tail)+' Your edits are saved; the live map is unchanged.';
  }
  async function publish(){
    if(!zones.length){ toast('Draw at least one zone first'); return; }
    if(EVENT_ID && zones.some(z=>!z.tierId)){ toast('Link every zone to a ticket tier before publishing'); return; }
    const cap=zones.reduce((a,z)=>a+capOf(z),0);
    const btn=$('publish'); btn.disabled=true;
    $('conflict').hidden=true;
    try{
      const body={ space:{w:1600,h:900}, zones };
      if(mapImageUrl) body.mapImageUrl=mapImageUrl;
      const r=await fetch(planApi,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json(); if(!r.ok) throw new Error(d.error||'Publish failed');
      if(!EVENT_ID){ toast('Saved — '+zones.length+' zones, '+fmt(cap)+' seats.'); return; }
      // BS127: turn the saved plan into live seat inventory (versioned).
      const pr=await fetch('/api/org/events/'+encodeURIComponent(EVENT_ID)+'/seatmap/publish',{method:'POST',credentials:'same-origin'});
      const pd=await pr.json().catch(()=>({}));
      if(pr.status===409 && Array.isArray(pd.conflicts)){
        $('conflict').innerHTML=conflictCopy(pd.conflicts); $('conflict').hidden=false; dirty=true; renderVer();
        return;
      }
      if(!pr.ok) throw new Error(pd.error||'Publish failed');
      liveVersion=pd.version||liveVersion; dirty=false; renderVer();
      toast('Published live — version '+liveVersion+', '+fmt(pd.seats||0)+' seats. Buyers see it now.');
      loadSeats();
    }catch(err){ toast('Publish failed: '+(err.message||err)); }
    finally{ btn.disabled=false; }
  }

  /* ── BS127: live seat manager (block / reserve / comps / release) ── */
  let orgSeats=[]; const seatSel=new Set(); let pending=null;
  const STATE_WORD={available:'available',sold:'sold',held:'held in a checkout',reserved:'reserved',blocked:'blocked'};
  async function loadSeats(){
    if(!EVENT_ID) return;
    try{
      const r=await fetch('/api/org/events/'+encodeURIComponent(EVENT_ID)+'/seats',{cache:'no-store',credentials:'same-origin'});
      if(!r.ok) return;
      const d=await r.json();
      orgSeats=Array.isArray(d.seats)?d.seats:[];
      liveVersion=d.version||0; renderVer();
      const c=d.counts||{};
      $('counts').innerHTML = orgSeats.length ?
        ['SOLD:sold','HELD NOW:held','RESERVED:reserved','BLOCKED:blocked'].map(x=>{ const [l,k]=x.split(':'); return '<div><span>'+l+'</span><span>'+fmt(c[k]||0)+'</span></div>'; }).join('')+
        '<div class="tot"><span>AVAILABLE</span><span>'+fmt(c.available||0)+'</span></div>'
        : '<p class="no-sel">Publish the map to see live seats.</p>';
      for(const id of Array.from(seatSel)){ if(!orgSeats.some(s=>s.seatId===id)) seatSel.delete(id); }
      renderSeats();
    }catch(e){ /* keep the last view */ }
  }
  const rowOfSeat=s=>{ if(s.rowLabel) return {r:s.rowLabel,n:s.seatNumber}; const m=/^([A-Z]+)(\d+)$/.exec(s.label||''); return m?{r:m[1],n:+m[2]}:{r:'',n:s.seatNumber}; };
  function renderSeats(){
    const z=zones.find(x=>x.id===sel);
    const card=$('seatcard');
    if(!z || z.type==='ga'){ card.innerHTML='<p class="sc-h">SEATS</p><p class="no-sel" style="color:#4A4A4A">Pick a seated or table zone to manage its seats.</p>'; renderSelTool(); return; }
    const list=orgSeats.filter(s=>s.zoneId===z.id);
    if(!list.length){ card.innerHTML='<p class="sc-h">'+esc(z.name.toUpperCase())+'</p><p class="no-sel" style="color:#4A4A4A">Publish the map to manage this zone\'s seats.</p>'; renderSelTool(); return; }
    const btn=s=>{ const st=s.state; const on=seatSel.has(s.seatId); const rc=rowOfSeat(s);
      const name = s.kind==='table' ? s.label+', seats '+s.seatsCount : (rc.r?'Row '+rc.r+' seat '+rc.n:'Seat '+s.label);
      const mark = on?'✓':st==='reserved'?'R':st==='blocked'?'×':'';
      const lab = s.kind==='table' ? esc((s.label.replace(/^Table\s*/,'T'))+(mark?' '+mark:'')) : mark;
      return '<button type="button" class="sm s-'+st+(s.kind==='table'?' tbl':'')+(on?' sel':'')+'" data-seat="'+esc(s.seatId)+'" aria-pressed="'+on+'" aria-label="'+esc(name+', '+STATE_WORD[st]+(s.reservedNote?' — '+s.reservedNote:''))+'" title="'+esc(s.reservedNote||'')+'">'+lab+'</button>'; };
    let html='<p class="sc-h">'+esc(z.name.toUpperCase())+' · '+(z.type==='table'?(list.length+' TABLES'):(new Set(list.map(s=>rowOfSeat(s).r)).size+' ROWS'))+'</p>';
    if(z.type==='table'){ html+='<div class="sm-tables">'+list.map(btn).join('')+'</div>'; }
    else{
      const rows={}; list.forEach(s=>{ const r=rowOfSeat(s).r; (rows[r]=rows[r]||[]).push(s); });
      Object.keys(rows).sort((a,b)=>a.length-b.length||a.localeCompare(b)).forEach(r=>{
        html+='<div class="sm-row"><span class="sm-rl" aria-hidden="true">'+esc(r)+'</span>'+rows[r].sort((a,b)=>(rowOfSeat(a).n||0)-(rowOfSeat(b).n||0)).map(btn).join('')+'</div>';
      });
    }
    card.innerHTML=html;
    renderSelTool();
  }
  // onclick (not addEventListener): idempotent if the script is mounted twice
  $('seatcard').onclick=(e=>{
    const b=e.target.closest('[data-seat]'); if(!b) return;
    const id=b.getAttribute('data-seat');
    if(seatSel.has(id)) seatSel.delete(id); else seatSel.add(id);
    closeForm(); renderSeats();
  });
  function selSeats(){ return orgSeats.filter(s=>seatSel.has(s.seatId)); }
  function selSummary(list){
    const n=list.length; if(!n) return '';
    const noun=list.every(s=>s.kind==='table')?(n===1?'TABLE':'TABLES'):(n===1?'SEAT':'SEATS');
    const rows=Array.from(new Set(list.map(s=>rowOfSeat(s).r)));
    let where='';
    if(list.every(s=>s.kind==='table')) where=list.map(s=>s.label.replace(/^Table\s*/,'T')).join(', ');
    else if(rows.length===1 && rows[0]){
      const nums=list.map(s=>rowOfSeat(s).n).sort((a,b)=>a-b);
      const contiguous=nums.every((v,i)=>i===0||v===nums[i-1]+1);
      where='ROW '+rows[0]+' '+(contiguous&&nums.length>1?nums[0]+'–'+nums[nums.length-1]:nums.join(', '));
    } else where=list.slice(0,6).map(s=>s.label).join(', ')+(n>6?' …':'');
    return n+' '+noun+' SELECTED · '+where;
  }
  function renderSelTool(){
    const list=selSeats();
    $('seltool').hidden=!list.length;
    if(!list.length){ closeForm(); return; }
    $('st-sum').textContent=selSummary(list);
    const allFree=list.every(s=>s.state==='available');
    const allHeld=list.every(s=>s.state==='blocked'||s.state==='reserved');
    const compable=list.every(s=>s.state==='available'||s.state==='blocked'||s.state==='reserved') && new Set(list.map(s=>s.tierId)).size===1 && !!list[0].tierId;
    $('a-block').disabled=!allFree; $('a-reserve').disabled=!allFree; $('a-release').disabled=!allHeld; $('a-comp').disabled=!compable;
    $('a-block').title=allFree?'':'Only available seats can be blocked';
    $('a-release').title=allHeld?'':'Only blocked or reserved seats can be released';
    $('a-comp').title=compable?'':'Comps need free, blocked or reserved seats of one pass type';
  }
  function closeForm(){ pending=null; $('actform').hidden=true; $('actform').innerHTML=''; }
  function openForm(kind){
    pending=kind; const f=$('actform'); f.hidden=false;
    if(kind==='reserve'){
      f.innerHTML='<span class="af-lab">Reserve for…</span><input class="in" id="af-note" maxlength="200" placeholder="Who is it for? e.g. Sponsor table" aria-label="Who the seats are reserved for"><button class="btn" id="af-go">RESERVE</button><button class="btn sec" id="af-x">CANCEL</button>';
    } else {
      f.innerHTML='<span class="af-lab">Give as comps — each pass names its seat</span><input class="in" id="af-name" placeholder="Guest name" aria-label="Guest name"><input class="in" id="af-phone" inputmode="tel" placeholder="+255 7XX XXX XXX" aria-label="Phone"><input class="in" id="af-email" type="email" placeholder="Email (optional)" aria-label="Email"><button class="btn" id="af-go">SEND COMPS</button><button class="btn sec" id="af-x">CANCEL</button>';
    }
    $('af-x').onclick=closeForm; $('af-go').onclick=()=>kind==='reserve'?doAction('reserve'):doComp();
    const first=f.querySelector('input'); if(first) first.focus();
  }
  async function doAction(action){
    const ids=Array.from(seatSel); if(!ids.length) return;
    const note=action==='reserve'&&$('af-note')?$('af-note').value.trim():'';
    try{
      const r=await fetch('/api/org/events/'+encodeURIComponent(EVENT_ID)+'/seats/actions',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,seatIds:ids,note:note||undefined})});
      const d=await r.json().catch(()=>({}));
      if(r.status===409 && d.error==='seat_state'){ toast('Not done — '+(d.seats||[]).slice(0,4).map(s=>s.label+' is '+(STATE_WORD[s.state]||s.state)).join(', ')); await loadSeats(); return; }
      if(r.status===409 && d.error==='no_capacity'){ toast('Not done — that pass type has no free capacity left to hold back'); return; }
      if(!r.ok) throw new Error(d.error||'failed');
      toast((action==='block'?'Blocked ':action==='reserve'?'Reserved ':'Released ')+ids.length+(ids.length===1?' seat':' seats'));
      seatSel.clear(); closeForm(); await loadSeats();
    }catch(err){ toast('Could not update seats: '+(err.message||err)); }
  }
  async function doComp(){
    const list=selSeats(); if(!list.length) return;
    const name=$('af-name').value.trim(), phone=$('af-phone').value.trim(), email=$('af-email').value.trim();
    if(!name){ toast('Enter the guest name'); return; }
    if(!phone&&!email){ toast('Enter a phone or an email'); return; }
    try{
      const r=await fetch('/api/org/comps',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,phone:phone||undefined,email:email||undefined,eventId:EVENT_ID,tier:list[0].tierId,seatIds:list.map(s=>s.seatId)})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){ toast(d.message||'Could not send comps'); await loadSeats(); return; }
      toast('Comps sent to '+name+' — '+list.length+(list.length===1?' seat':' seats'));
      seatSel.clear(); closeForm(); await loadSeats();
    }catch(err){ toast('Could not send comps: '+(err.message||err)); }
  }
  $('a-block').onclick=()=>doAction('block');
  $('a-release').onclick=()=>doAction('release');
  $('a-reserve').onclick=()=>openForm('reserve');
  $('a-comp').onclick=()=>openForm('comp');
  function openBuyer(){
    if(!EVENT_ID){ toast('Open this builder from a saved event to preview the buyer seat map'); return; }
    location.href = buyerHref;
  }
  function loadPlan(plan){
    if(plan && plan.mapImageUrl){ mapImageUrl=plan.mapImageUrl; showMap(mapImageUrl); }
    if(!plan || !Array.isArray(plan.zones)) return;
    // the API normalises GA capacity to capacity; the builder edits cap (legacy key)
    zones = plan.zones.map((z, i) => ({...z, id:z.id||('z'+(i+1)), color:z.color||COLORS[i%COLORS.length], cap:Number(z.cap ?? z.capacity ?? 0), price:Number(z.price ?? 0)}));
    zones.forEach(syncPriceFromTier);
    nextId = zones.reduce((max,z)=>Math.max(max, Number(String(z.id||'').replace(/^z/,''))||0), 0) + 1;
    sel = zones[0]?.id || null;
    render(); renderEditor();
  }
  async function bootEventContext(){
    if(!EVENT_ID){ render(); return; }
    try{
      const [evRes, planRes] = await Promise.all([
        fetch('/api/events/' + encodeURIComponent(EVENT_ID), {cache:'no-store'}),
        fetch(planApi, {cache:'no-store'})
      ]);
      if(evRes.ok){
        const ev = await evRes.json();
        tiers = Array.isArray(ev.webCheckout?.tiers) ? ev.webCheckout.tiers.filter(t => t && t.tierId && !t.disabled) : [];
        if(ev.name) document.querySelector('.zora-seatbuilder .title').textContent = 'FLOOR PLAN · ' + ev.name.toUpperCase();
      }
      if(planRes.ok){
        const plan = await planRes.json();
        if(plan && Array.isArray(plan.zones) && plan.zones.length) loadPlan(plan);
      }
    }catch(e){ /* builder still works offline */ }
    render(); renderEditor();
    await loadSeats();
    // held seats come and go with checkouts — refresh while the tab is visible
    setInterval(()=>{ if(!document.hidden && !pending) loadSeats(); }, 15000);
  }
  $('publish').onclick=publish; $('publish2').onclick=publish;
  $('preview').onclick=openBuyer; $('preview2').onclick=openBuyer;

  bootEventContext();
`;

export default function FloorPlanBuilderPage() {
  // BS75 — the org store label in the CrShell top bar (/api/org/me → { name }),
  // matching the overview/sales/editor pattern. Never hardcode a name.
  const [orgName, setOrgName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/org/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.name === 'string') setOrgName(d.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // BS127: the markup is written into the host imperatively (React never owns
  // its children), then the script binds to it. With dangerouslySetInnerHTML the
  // nodes the script bound to could be swapped by a later React pass, leaving
  // every button and the canvas unbound. Runs once per host.
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current as (HTMLDivElement & { __zsb?: boolean }) | null;
    if (!host || host.__zsb) return;
    host.__zsb = true;
    host.innerHTML = MARKUP;
    try {
      // eslint-disable-next-line no-new-func
      new Function(SCRIPT)();
    } catch (e) {
      console.error('[floor-plan] script error', e);
    }
  }, []);

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
      topbarTitle="Floor plan"
      topbarExtra={
        <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>{orgName || ' '}</span>
      }
      footer={
        <>
          <a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORAPASS.COM</a>
        </>
      }
    >
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="zora-seatbuilder" ref={hostRef} />
    </CrShell>
  );
}
