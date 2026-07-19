'use client';

/* PR-F6 — the "Create an event" page (create-event.html) at
   /dashboard/events/new. Faithful port following the same pattern as the
   dashboard: page-scoped styles + markup via dangerouslySetInnerHTML, the
   original imperative script run once on mount with setInterval capture (none
   here, but kept for symmetry) and window.toast exposed for the inline onclick.
   Styles scoped under `.zora-createev`; internal links repointed to /dashboard/*
   (the floor-plan link goes to the new /dashboard/events/new/floor-plan route). */

import { useEffect } from 'react';

const STYLE = `
.zora-createev{--paper:#F4F1EA;--card:#FBF9F4;--ink:#0A0A0B;--hair:#DDD8CB;--mut:#8A877E;--blue:#3D5AFE;--bluewash:#E8EBFE;--green:#1D9E75;--sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;min-height:100vh}
.zora-createev *{margin:0;padding:0;box-sizing:border-box}
.zora-createev a{color:inherit;text-decoration:none}
.zora-createev .mono{font-family:var(--mono)}
.zora-createev ::selection{background:var(--blue);color:#fff}
.zora-createev .top{position:sticky;top:0;z-index:30;background:rgba(244,241,234,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--hair)}
.zora-createev .top-in{max-width:1080px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.zora-createev .back{font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;color:var(--mut)}
.zora-createev .back:hover{color:var(--ink)}
.zora-createev .top .brand{font-weight:600;font-size:17px;letter-spacing:-.02em}
.zora-createev .top .brand .o{color:var(--blue)}
.zora-createev .top-actions{display:flex;gap:10px;align-items:center}
.zora-createev .ghost{background:none;border:1px solid var(--hair);border-radius:9px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--mut);padding:11px 18px;cursor:pointer}
.zora-createev .ghost:hover{border-color:var(--mut);color:var(--ink)}
.zora-createev .publish{background:var(--ink);color:var(--paper);border:none;border-radius:9px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.14em;padding:11px 24px;cursor:pointer;transition:background .2s}
.zora-createev .publish:hover{background:var(--blue)}
.zora-createev .grid{max-width:1080px;margin:0 auto;padding:34px 28px 90px;display:grid;grid-template-columns:1fr 380px;gap:40px;align-items:start}
@media(max-width:900px){.zora-createev .grid{grid-template-columns:1fr;gap:26px}}
.zora-createev h1{font-size:27px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px}
.zora-createev .sub{color:var(--mut);font-size:14px;margin-bottom:30px}
.zora-createev .block{margin-bottom:34px}
.zora-createev .block-h{font-family:var(--mono);font-size:10.5px;letter-spacing:.24em;color:var(--mut);margin-bottom:16px;display:flex;align-items:center;gap:10px}
.zora-createev .block-h .n{width:20px;height:20px;border-radius:50%;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;font-size:10px}
.zora-createev label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--mut);margin-bottom:8px}
.zora-createev .in{width:100%;background:#fff;border:1px solid var(--hair);border-radius:10px;font-family:var(--sans);font-size:15px;padding:13px 15px;outline:none;transition:border-color .2s;color:var(--ink)}
.zora-createev .in:focus{border-color:var(--blue)}
.zora-createev .in.big{font-size:19px;font-weight:500;padding:15px}
.zora-createev textarea.in{resize:vertical;min-height:80px;font-family:var(--sans)}
.zora-createev .field{margin-bottom:18px}
.zora-createev .row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:520px){.zora-createev .row2{grid-template-columns:1fr}}
.zora-createev .drop{border:2px dashed var(--hair);border-radius:14px;background:var(--card);min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:26px;cursor:pointer;transition:border-color .2s,background .2s;position:relative;overflow:hidden}
.zora-createev .drop:hover{border-color:var(--mut)}
.zora-createev .drop.drag{border-color:var(--blue);background:var(--bluewash)}
.zora-createev .drop .ic{width:44px;height:44px;border-radius:12px;background:#fff;border:1px solid var(--hair);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.zora-createev .drop .ic svg{width:20px;height:20px;stroke:var(--mut)}
.zora-createev .drop .dt{font-size:14.5px;font-weight:500}
.zora-createev .drop .dt b{color:var(--blue)}
.zora-createev .drop .dd{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;color:var(--mut);margin-top:6px}
.zora-createev .drop.filled{border-style:solid;border-color:var(--hair);padding:0;min-height:200px}
.zora-createev .drop.filled .prompt{display:none}
.zora-createev .drop img{width:100%;height:200px;object-fit:cover;display:none}
.zora-createev .drop.filled img{display:block}
.zora-createev .banner-bar{display:none;justify-content:space-between;align-items:center;margin-top:10px}
.zora-createev .banner-bar.on{display:flex}
.zora-createev .banner-bar .fn{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
.zora-createev .txtbtn{background:none;border:none;font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;color:var(--mut);cursor:pointer;text-decoration:underline}
.zora-createev .txtbtn:hover{color:var(--ink)}
.zora-createev .txtbtn.rm:hover{color:#D85A30}
.zora-createev .tier{background:#fff;border:1px solid var(--hair);border-radius:12px;padding:14px;margin-bottom:12px}
.zora-createev .tier-grid{display:grid;grid-template-columns:1.6fr 1fr 1fr auto;gap:10px;align-items:end}
@media(max-width:620px){.zora-createev .tier-grid{grid-template-columns:1fr 1fr;gap:10px}}
.zora-createev .tier label{margin-bottom:6px}
.zora-createev .tier .in{padding:11px 12px;font-size:14px}
.zora-createev .tier .del{width:38px;height:42px;border:1px solid var(--hair);border-radius:9px;background:none;color:var(--mut);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center}
.zora-createev .tier .del:hover{border-color:#D85A30;color:#D85A30}
@media(max-width:620px){.zora-createev .tier .del{width:100%;height:40px}}
.zora-createev .add-tier{width:100%;background:none;border:1px dashed var(--hair);border-radius:12px;padding:14px;font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;color:var(--mut);cursor:pointer;transition:border-color .2s,color .2s}
.zora-createev .add-tier:hover{border-color:var(--blue);color:var(--blue)}
.zora-createev .capbar{display:flex;justify-content:space-between;align-items:center;background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:14px 16px;margin-top:14px;font-family:var(--mono);font-size:12px;letter-spacing:.04em}
.zora-createev .capbar b{font-size:15px}
.zora-createev .side{position:sticky;top:88px}
@media(max-width:900px){.zora-createev .side{position:static}}
.zora-createev .side-h{font-family:var(--mono);font-size:10px;letter-spacing:.24em;color:var(--mut);margin-bottom:12px}
.zora-createev .pv{background:#fff;border:1px solid var(--hair);border-radius:16px;overflow:hidden}
.zora-createev .pv .pv-url{font-family:var(--mono);font-size:10.5px;color:var(--mut);padding:9px 14px;border-bottom:1px solid var(--hair);background:var(--card)}
.zora-createev .pv .pv-banner{height:150px;background:var(--bluewash);background-size:cover;background-position:center;display:flex;align-items:flex-end}
.zora-createev .pv .pv-banner .ph{font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--blue);margin:auto}
.zora-createev .pv .pv-body{padding:18px}
.zora-createev .pv .pv-title{font-size:19px;font-weight:600;letter-spacing:-.01em;line-height:1.15}
.zora-createev .pv .pv-meta{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.05em;margin-top:8px;line-height:1.8}
.zora-createev .pv .pv-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--hair);margin-top:16px;padding-top:14px}
.zora-createev .pv .pv-from{font-family:var(--mono);font-size:10px;color:var(--mut);letter-spacing:.1em}
.zora-createev .pv .pv-price{font-size:20px;font-weight:600}
.zora-createev .pv .pv-cta{background:var(--blue);color:#fff;font-family:var(--mono);font-size:10px;letter-spacing:.12em;padding:9px 16px;border-radius:99px}
.zora-createev .side-note{font-family:var(--mono);font-size:10.5px;color:var(--mut);letter-spacing:.04em;line-height:1.7;margin-top:16px;text-align:center}
.zora-createev .overlay{position:fixed;inset:0;background:rgba(244,241,234,.7);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;z-index:60;padding:24px}
.zora-createev .overlay.on{display:flex}
.zora-createev .success{background:#fff;border:1px solid var(--hair);border-radius:18px;max-width:420px;width:100%;padding:40px 32px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.12)}
.zora-createev .success .m{width:58px;height:58px;border-radius:50%;background:var(--bluewash);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 22px}
.zora-createev .success h2{font-size:23px;font-weight:600;letter-spacing:-.01em}
.zora-createev .success .su{font-family:var(--mono);font-size:12.5px;color:var(--ink);background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:13px;margin:20px 0;letter-spacing:.02em;word-break:break-all}
.zora-createev .success .su .h{color:var(--blue)}
.zora-createev .success .row{display:grid;gap:10px}
.zora-createev .toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:12px;letter-spacing:.1em;padding:13px 26px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:99}
.zora-createev .toast.show{opacity:1}
`;

