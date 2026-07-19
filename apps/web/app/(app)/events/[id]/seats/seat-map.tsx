'use client';

import { useEffect, useRef } from 'react';

/* Buyer seat-selection map. Ported from the legacy public/seatmap.html (now
   deleted): same interactive SVG floor plan, pan/zoom, GA / seated / table
   selection, cart + bill-split. Two changes from the static page:
     • it reads the EVENT-SCOPED plan  (/api/events/:id/floorplan)  not the
       global /api/floorplan, and
     • the event title/meta come from  /api/events/:id  instead of ?ev=NAME.
   The imperative renderer is kept verbatim inside an effect (operating on the
   mounted markup) rather than rewritten in React — lowest-risk lift-and-shift. */

// Styles scoped under #smroot; the immersive venue view is theme-aware via the
// shared --c-* tokens, with the map-specific state colors kept local.
const STYLE = `
#smroot{
  --black:var(--c-bg); --ink:var(--c-surface); --ink2:var(--c-surface2);
  --hair:var(--c-line); --hair2:var(--c-line2);
  --bone:var(--c-text); --mut:var(--c-text2); --mut2:var(--c-text2);
  --blue:var(--c-blue); --green:#3FB950; --grey:#3A3A40; --amber:#E3A008;
  --gold:#B98A2E; --teal:#2FA9A0;
  --sans:'Archivo',system-ui,sans-serif; --mono:'IBM Plex Mono',monospace;
  position:fixed; inset:0; background:var(--black); color:var(--bone);
  font-family:var(--sans); font-size:15px; -webkit-font-smoothing:antialiased;
  display:flex; flex-direction:column; overflow:hidden;
}
#smroot *{margin:0;padding:0;box-sizing:border-box}
#smroot a{color:inherit;text-decoration:none}
#smroot .mono{font-family:var(--mono)}
#smroot button{font-family:inherit}
#smroot .top{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--hair);flex-shrink:0}
#smroot .top .back{width:38px;height:38px;border:1px solid var(--hair2);border-radius:10px;background:none;color:var(--bone);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#smroot .top .back:hover{border-color:var(--blue)}
#smroot .top .ev{min-width:0}
#smroot .top .ev .t{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#smroot .top .ev .m{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.03em;margin-top:2px}
#smroot .top .badge{margin-left:auto;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;color:var(--blue);border:1px solid var(--blue);border-radius:99px;padding:5px 10px;flex-shrink:0}
#smroot .crumb{display:flex;align-items:center;gap:8px;padding:10px 16px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--mut);border-bottom:1px solid var(--hair);flex-shrink:0}
#smroot .crumb b{color:var(--bone);font-weight:500}
#smroot .crumb .sep{color:var(--hair2)}
#smroot .crumb .zback{margin-left:auto;color:var(--blue);cursor:pointer;display:none}
#smroot .crumb .zback.on{display:inline}
#smroot .stage-wrap{position:relative;flex:1;min-height:0;overflow:hidden;background:radial-gradient(120% 90% at 50% 0%,#141726,#0A0A0B 70%);touch-action:none}
#smroot #map{width:100%;height:100%;display:block;cursor:grab}
#smroot #map.grab{cursor:grabbing}
#smroot text{font-family:var(--mono);fill:var(--bone);user-select:none}
#smroot .zoom{position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column;gap:8px;z-index:5}
#smroot .zoom button{width:42px;height:42px;border-radius:12px;border:1px solid var(--hair2);background:rgba(16,16,18,.85);backdrop-filter:blur(6px);color:var(--bone);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center}
#smroot .zoom button:hover{border-color:var(--blue);color:var(--blue)}
#smroot .zoom button.rst{font-size:15px}
#smroot .legend{position:absolute;left:14px;top:14px;display:flex;flex-wrap:wrap;gap:10px 14px;max-width:calc(100% - 90px);background:rgba(16,16,18,.8);backdrop-filter:blur(6px);border:1px solid var(--hair);border-radius:12px;padding:10px 13px;z-index:5}
#smroot .legend span{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;letter-spacing:.04em;color:var(--mut2)}
#smroot .legend i{width:11px;height:11px;border-radius:50%;display:inline-block}
#smroot .hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.06em;background:rgba(16,16,18,.8);border:1px solid var(--hair);border-radius:99px;padding:8px 15px;z-index:5;pointer-events:none;transition:opacity .4s}
#smroot .hint.gone{opacity:0}
#smroot .cartbar{flex-shrink:0;border-top:1px solid var(--hair);background:var(--ink);padding:12px 16px;display:flex;align-items:center;gap:14px}
#smroot .cartbar .sum{min-width:0}
#smroot .cartbar .sum .c{font-weight:600;font-size:15px}
#smroot .cartbar .sum .c .hold{font-family:var(--mono);font-size:11px;color:var(--amber);margin-left:8px}
#smroot .cartbar .sum .p{font-family:var(--mono);font-size:12px;color:var(--mut);letter-spacing:.03em;margin-top:2px}
#smroot .cartbar .rev{margin-left:auto;background:var(--blue);color:#fff;border:none;border-radius:12px;font-family:var(--mono);font-size:12px;font-weight:500;letter-spacing:.1em;padding:14px 24px;cursor:pointer;transition:background .2s;white-space:nowrap}
#smroot .cartbar .rev:hover{background:var(--bone);color:var(--black)}
#smroot .cartbar .rev:disabled{opacity:.4;cursor:not-allowed}
#smroot .cartbar .rev:disabled:hover{background:var(--blue);color:#fff}
#smroot .sheet{position:fixed;inset:0;background:rgba(5,5,6,.6);backdrop-filter:blur(4px);display:none;align-items:flex-end;justify-content:center;z-index:40}
#smroot .sheet.on{display:flex}
@media(min-width:620px){#smroot .sheet{align-items:center}}
#smroot .card{background:var(--ink);border:1px solid var(--hair2);width:100%;max-width:440px;border-radius:20px 20px 0 0;overflow:hidden}
@media(min-width:620px){#smroot .card{border-radius:18px}}
#smroot .card-h{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--hair)}
#smroot .card-h .t{font-weight:600;font-size:16px}
#smroot .card-h .x{background:none;border:none;color:var(--mut);font-size:22px;cursor:pointer;line-height:1}
#smroot .card-b{padding:20px}
#smroot .ga-price{font-family:var(--mono);font-size:13px;color:var(--mut2)}
#smroot .ga-price b{color:var(--bone);font-weight:500;font-size:18px}
#smroot .stepper{display:flex;align-items:center;justify-content:space-between;margin:22px 0}
#smroot .stepper .lab{font-size:14px}
#smroot .stepper .ctrl{display:flex;align-items:center;gap:18px}
#smroot .stepper button{width:40px;height:40px;border-radius:50%;border:1px solid var(--hair2);background:none;color:var(--bone);font-size:20px;cursor:pointer}
#smroot .stepper button:hover{border-color:var(--bone)}
#smroot .stepper .n{font-family:var(--mono);font-size:20px;min-width:26px;text-align:center}
#smroot .addbtn{width:100%;background:var(--blue);color:#fff;border:none;border-radius:12px;font-family:var(--mono);font-size:12.5px;font-weight:500;letter-spacing:.1em;padding:15px;cursor:pointer}
#smroot .addbtn:hover{background:var(--bone);color:var(--black)}
#smroot .line{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--hair)}
#smroot .line .l .n{font-weight:500;font-size:14px}
#smroot .line .l .d{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:3px}
#smroot .line .r{display:flex;align-items:center;gap:12px}
#smroot .line .r .pr{font-family:var(--mono);font-size:13px}
#smroot .line .rm{background:none;border:none;color:var(--mut);cursor:pointer;font-size:16px}
#smroot .line .rm:hover{color:var(--amber)}
#smroot .empty{text-align:center;color:var(--mut);font-family:var(--mono);font-size:12px;padding:30px 0}
#smroot .totrow{display:flex;justify-content:space-between;align-items:baseline;padding-top:16px;margin-top:6px}
#smroot .totrow .tl{font-size:15px}
#smroot .totrow .tv{font-family:var(--mono);font-size:24px;font-weight:500}
#smroot .nofee{font-family:var(--mono);font-size:10.5px;color:var(--mut);text-align:center;margin:12px 0 0;letter-spacing:.04em}
#smroot .nofee b{color:var(--bone);font-weight:500}
#smroot .split-switch{width:44px;height:26px;border-radius:99px;background:var(--hair);position:relative;flex-shrink:0;transition:background .2s;cursor:pointer}
#smroot .split-switch.on{background:var(--blue)}
#smroot .split-switch::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s}
#smroot .split-switch.on::after{transform:translateX(18px)}
#smroot .sp-btn{width:34px;height:34px;border-radius:50%;border:1px solid var(--hair2);background:none;color:var(--bone);font-size:18px;cursor:pointer}
#smroot .sp-btn:hover{border-color:var(--blue);color:var(--blue)}
#smroot .pay{width:100%;background:var(--blue);color:#fff;border:none;border-radius:12px;font-family:var(--mono);font-size:13px;font-weight:500;letter-spacing:.12em;padding:16px;cursor:pointer;margin-top:16px}
#smroot .pay:hover{background:var(--bone);color:var(--black)}
#smroot .done{text-align:center;padding:30px 24px}
#smroot .done .tick{width:56px;height:56px;border-radius:50%;border:2px solid var(--blue);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 20px}
#smroot .done h3{font-size:21px;font-weight:600}
#smroot .done p{font-family:var(--mono);font-size:12px;color:var(--mut);letter-spacing:.04em;line-height:1.8;margin-top:14px}
#smroot .done p b{color:var(--bone);font-weight:500}
#smroot .toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:var(--bone);color:var(--black);font-family:var(--mono);font-size:12px;letter-spacing:.06em;padding:11px 20px;border-radius:99px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:60;text-align:center;max-width:90vw}
#smroot .toast.show{opacity:1}
`;