const MARKUP = `
<div class="top">
  <div class="top-in">
    <a class="back" href="/dashboard">&larr; DASHBOARD</a>
    <span class="brand">z<span class="o">o</span>ra dashboard</span>
    <div class="top-actions">
      <button class="ghost" id="save-draft">SAVE DRAFT</button>
      <button class="publish" id="publish-top">PUBLISH</button>
    </div>
  </div>
</div>

<div class="grid">
  <div>
    <h1>Create an event</h1>
    <p class="sub">One page. Fill what you know, publish when you're ready. You can edit anything after it goes live.</p>

    <!-- 1 · banner -->
    <div class="block">
      <p class="block-h"><span class="n">1</span>EVENT BANNER</p>
      <div class="drop" id="drop">
        <img id="banner-img" alt="Event banner preview">
        <div class="prompt">
          <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15l-5-5L5 21"/><path d="M3 3h18v18H3z"/><circle cx="8.5" cy="8.5" r="1.5"/></svg></div>
          <p class="dt">Drop an image here, or <b>browse</b></p>
          <p class="dd">JPG / PNG / WEBP · 1600×900 LOOKS BEST · UP TO 8MB</p>
        </div>
        <input type="file" id="file" accept="image/*" hidden>
      </div>
      <div class="banner-bar" id="banner-bar">
        <span class="fn" id="banner-name">banner.jpg</span>
        <div style="display:flex;gap:16px">
          <button class="txtbtn" id="replace-btn">Replace</button>
          <button class="txtbtn rm" id="remove-btn">Remove</button>
        </div>
      </div>
    </div>

    <!-- 2 · details -->
    <div class="block">
      <p class="block-h"><span class="n">2</span>THE DETAILS</p>
      <div class="field">
        <label>EVENT TITLE</label>
        <input class="in big" id="f-title" placeholder="Garden Brunch — Vol. 10" maxlength="80">
      </div>
      <div class="row2">
        <div class="field"><label>DATE</label><input class="in" id="f-date" type="date"></div>
        <div class="field"><label>START TIME</label><input class="in" id="f-time" type="time"></div>
      </div>
      <div class="field">
        <label>LOCATION</label>
        <input class="in" id="f-loc" placeholder="The Secret Garden, Oysterbay — Dar es Salaam">
      </div>
      <div class="field">
        <label>DESCRIPTION <span style="color:var(--mut)">— OPTIONAL</span></label>
        <textarea class="in" id="f-desc" placeholder="Long tables, good light, better people. Passes are limited on purpose."></textarea>
      </div>
    </div>

    <!-- 3 · tiers -->
    <div class="block">
      <p class="block-h"><span class="n">3</span>TICKETS &amp; PRICING</p>
      <div id="tiers"></div>
      <button class="add-tier" id="add-tier">+ ADD ANOTHER TIER</button>
      <div class="capbar">
        <span>TOTAL CAPACITY <span style="color:var(--mut)">— sum of all tiers</span></span>
        <b class="mono" id="cap-total">0</b>
      </div>
    </div>

    <!-- 4 · large / seated event -->
    <div class="block">
      <p class="block-h"><span class="n">4</span>SEATING &amp; FLOOR PLAN <span style="color:var(--mut);font-weight:400;letter-spacing:0">— large events only</span></p>
      <div style="border:1px solid var(--hair);border-radius:12px;padding:16px 18px;display:flex;align-items:center;gap:14px;cursor:pointer"
           onclick="(function(){var p=document.getElementById('seat-panel'),s=document.getElementById('seat-switch'),k=document.getElementById('seat-knob');var on=p.style.display==='none';p.style.display=on?'block':'none';s.style.background=on?'#3D5AFE':'#DDD8CB';k.style.transform=on?'translateX(18px)':'translateX(0)';})()">
        <div style="flex:1">
          <p style="font-weight:500;font-size:14.5px">This is a large / seated event</p>
          <p style="font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.03em;margin-top:4px">Stadiums, arenas, and festivals with assigned seats or standing zones. Small events skip this.</p>
        </div>
        <span id="seat-switch" style="width:44px;height:26px;border-radius:99px;background:#DDD8CB;position:relative;flex-shrink:0;transition:background .2s"><span id="seat-knob" style="position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s"></span></span>
      </div>
      <div id="seat-panel" style="display:none;margin-top:12px;border:1px dashed var(--hair);border-radius:12px;padding:20px;text-align:center">
        <p style="font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.04em;margin-bottom:14px;line-height:1.6">Build an interactive floor plan — upload your venue map, draw ticket zones, set rows, seats and prices. No code.</p>
        <a href="/dashboard/events/new/floor-plan" style="display:inline-block;background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.14em;padding:13px 26px;border-radius:10px">OPEN FLOOR-PLAN BUILDER &rarr;</a>
      </div>
    </div>
  </div>

  <!-- live preview -->
  <div>
    <div class="side">
      <p class="side-h">LIVE PREVIEW — HOW YOUR CROWD SEES IT</p>
      <div class="pv">
        <p class="pv-url" id="pv-url">yourname.zora.com</p>
        <div class="pv-banner" id="pv-banner"><span class="ph" id="pv-ph">YOUR BANNER APPEARS HERE</span></div>
        <div class="pv-body">
          <p class="pv-title" id="pv-title">Your event title</p>
          <p class="pv-meta" id="pv-meta">DATE · TIME<br>LOCATION</p>
          <div class="pv-foot">
            <div><p class="pv-from">FROM</p><p class="pv-price" id="pv-price">—</p></div>
            <span class="pv-cta">GET PASSES</span>
          </div>
        </div>
      </div>
      <p class="side-note">No fees are ever added at checkout.<br>The price you set is the price they pay.</p>
    </div>
  </div>
</div>

<!-- success -->
<div class="overlay" id="overlay">
  <div class="success">
    <div class="m">&checkmark;</div>
    <h2>Your event is live.</h2>
    <p class="su"><span class="h" id="su-handle">yourname</span>.zora.com/e/<span id="su-slug">event</span></p>
    <div class="row">
      <button class="publish" style="padding:15px" id="su-view">VIEW ON STOREFRONT</button>
      <button class="ghost" style="padding:15px" id="su-dash">GO TO DASHBOARD</button>
    </div>
  </div>
</div>

<p class="toast" id="toast"></p>
`;

const SCRIPT = String.raw`
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('en-US');
  function toast(m){ const t = $('toast'); t.textContent = m.toUpperCase(); t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400); }
  if (typeof window !== 'undefined') window.toast = toast;

  let handle = 'yourname';
  fetch('/api/settings').then(r => r.ok ? r.json() : Promise.reject()).then(() => {}).catch(() => {});
  try { const h = new URLSearchParams(location.search).get('h'); if (h) handle = h; } catch(e){}
  $('pv-url').textContent = handle + '.zora.com';

  /* ── banner drag-drop ── */
  const drop = $('drop'), fileInput = $('file');
  function loadFile(file){
    if (!file || !/^image\//.test(file.type)) return toast('Please choose an image file');
    if (file.size > 8 * 1024 * 1024) return toast('That image is over 8MB');
    const reader = new FileReader();
    reader.onload = e => {
      $('banner-img').src = e.target.result;
      drop.classList.add('filled');
      $('banner-bar').classList.add('on');
      $('banner-name').textContent = file.name;
      $('pv-banner').style.backgroundImage = 'url(' + e.target.result + ')';
      $('pv-ph').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
  drop.addEventListener('click', e => { if (!e.target.closest('.banner-bar')) fileInput.click(); });
  fileInput.addEventListener('change', () => fileInput.files[0] && loadFile(fileInput.files[0]));
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return; drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  $('replace-btn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  $('remove-btn').addEventListener('click', e => {
    e.stopPropagation();
    drop.classList.remove('filled'); $('banner-bar').classList.remove('on');
    $('banner-img').src = ''; fileInput.value = '';
    $('pv-banner').style.backgroundImage = ''; $('pv-ph').style.display = 'block';
  });

  /* ── details -> preview ── */
  function upd(){
    $('pv-title').textContent = $('f-title').value.trim() || 'Your event title';
    const d = $('f-date').value, t = $('f-time').value, loc = $('f-loc').value.trim();
    let when = '';
    if (d){ const dt = new Date(d + 'T00:00'); when = dt.toLocaleDateString('en-US', { weekday:'short', day:'2-digit', month:'short', year:'numeric' }).toUpperCase(); }
    if (t) when += (when ? ' · ' : '') + t;
    $('pv-meta').innerHTML = (when || 'DATE · TIME') + '<br>' + (loc.toUpperCase() || 'LOCATION');
  }
  ['f-title','f-date','f-time','f-loc'].forEach(id => $(id).addEventListener('input', upd));

  /* ── ticket tiers ── */
  const tiersEl = $('tiers');
  function tierRow(name, price, qty){
    const div = document.createElement('div');
    div.className = 'tier';
    div.innerHTML =
      '<div class="tier-grid">' +
        '<div><label>TIER NAME</label><input class="in t-name" placeholder="General" value="' + (name||'') + '"></div>' +
        '<div><label>PRICE (TZS)</label><input class="in t-price" type="number" min="0" placeholder="45000" value="' + (price||'') + '"></div>' +
        '<div><label>QUANTITY</label><input class="in t-qty" type="number" min="0" placeholder="220" value="' + (qty||'') + '"></div>' +
        '<button class="del" title="Remove tier">&times;</button>' +
      '</div>';
    div.querySelector('.del').addEventListener('click', () => { div.remove(); recalc(); });
    div.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc));
    tiersEl.appendChild(div);
  }
  function recalc(){
    let cap = 0, min = null;
    tiersEl.querySelectorAll('.tier').forEach(t => {
      const q = parseInt(t.querySelector('.t-qty').value, 10) || 0;
      const p = parseInt(t.querySelector('.t-price').value, 10);
      cap += q;
      if (!isNaN(p) && (min === null || p < min)) min = p;
    });
    $('cap-total').textContent = fmt(cap);
    $('pv-price').textContent = (min === null) ? '—' : fmt(min) + ' TZS';
  }
  $('add-tier').addEventListener('click', () => tierRow('', '', ''));
  tierRow('Early bird', 45000, 100);
  tierRow('General', 55000, 120);
  recalc();

  /* ── publish ── */
  function publish(){
    const title = $('f-title').value.trim();
    if (!title) return toast('Give your event a title first');
    if (!tiersEl.querySelector('.tier')) return toast('Add at least one ticket tier');
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';
    $('su-handle').textContent = handle;
    $('su-slug').textContent = slug;
    $('overlay').classList.add('on');
  }
  $('publish-top').addEventListener('click', publish);
  $('save-draft').addEventListener('click', () => toast('Draft saved to your dashboard'));
  $('su-view').addEventListener('click', () => location.href = '/thebrunchcity.html');
  $('su-dash').addEventListener('click', () => location.href = '/dashboard');
`;

export default function CreateEventPage() {
  useEffect(() => {
    try {
      // eslint-disable-next-line no-new-func
      new Function(SCRIPT)();
    } catch (e) {
      console.error('[create-event] script error', e);
    }
  }, []);

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="zora-createev" dangerouslySetInnerHTML={{ __html: MARKUP }} />
    </>
  );
}