const BODY = `
<div class="top">
  <button class="back" id="back" aria-label="Back">&larr;</button>
  <div class="ev">
    <p class="t" id="ev-title">Loading…</p>
    <p class="m" id="ev-meta"></p>
  </div>
  <span class="badge">SEATED EVENT</span>
</div>
<div class="crumb">
  <b id="cr-venue">Venue</b>
  <span class="sep" id="cr-sep" style="display:none">▸</span>
  <b id="cr-zone" style="display:none"></b>
  <span class="zback" id="zback">&larr; whole venue</span>
</div>
<div class="stage-wrap">
  <svg id="map" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"></svg>
  <div class="legend" id="legend">
    <span><i style="background:var(--green)"></i>Available</span>
    <span><i style="background:var(--grey)"></i>Reserved</span>
    <span><i style="background:var(--amber)"></i>In a cart</span>
    <span><i style="background:var(--blue)"></i>Yours</span>
  </div>
  <div class="zoom">
    <button id="zin" aria-label="Zoom in">+</button>
    <button id="zout" aria-label="Zoom out">&minus;</button>
    <button id="zrst" class="rst" aria-label="Reset">fit</button>
  </div>
  <p class="hint" id="hint">Pinch or scroll to zoom · drag to pan · tap a section</p>
</div>
<div class="cartbar">
  <div class="sum">
    <p class="c"><span id="cart-count">0 tickets</span><span class="hold" id="hold"></span></p>
    <p class="p" id="cart-total">Nothing selected yet</p>
  </div>
  <button class="rev" id="review" disabled>REVIEW</button>
</div>
<div class="sheet" id="ga-sheet">
  <div class="card">
    <div class="card-h"><span class="t" id="ga-name">Golden Circle</span><button class="x" id="ga-x">&times;</button></div>
    <div class="card-b">
      <p class="ga-price">Standing · from <b id="ga-price">180,000 TZS</b> <span id="ga-left" style="color:var(--mut)"></span></p>
      <div class="stepper">
        <span class="lab">Tickets</span>
        <div class="ctrl"><button id="ga-minus">&minus;</button><span class="n" id="ga-n">1</span><button id="ga-plus">+</button></div>
      </div>
      <button class="addbtn" id="ga-add">ADD TO CART</button>
    </div>
  </div>
</div>
<div class="sheet" id="rev-sheet">
  <div class="card">
    <div class="card-h"><span class="t">Your selection</span><button class="x" id="rev-x">&times;</button></div>
    <div class="card-b">
      <div id="rev-list"></div>
      <div class="totrow"><span class="tl">Total</span><span class="tv" id="rev-total">0 TZS</span></div>
      <div id="split-block" style="display:none;margin-top:16px;border-top:1px solid var(--hair);padding-top:16px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="flex:1;font-size:14px">Split the bill with friends?<br><span style="font-family:var(--mono);font-size:10px;color:var(--mut);letter-spacing:.03em">Everyone pays their own share. Your table is held until all pay.</span></span>
          <span class="split-switch" id="split-switch"></span>
        </div>
        <div id="split-panel" style="display:none;margin-top:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <span style="font-size:13px">Split between</span>
            <div style="display:flex;align-items:center;gap:14px">
              <button class="sp-btn" id="split-minus">&minus;</button>
              <span class="mono" id="split-n" style="font-size:16px;min-width:78px;text-align:center">2 people</span>
              <button class="sp-btn" id="split-plus">+</button>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;background:var(--ink);border:1px solid var(--hair);border-radius:10px;padding:14px 16px">
            <span style="font-family:var(--mono);font-size:10.5px;color:var(--mut);letter-spacing:.1em">YOUR SHARE NOW</span>
            <span class="mono" id="split-share" style="font-size:20px;font-weight:500;color:var(--blue)">—</span>
          </div>
          <p style="font-family:var(--mono);font-size:10px;color:var(--mut);letter-spacing:.03em;margin-top:10px;line-height:1.7">Invites go out by WhatsApp / SMS. Each friend pays their share in the app; the table locks the moment everyone has paid.</p>
        </div>
      </div>
      <p class="nofee">The price is the price. <b>No fees at checkout.</b></p>
      <button class="pay" id="rev-pay">LOCK SEATS &amp; CHECKOUT</button>
    </div>
  </div>
</div>
<div class="sheet" id="done-sheet">
  <div class="card">
    <div class="done">
      <div class="tick">&checkmark;</div>
      <h3>Seats locked.</h3>
      <p id="done-list"></p>
      <p>Your passes are <b>waiting in the Zora app</b>.<br>Nobody else can take these seats now.</p>
      <button class="pay" id="done-close" style="max-width:260px;margin:22px auto 0">DONE</button>
    </div>
  </div>
</div>
<p class="toast" id="toast"></p>
`;

function initSeatMap(host: HTMLElement, eventId: string): () => void {
  const $ = (id: string) => host.querySelector('#' + id) as any;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const money = (n: number) => fmt(n) + ' TZS';
  function toast(m: string) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }

  const STAGE: any = { x: 360, y: 34, w: 280, h: 46 };
  let ZONES: any[] = [
    { id: 'gc', name: 'Golden Circle', type: 'ga', x: 360, y: 104, w: 280, h: 120, color: '#2FA9A0', price: 180000, cap: 2000, sold: 1460 },
    { id: 'vip', name: 'VIP Tables', type: 'table', x: 360, y: 238, w: 280, h: 86, color: '#D4537E', price: 900000, tables: 16, perTable: 8 },
    { id: 'c', name: 'Lower Bowl C', type: 'seated', x: 360, y: 338, w: 280, h: 150, color: '#7A5AF8', price: 120000, rows: 9, perRow: 26 },
    { id: 'a', name: 'Grandstand A', type: 'seated', x: 120, y: 104, w: 210, h: 384, color: '#3D5AFE', price: 90000, rows: 16, perRow: 12 },
    { id: 'b', name: 'Grandstand B', type: 'seated', x: 670, y: 104, w: 210, h: 384, color: '#3D5AFE', price: 90000, rows: 16, perRow: 12 },
    { id: 'lawn', name: 'Lawn GA', type: 'ga', x: 120, y: 506, w: 760, h: 120, color: '#639922', price: 55000, cap: 5000, sold: 2240 },
  ];
  const ROWLABEL = (i: number) => String.fromCharCode(65 + i);
  function rng(seed: number) { return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }
  function genSeats(z: any) {
    if (z.seats) return z.seats;
    const r = rng(z.id.charCodeAt(0) * 97 + z.rows);
    const seats: any[] = [];
    for (let row = 0; row < z.rows; row++) for (let col = 0; col < z.perRow; col++) {
      const roll = r();
      let st = 'avail';
      if (roll > 0.82) st = 'reserved';
      else if (roll > 0.74) st = 'held';
      seats.push({ id: z.id + '-' + ROWLABEL(row) + (col + 1), label: ROWLABEL(row) + (col + 1), row, col, state: st });
    }
    z.seats = seats; return seats;
  }
  function genTables(z: any) {
    if (z.tablesArr) return z.tablesArr;
    const r = rng(z.id.charCodeAt(0) * 131 + z.tables);
    const arr: any[] = [];
    for (let i = 0; i < z.tables; i++) {
      const roll = r(); let st = 'avail';
      if (roll > 0.85) st = 'reserved'; else if (roll > 0.78) st = 'held';
      arr.push({ id: z.id + '-T' + (i + 1), num: i + 1, state: st });
    }
    z.tablesArr = arr; return arr;
  }
  function zoneAvailPct(z: any) {
    if (z.type === 'ga') return Math.round((z.cap - z.sold) / z.cap * 100);
    if (z.type === 'table') { const a = genTables(z); return Math.round(a.filter((x: any) => x.state === 'avail').length / a.length * 100); }
    const s = genSeats(z); return Math.round(s.filter((x: any) => x.state === 'avail').length / s.length * 100);
  }

  const cart: any = { seats: [], ga: {}, tables: [] };
  function cartCount() { return cart.seats.length + (Object.values(cart.ga) as any[]).reduce((a, g) => a + g.qty, 0) + cart.tables.length; }
  function cartTotal() { return cart.seats.reduce((a: number, s: any) => a + s.price, 0) + (Object.values(cart.ga) as any[]).reduce((a, g) => a + g.qty * g.price, 0) + cart.tables.reduce((a: number, t: any) => a + t.price, 0); }
  function updateCartBar() {
    const n = cartCount();
    const noun = cart.tables.length ? 'item' : 'ticket';
    $('cart-count').textContent = n + ' ' + noun + (n === 1 ? '' : 's');
    $('cart-total').textContent = n ? money(cartTotal()) : 'Nothing selected yet';
    $('review').disabled = n === 0;
    if (n > 0) startHold(); else stopHold();
  }

  let holdT: any = null, holdLeft = 0;
  function startHold() { if (holdT) return; holdLeft = 8 * 60; tickHold(); holdT = setInterval(tickHold, 1000); }
  function tickHold() {
    if (holdLeft <= 0) { stopHold(); cart.seats = []; cart.ga = {}; cart.tables = []; updateCartBar(); redraw(); toast('Hold expired — selection released'); return; }
    const m = Math.floor(holdLeft / 60), s = holdLeft % 60;
    $('hold').textContent = '· held ' + m + ':' + String(s).padStart(2, '0');
    holdLeft--;
  }
  function stopHold() { if (holdT) { clearInterval(holdT); holdT = null; } $('hold').textContent = ''; }

  const svg = $('map');
  const vb = { x: 0, y: 0, w: 1000, h: 700 };
  let mode = 'overview', curZone: any = null;
  const VENUE: any = { boundsFit: { x: 100, y: 20, w: 800, h: 620 } };
  function aspect() { const r = svg.getBoundingClientRect(); return r.width / r.height || 1.4; }
  function setVB() { vb.w = Math.max(vb.w, 1); vb.h = vb.w / aspect(); svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h); }
  function fit(b: any, pad?: number) {
    pad = pad || 40;
    const a = aspect();
    let w = (b.w + pad * 2), h = (b.h + pad * 2);
    if (w / h < a) w = h * a; else h = w / a;
    vb.w = w; vb.h = h;
    vb.x = b.x - (w - b.w) / 2; vb.y = b.y - (h - b.h) / 2;
    svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  }
  function screenToSvg(cx: number, cy: number) { const r = svg.getBoundingClientRect(); return { x: vb.x + (cx - r.left) / r.width * vb.w, y: vb.y + (cy - r.top) / r.height * vb.h }; }
  const MINW = 90, MAXW = 2400;
  function zoomAt(cx: number, cy: number, f: number) {
    const p = screenToSvg(cx, cy);
    let nw = vb.w * f; nw = Math.max(MINW, Math.min(MAXW, nw));
    f = nw / vb.w;
    vb.x = p.x - (p.x - vb.x) * f; vb.y = p.y - (p.y - vb.y) * f; vb.w = nw; vb.h = vb.w / aspect();
    svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag: string, attrs: any, txt?: any) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (txt != null) e.textContent = txt; return e; }
  function clear() { while (svg.firstChild) svg.removeChild(svg.firstChild); }

  function transformZone(z: any) {
    const b: any = { id: z.id, name: z.name || 'Zone', type: z.type || 'seated', x: +z.x || 0, y: +z.y || 0, w: +z.w || 100, h: +z.h || 100, color: z.color || '#3D5AFE', price: +z.price || 0 };
    if (z.type === 'ga') return Object.assign(b, { cap: Math.max(0, +z.cap || 0), sold: 0 });
    if (z.type === 'table') return Object.assign(b, { tables: Math.max(1, +z.tables || 1), perTable: Math.max(1, +z.perTable || 1) });
    return Object.assign(b, { rows: Math.max(1, +z.rows || 1), perRow: Math.max(1, +z.perRow || 1) });
  }
  function loadPlan(plan: any) {
    ZONES.length = 0;
    (plan.zones || []).forEach((z: any) => ZONES.push(transformZone(z)));
    if (!ZONES.length) return false;
    const minx = Math.min(...ZONES.map((z) => z.x)), miny = Math.min(...ZONES.map((z) => z.y));
    const maxx = Math.max(...ZONES.map((z) => z.x + z.w)), maxy = Math.max(...ZONES.map((z) => z.y + z.h));
    STAGE.w = (maxx - minx) * 0.34; STAGE.h = 42; STAGE.x = minx + ((maxx - minx) - STAGE.w) / 2; STAGE.y = miny - 62;
    VENUE.boundsFit = { x: minx - 30, y: STAGE.y - 10, w: (maxx - minx) + 60, h: (maxy - STAGE.y) + 30 };
    return true;
  }

  function renderOverview() {
    mode = 'overview'; curZone = null; clear();
    $('cr-sep').style.display = 'none'; $('cr-zone').style.display = 'none'; $('zback').classList.remove('on');
    svg.appendChild(el('rect', { x: STAGE.x, y: STAGE.y, width: STAGE.w, height: STAGE.h, rx: 8, fill: '#1a1a1f', stroke: '#33333A' }));
    svg.appendChild(el('text', { x: STAGE.x + STAGE.w / 2, y: STAGE.y + STAGE.h / 2 + 4, 'text-anchor': 'middle', 'font-size': 16, 'letter-spacing': 4, fill: '#B4B1A8' }, 'S T A G E'));
    ZONES.forEach((z) => {
      const g = el('g', { class: 'zone', 'data-zone': z.id, style: 'cursor:pointer' });
      const pct = zoneAvailPct(z);
      const dim = pct <= 0;
      g.appendChild(el('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 12, fill: z.color, 'fill-opacity': dim ? 0.16 : 0.30, stroke: z.color, 'stroke-opacity': dim ? 0.4 : 0.9, 'stroke-width': 2 }));
      g.appendChild(el('text', { x: z.x + z.w / 2, y: z.y + z.h / 2 - 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 600, fill: '#F4F1EA' }, z.name));
      const sub = z.type === 'ga' ? (dim ? 'SOLD OUT' : 'STANDING · from ' + money(z.price))
        : z.type === 'table' ? (dim ? 'SOLD OUT' : genTables(z).filter((t: any) => t.state === 'avail').length + ' of ' + z.tables + ' tables open · from ' + money(z.price))
          : (dim ? 'SOLD OUT' : pct + '% seats open · from ' + money(z.price));
      g.appendChild(el('text', { x: z.x + z.w / 2, y: z.y + z.h / 2 + 16, 'text-anchor': 'middle', 'font-size': 11.5, 'letter-spacing': .5, fill: '#B4B1A8' }, sub));
      if (!dim && z.type !== 'ga') g.appendChild(el('text', { x: z.x + z.w / 2, y: z.y + z.h - 14, 'text-anchor': 'middle', 'font-size': 10, 'letter-spacing': 1.5, fill: '#8A877E' }, z.type === 'table' ? 'TAP TO PICK A TABLE' : 'TAP TO PICK SEATS'));
      svg.appendChild(g);
    });
    fit(VENUE.boundsFit);
  }

  function renderSection(z: any) {
    mode = 'section'; curZone = z; clear();
    $('cr-sep').style.display = 'inline'; $('cr-zone').style.display = 'inline'; $('cr-zone').textContent = z.name; $('zback').classList.add('on');
    const seats = genSeats(z);
    const STEP = 26, R = 9;
    svg.appendChild(el('text', { x: (z.perRow * STEP) / 2 - STEP / 2, y: -26, 'text-anchor': 'middle', 'font-size': 13, 'letter-spacing': 3, fill: '#8A877E' }, '▲  TOWARD STAGE'));
    seats.forEach((s: any) => {
      const cx = s.col * STEP, cy = s.row * STEP;
      const fill = s.state === 'avail' ? '#3FB950' : s.state === 'reserved' ? '#3A3A40' : s.state === 'held' ? '#E3A008' : '#3D5AFE';
      const c = el('circle', { cx, cy, r: R, fill, 'data-seat': s.id, style: 'cursor:pointer' });
      if (s.state === 'selected') { c.setAttribute('stroke', '#F4F1EA'); c.setAttribute('stroke-width', '2'); }
      svg.appendChild(c);
    });
    for (let row = 0; row < z.rows; row++) {
      svg.appendChild(el('text', { x: -22, y: row * STEP + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#8A877E' }, ROWLABEL(row)));
    }
    const w = (z.perRow - 1) * STEP, h = (z.rows - 1) * STEP;
    fit({ x: -40, y: -40, w: w + 70, h: h + 70 }, 24);
  }
  function renderTables(z: any) {
    mode = 'tables'; curZone = z; clear();
    $('cr-sep').style.display = 'inline'; $('cr-zone').style.display = 'inline'; $('cr-zone').textContent = z.name; $('zback').classList.add('on');
    const tables = genTables(z);
    const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(tables.length * 1.4))));
    const STEP = 90, R = 30;
    svg.appendChild(el('text', { x: (cols - 1) * STEP / 2, y: -52, 'text-anchor': 'middle', 'font-size': 13, 'letter-spacing': 3, fill: '#8A877E' }, '▲  TOWARD STAGE'));
    tables.forEach((t: any, i: number) => {
      const col = i % cols, row = Math.floor(i / cols), cx = col * STEP, cy = row * STEP;
      const fill = t.state === 'avail' ? '#3FB950' : t.state === 'reserved' ? '#3A3A40' : t.state === 'held' ? '#E3A008' : '#3D5AFE';
      const g = el('g', { 'data-table': t.id, style: 'cursor:pointer' });
      g.appendChild(el('circle', { cx, cy, r: R, fill, 'fill-opacity': t.state === 'selected' ? 0.5 : 0.2, stroke: fill, 'stroke-width': t.state === 'selected' ? 4 : 2 }));
      g.appendChild(el('text', { x: cx, y: cy - 1, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 600, fill: '#F4F1EA' }, 'T' + t.num));
      g.appendChild(el('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#B4B1A8' }, 'seats ' + z.perTable));
      svg.appendChild(g);
    });
    const w = (cols - 1) * STEP, h = (Math.ceil(tables.length / cols) - 1) * STEP;
    fit({ x: -R - 24, y: -R - 34, w: w + 2 * R + 48, h: h + 2 * R + 58 }, 24);
  }
  function redraw() { if (mode === 'overview') renderOverview(); else if (mode === 'tables' && curZone) renderTables(curZone); else if (curZone) renderSection(curZone); }

  let dragged = false;
  function handleTap(cx: number, cy: number) {
    const t = document.elementFromPoint(cx, cy) as any;
    if (!t || !t.closest) return;
    if (mode === 'overview') {
      const zoneEl = t.closest('.zone');
      if (!zoneEl) return;
      const z = ZONES.find((x) => x.id === zoneEl.getAttribute('data-zone'));
      if (!z) return;
      if (zoneAvailPct(z) <= 0) { toast(z.name + ' is sold out'); return; }
      if (z.type === 'ga') openGA(z); else if (z.type === 'table') renderTables(z); else renderSection(z);
    } else if (mode === 'section') {
      const seatEl = t.closest('[data-seat]');
      if (seatEl) toggleSeat(seatEl.getAttribute('data-seat'));
    } else if (mode === 'tables') {
      const tblEl = t.closest('[data-table]');
      if (tblEl) toggleTable(tblEl.getAttribute('data-table'));
    }
  }

  function toggleSeat(id: string) {
    const z = curZone, s = z.seats.find((x: any) => x.id === id); if (!s) return;
    if (s.state === 'reserved') { toast('That seat is taken'); return; }
    if (s.state === 'held') { toast('That seat is in someone else’s cart'); return; }
    if (s.state === 'selected') {
      s.state = 'avail'; cart.seats = cart.seats.filter((x: any) => x.id !== id);
    } else {
      if (cartCount() >= 8) { toast('Up to 8 tickets per order'); return; }
      s.state = 'selected'; cart.seats.push({ id, label: z.name + ' · ' + s.label, zone: z.id, price: z.price });
    }
    renderSection(z); updateCartBar();
  }

  function toggleTable(id: string) {
    const z = curZone, t = z.tablesArr.find((x: any) => x.id === id); if (!t) return;
    if (t.state === 'reserved') { toast('That table is taken'); return; }
    if (t.state === 'held') { toast('That table is in someone else’s cart'); return; }
    if (t.state === 'selected') {
      t.state = 'avail'; cart.tables = cart.tables.filter((x: any) => x.id !== id);
    } else {
      if (cartCount() >= 8) { toast('Up to 8 items per order'); return; }
      t.state = 'selected'; cart.tables.push({ id, label: z.name + ' · Table ' + t.num, zone: z.id, price: z.price, seats: z.perTable });
      toast('Table ' + t.num + ' held — seats ' + z.perTable);
    }
    renderTables(z); updateCartBar();
  }

  let gaZone: any = null, gaQty = 1;
  function openGA(z: any) {
    gaZone = z; gaQty = (cart.ga[z.id] ? cart.ga[z.id].qty : 1) || 1;
    $('ga-name').textContent = z.name; $('ga-price').textContent = money(z.price);
    $('ga-left').textContent = '· ' + fmt(z.cap - z.sold) + ' left';
    $('ga-n').textContent = gaQty; $('ga-sheet').classList.add('on');
  }
  $('ga-minus').onclick = () => { if (gaQty > 1) { gaQty--; $('ga-n').textContent = gaQty; } };
  $('ga-plus').onclick = () => { if (gaQty < 8 && cartCount() - (cart.ga[gaZone.id] ? cart.ga[gaZone.id].qty : 0) + gaQty < 9) { gaQty++; $('ga-n').textContent = gaQty; } };
  $('ga-add').onclick = () => {
    cart.ga[gaZone.id] = { qty: gaQty, price: gaZone.price, name: gaZone.name };
    $('ga-sheet').classList.remove('on'); updateCartBar(); toast(gaQty + ' × ' + gaZone.name + ' added');
  };
  $('ga-x').onclick = () => $('ga-sheet').classList.remove('on');

  function openReview() {
    const list = $('rev-list'); list.innerHTML = '';
    cart.seats.forEach((s: any) => {
      const d = document.createElement('div'); d.className = 'line';
      d.innerHTML = '<div class="l"><p class="n">' + s.label.split(' · ')[0] + '</p><p class="d">Seat ' + s.label.split(' · ')[1] + '</p></div><div class="r"><span class="pr">' + money(s.price) + '</span><button class="rm" data-seat="' + s.id + '">&times;</button></div>';
      list.appendChild(d);
    });
    Object.entries(cart.ga).forEach(([zid, g]: any) => {
      const d = document.createElement('div'); d.className = 'line';
      d.innerHTML = '<div class="l"><p class="n">' + g.name + '</p><p class="d">' + g.qty + ' × standing</p></div><div class="r"><span class="pr">' + money(g.qty * g.price) + '</span><button class="rm" data-ga="' + zid + '">&times;</button></div>';
      list.appendChild(d);
    });
    cart.tables.forEach((t: any) => {
      const parts = t.label.split(' · '); const d = document.createElement('div'); d.className = 'line';
      d.innerHTML = '<div class="l"><p class="n">' + parts[0] + ' · ' + parts[1] + '</p><p class="d">whole table · seats ' + t.seats + '</p></div><div class="r"><span class="pr">' + money(t.price) + '</span><button class="rm" data-table="' + t.id + '">&times;</button></div>';
      list.appendChild(d);
    });
    if (!cartCount()) list.innerHTML = '<p class="empty">Nothing selected yet.</p>';
    $('rev-total').textContent = money(cartTotal());
    splitOn = false; $('split-switch').classList.remove('on'); $('split-panel').style.display = 'none';
    $('split-block').style.display = cart.tables.length ? 'block' : 'none';
    updateSplitUI();
    $('rev-sheet').classList.add('on');
  }
  $('rev-list').addEventListener('click', (e: any) => {
    const sid = e.target.getAttribute('data-seat'), gid = e.target.getAttribute('data-ga'), tid = e.target.getAttribute('data-table');
    if (sid) { const z = ZONES.find((x) => x.seats && x.seats.some((s: any) => s.id === sid)); if (z) { const s = z.seats.find((s: any) => s.id === sid); if (s) s.state = 'avail'; } cart.seats = cart.seats.filter((x: any) => x.id !== sid); }
    if (gid) { delete cart.ga[gid]; }
    if (tid) { const z = ZONES.find((x) => x.tablesArr && x.tablesArr.some((t: any) => t.id === tid)); if (z) { const t = z.tablesArr.find((t: any) => t.id === tid); if (t) t.state = 'avail'; } cart.tables = cart.tables.filter((x: any) => x.id !== tid); }
    updateCartBar(); openReview(); redraw();
  });
  $('review').onclick = openReview;
  $('rev-x').onclick = () => $('rev-sheet').classList.remove('on');

  let splitOn = false, splitPeople = 2;
  function splitShare() { return Math.ceil(cartTotal() / splitPeople); }
  function updateSplitUI() {
    $('split-n').textContent = splitPeople + (splitPeople === 1 ? ' person' : ' people');
    $('split-share').textContent = money(splitShare());
    $('rev-pay').textContent = (splitOn && cart.tables.length)
      ? 'PAY MY SHARE · ' + money(splitShare())
      : 'LOCK & PAY · ' + money(cartTotal());
  }
  $('split-switch').onclick = () => { splitOn = !splitOn; $('split-switch').classList.toggle('on', splitOn); $('split-panel').style.display = splitOn ? 'block' : 'none'; updateSplitUI(); };
  $('split-minus').onclick = () => { if (splitPeople > 2) { splitPeople--; updateSplitUI(); } };
  $('split-plus').onclick = () => { if (splitPeople < 12) { splitPeople++; updateSplitUI(); } };

  $('rev-pay').onclick = () => {
    if (!cartCount()) return;
    if (splitOn && cart.tables.length) {
      const share = splitShare(), friends = splitPeople - 1;
      $('done-list').innerHTML = '<b>' + money(share) + '</b> paid — your share of ' + money(cartTotal()) + ' split ' + splitPeople + ' ways<br>' + friends + ' friend' + (friends !== 1 ? 's' : '') + ' invited · table held until all pay';
    } else {
      const parts: string[] = []; cart.seats.forEach((s: any) => parts.push(s.label)); (Object.values(cart.ga) as any[]).forEach((g) => parts.push(g.qty + ' × ' + g.name)); cart.tables.forEach((t: any) => parts.push(t.label));
      const noun = cart.tables.length ? 'item' : 'ticket';
      $('done-list').innerHTML = '<b>' + cartCount() + ' ' + noun + (cartCount() > 1 ? 's' : '') + '</b> · ' + money(cartTotal()) + '<br>' + parts.slice(0, 6).join(' &middot; ');
    }
    $('rev-sheet').classList.remove('on'); $('done-sheet').classList.add('on'); stopHold();
  };
  $('done-close').onclick = () => { location.href = '/discover.html'; };

  $('back').onclick = () => { if (mode === 'section') renderOverview(); else location.href = '/events/' + encodeURIComponent(eventId); };
  $('zback').onclick = () => renderOverview();

  const pts = new Map<number, any>(); let last: any = null, pinchDist = 0, downXY: any = null;
  const onDown = (e: any) => { svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragged = false; downXY = { x: e.clientX, y: e.clientY }; if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; svg.classList.add('grab'); } if (pts.size === 2) { pinchDist = twoDist(); } };
  const onMove = (e: any) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const d = twoDist(); const m = twoMid(); if (pinchDist) { zoomAt(m.x, m.y, pinchDist / d); } pinchDist = d; dragged = true; return; }
    if (pts.size === 1 && last) { const r = svg.getBoundingClientRect(); const dx = (e.clientX - last.x) / r.width * vb.w, dy = (e.clientY - last.y) / r.height * vb.h; vb.x -= dx; vb.y -= dy; svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h); last = { x: e.clientX, y: e.clientY }; if (downXY && Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > 6) dragged = true; }
  };
  function endPtr(e: any) {
    const wasTap = e.type === 'pointerup' && !dragged && pts.size === 1 && downXY && Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) < 8;
    pts.delete(e.pointerId); if (pts.size < 2) pinchDist = 0; if (pts.size === 0) { last = null; svg.classList.remove('grab'); } else last = [...pts.values()][0];
    if (wasTap) handleTap(e.clientX, e.clientY);
  }
  svg.addEventListener('pointerdown', onDown); svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', endPtr); svg.addEventListener('pointercancel', endPtr);
  function twoDist() { const p = [...pts.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
  function twoMid() { const p = [...pts.values()]; return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; }
  const onWheel = (e: any) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.12 : 0.89); $('hint').classList.add('gone'); };
  svg.addEventListener('wheel', onWheel, { passive: false });
  $('zin').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.7); };
  $('zout').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.4); };
  $('zrst').onclick = () => redraw();
  const onHintDown = () => $('hint').classList.add('gone');
  svg.addEventListener('pointerdown', onHintDown, { once: true });

  // boot: pull the event (title/meta) + its event-scoped floor plan
  fetch('/api/events/' + encodeURIComponent(eventId)).then((r) => (r.ok ? r.json() : null)).then((ev) => {
    if (ev) { $('ev-title').textContent = ev.name; $('ev-meta').textContent = ((ev.dateLabel ? ev.dateLabel + ' · ' : '') + (ev.venue || '')).toUpperCase(); }
  }).catch(() => {});
  fetch('/api/events/' + encodeURIComponent(eventId) + '/floorplan').then((r) => (r.ok ? r.json() : null)).then((plan) => {
    if (plan && plan.zones && plan.zones.length && loadPlan(plan)) {
      $('ev-meta').textContent = plan.zones.length + ' ZONES · LIVE FLOOR PLAN';
      $('cr-venue').textContent = 'Your venue';
    }
    renderOverview(); updateCartBar();
  }).catch(() => { renderOverview(); updateCartBar(); });
  const onResize = () => { setVB(); };
  window.addEventListener('resize', onResize);

  return () => {
    stopHold();
    window.removeEventListener('resize', onResize);
  };
}

export function SeatMap({ eventId }: { eventId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = '<style>' + STYLE + '</style>' + BODY;
    const cleanup = initSeatMap(host, eventId);
    return () => {
      cleanup();
      host.innerHTML = '';
    };
  }, [eventId]);
  return <div id="smroot" ref={ref} />;
}
