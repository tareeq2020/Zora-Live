'use client';

/* PR-F6 — the organizer control room (dashboard.html) as a React route at
   /dashboard. This page is behavior-heavy (live sales sim, entry feed, KYC gate,
   admin-impersonation bar), so it is ported faithfully: the exact markup + the
   page-scoped styles render via dangerouslySetInnerHTML, and the original
   imperative scripts run once on mount inside an effect. The scripts execute via
   `new Function('setInterval', …)` so every setInterval is captured and cleared
   on unmount (SPA-safe — the legacy page relied on full-page unload), and `toast`
   is published to window so the inline demo onclick handlers still resolve.
   Styles are scoped under `.zora-dash` so the bespoke light control-room palette
   never leaks past this route. Internal links are repointed to /dashboard/*. */

import { useEffect } from 'react';

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
.zora-dash .panel{display:none}
.zora-dash .panel.on{display:block}
.zora-dash .crumb{font-family:var(--mono);font-size:10.5px;letter-spacing:.3em;color:var(--mut);margin-bottom:8px}
.zora-dash h1{font-size:26px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px}
.zora-dash .sub{color:var(--mut);font-size:13.5px;margin-bottom:30px}
.zora-dash .live-pill{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;color:var(--blue);border:1px solid var(--blue);padding:6px 14px;border-radius:99px;vertical-align:middle;margin-left:14px}
.zora-dash .live-pill .pulse{width:7px;height:7px;border-radius:50%;background:var(--blue);animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
.zora-dash .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:28px}
.zora-dash .card{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:18px 20px}
.zora-dash .card .k{font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--mut)}
.zora-dash .card .v{font-family:var(--mono);font-size:26px;font-weight:500;margin-top:8px;letter-spacing:-.01em}
.zora-dash .card .v small{font-size:13px;color:var(--mut)}
.zora-dash .card .v.blue{color:var(--blue)}
.zora-dash .card .d{font-size:12px;color:var(--mut);margin-top:6px}
.zora-dash .split{display:grid;grid-template-columns:1.15fr 1fr;gap:14px}
@media(max-width:820px){.zora-dash .split{grid-template-columns:1fr}}
.zora-dash .box{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:22px 24px}
.zora-dash .box .bh{font-family:var(--mono);font-size:10px;letter-spacing:.25em;color:var(--mut);margin-bottom:18px}
.zora-dash .wave{margin-bottom:16px}
.zora-dash .wave .wr{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px}
.zora-dash .wave .wr .mono{color:var(--mut);font-size:12px}
.zora-dash .bar{height:7px;background:var(--paper);border:1px solid var(--hair);border-radius:4px;overflow:hidden}
.zora-dash .bar i{display:block;height:100%;background:var(--blue);transition:width .6s}
.zora-dash .bar i.done{background:var(--ink)}
.zora-dash .feed{font-family:var(--mono);font-size:12px;line-height:2.15;color:var(--mut)}
.zora-dash .feed div{display:flex;justify-content:space-between;gap:12px;white-space:nowrap;overflow:hidden}
.zora-dash .feed .g{color:var(--blue)}
.zora-dash .feed .s{color:var(--ink)}
.zora-dash .drop-row{display:flex;justify-content:space-between;align-items:center;gap:18px;background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:22px 24px;margin-bottom:14px;flex-wrap:wrap}
.zora-dash .drop-row .dn{font-weight:600;font-size:17px}
.zora-dash .drop-row .dm{font-family:var(--mono);font-size:11.5px;color:var(--mut);letter-spacing:.06em;margin-top:4px}
.zora-dash .tag{font-family:var(--mono);font-size:10px;letter-spacing:.2em;padding:5px 12px;border-radius:99px;border:1px solid}
.zora-dash .tag.live{color:var(--blue);border-color:var(--blue)}
.zora-dash .tag.draft{color:var(--mut);border-color:var(--hair)}
.zora-dash .btn{background:var(--ink);color:var(--paper);border:none;font-family:var(--mono);font-size:11.5px;font-weight:500;letter-spacing:.16em;padding:12px 24px;border-radius:8px;cursor:pointer;transition:background .2s}
.zora-dash .btn:hover{background:var(--blue)}
.zora-dash .btn.ghost{background:none;border:1px solid var(--hair);color:var(--ink)}
.zora-dash .btn.ghost:hover{border-color:var(--blue);color:var(--blue);background:none}
.zora-dash .btn.blue{background:var(--blue)}
.zora-dash .btn.blue:hover{background:var(--ink)}
.zora-dash .ledger{width:100%;border-collapse:collapse}
.zora-dash .ledger td{padding:13px 4px;border-bottom:1px solid var(--hair);font-size:13.5px}
.zora-dash .ledger td:last-child{text-align:right;font-family:var(--mono);font-size:14px}
.zora-dash .ledger tr.total td{border-bottom:none;font-weight:600;font-size:15px;padding-top:18px}
.zora-dash .ledger tr.total td:last-child{color:var(--blue);font-size:18px}
.zora-dash .ledger .note{color:var(--mut);font-size:11.5px}
.zora-dash .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.zora-dash .chip{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;padding:8px 16px;border-radius:99px;border:1px solid var(--hair);background:none;color:var(--mut);cursor:pointer}
.zora-dash .chip:hover{color:var(--ink);border-color:var(--mut)}
.zora-dash .chip.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.zora-dash .ptable{width:100%;border-collapse:collapse;font-size:13px}
.zora-dash .ptable th{font-family:var(--mono);font-size:9.5px;letter-spacing:.22em;color:var(--mut);text-align:left;padding:10px 8px;border-bottom:1px solid var(--hair);white-space:nowrap}
.zora-dash .ptable td{padding:12px 8px;border-bottom:1px solid var(--hair);vertical-align:middle}
.zora-dash .ptable .mono{font-size:12px}
.zora-dash .seg{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;padding:3px 9px;border-radius:99px;background:var(--bluewash);color:var(--blue);white-space:nowrap}
.zora-dash .table-scroll{overflow-x:auto}
.zora-dash .sig-grid{display:grid;grid-template-columns:1fr 1.1fr;gap:14px}
@media(max-width:820px){.zora-dash .sig-grid{grid-template-columns:1fr}}
.zora-dash label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--mut);margin-bottom:8px}
.zora-dash select,.zora-dash input[type=text]{width:100%;background:var(--paper);border:1px solid var(--hair);color:var(--ink);font-family:var(--mono);font-size:13.5px;padding:12px 14px;border-radius:8px;outline:none;-webkit-appearance:none;appearance:none}
.zora-dash select:focus,.zora-dash input[type=text]:focus{border-color:var(--blue)}
.zora-dash .field{margin-bottom:18px}
.zora-dash .preview{background:var(--ink);border-radius:10px;padding:30px 26px;color:var(--paper)}
.zora-dash .preview .ph{font-family:var(--mono);font-size:9.5px;letter-spacing:.3em;color:#8A877E;margin-bottom:18px}
.zora-dash .preview .pt{font-weight:600;font-size:21px;letter-spacing:-.01em;line-height:1.25}
.zora-dash .preview .pb{color:#8A877E;font-size:13px;margin-top:12px;line-height:1.6}
.zora-dash .preview .pc{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:.16em;border:1px solid var(--blue);color:var(--blue);padding:10px 20px;margin-top:22px;border-radius:6px}
.zora-dash .preview .countline{font-family:var(--mono);font-size:24px;color:var(--paper);margin-top:18px;letter-spacing:.04em}
.zora-dash .sf-grid{display:grid;grid-template-columns:1fr 1.1fr;gap:14px}
@media(max-width:820px){.zora-dash .sf-grid{grid-template-columns:1fr}}
.zora-dash input[type=color]{width:100%;height:44px;border:1px solid var(--hair);border-radius:8px;background:var(--paper);padding:4px;cursor:pointer}
.zora-dash .sf-preview{border:1px solid var(--hair);border-radius:10px;overflow:hidden;background:#fff}
.zora-dash .sf-preview .url{font-family:var(--mono);font-size:11px;color:var(--mut);padding:10px 16px;border-bottom:1px solid var(--hair);background:var(--card)}
.zora-dash .sf-body{padding:30px 26px 26px}
.zora-dash .sf-body .sfname{font-size:26px;font-weight:600;letter-spacing:-.02em}
.zora-dash .sf-body .sftag{font-family:var(--mono);font-size:10.5px;letter-spacing:.25em;color:var(--mut);margin-top:6px}
.zora-dash .sf-event{border:1px solid var(--hair);border-radius:8px;padding:16px 18px;margin-top:22px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.zora-dash .sf-event .en{font-weight:600;font-size:14.5px}
.zora-dash .sf-event .ed{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:3px}
.zora-dash .sf-cta{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:#fff;padding:10px 16px;border-radius:6px;white-space:nowrap}
.zora-dash .sf-foot{font-family:var(--mono);font-size:9.5px;letter-spacing:.2em;color:var(--mut);padding:14px 26px;border-top:1px solid var(--hair)}
.zora-dash .row-actions{display:flex;gap:10px;flex-wrap:wrap}
.zora-dash .toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:12px;letter-spacing:.1em;padding:14px 28px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:99;max-width:90vw;text-align:center}
.zora-dash .toast.show{opacity:1}
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
.zora-dash .verif-banner .vb-x{background:none;border:none;color:#a8823e;font-size:20px;cursor:pointer;line-height:1;padding:0 2px;flex-shrink:0}
.zora-dash .verif-banner .vb-x:hover{color:#5A340A}
`;

const MARKUP = `
<div class="shell">
  <aside class="rail">
    <p class="brand">z<span class="o">o</span>ra dashboard<small>THE ORGANIZER SIDE</small></p>
    <span class="verif-pill" id="verif-pill"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>VERIFICATION PENDING</span>
    <button class="nav-item on" data-p="tonight"><span class="dot"></span>Tonight</button>
    <button class="nav-item" data-p="drops"><span class="dot"></span>Drops</button>
    <button class="nav-item" data-p="money"><span class="dot"></span>Money</button>
    <button class="nav-item" data-p="people"><span class="dot"></span>People</button>
    <button class="nav-item" data-p="signals"><span class="dot"></span>Signals</button>
    <button class="nav-item" data-p="storefront"><span class="dot"></span>Storefront</button>
    <a class="nav-item" href="/dashboard/events/new" style="color:var(--blue);font-weight:500"><span class="dot"></span>+ New event</a>
    <p class="foot"><a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a><br><br>DEMO DASHBOARD — OFFSHORE LTD</p>
  </aside>

  <main>

    <div class="verif-banner" id="verif-banner">
      <div class="vb-ic" id="vb-ic"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
      <div class="vb-body">
        <p class="vb-t">Verification in progress <span class="vb-badge" id="vb-badge">PENDING · ~24H</span></p>
        <p class="vb-d" id="vb-desc">You can <b>draft events and explore everything</b> right now. <b>Ticket payouts</b> and your <b>public listing</b> stay locked until our security team approves your ID — this keeps scammers off the marketplace and protects your buyers. We'll email you the moment it clears.</p>
        <div class="vb-actions" id="vb-actions">
          <button class="vb-btn" id="vb-check">CHECK STATUS</button>
          <button class="vb-btn" onclick="location.href='/dashboard/onboarding'">RESUBMIT ID</button>
        </div>
      </div>
      <button class="vb-x" aria-label="Dismiss" onclick="document.getElementById('verif-banner').remove()">&times;</button>
    </div>

    <!-- ═══ TONIGHT ═══ -->
    <div class="panel on" id="p-tonight">
      <p class="crumb">DASHBOARD / TONIGHT</p>
      <h1>DROP 001 — OFFSHORE <span class="live-pill"><span class="pulse"></span>GATES OPEN</span></h1>
      <p class="sub">Sat 15 Aug — The Shore, Dar es Salaam. This page becomes mission control the moment your gates open.</p>

      <div class="cards">
        <div class="card"><p class="k">NET REVENUE</p><p class="v" id="m-rev">167,713,000 <small>TZS</small></p><p class="d">After the one flat Zora line</p></div>
        <div class="card"><p class="k">PASSES SOLD</p><p class="v" id="m-sold">2,847<small>/3,000</small></p><p class="d">Wave 03 locked — 153 left</p></div>
        <div class="card"><p class="k">SCANS / MIN</p><p class="v blue" id="m-scans">34</p><p class="d">Both gates flowing</p></div>
        <div class="card"><p class="k">INSIDE NOW</p><p class="v" id="m-inside">1,904</p><p class="d">63% of capacity through</p></div>
      </div>

      <div class="box" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <p class="bh" style="margin-bottom:10px">GROSS REVENUE — TODAY</p>
            <p class="mono" id="gross-big" style="font-size:34px;font-weight:500;letter-spacing:-.02em;line-height:1">176,540,000 <small style="font-size:15px;color:var(--mut)">TZS</small></p>
          </div>
          <div style="text-align:right">
            <span class="mono" style="font-size:10.5px;letter-spacing:.18em;color:var(--blue);display:inline-flex;align-items:center;gap:7px"><span style="width:7px;height:7px;border-radius:50%;background:var(--blue);animation:pulse 1.6s infinite"></span>LIVE</span>
            <p class="mono" id="gross-delta" style="font-size:11.5px;color:var(--mut);letter-spacing:.06em;margin-top:8px">+2,100,000 TZS last hour</p>
          </div>
        </div>
        <svg id="spark" viewBox="0 0 600 150" preserveAspectRatio="none" style="width:100%;height:150px;display:block;margin-top:16px;overflow:visible">
          <line x1="0" y1="112" x2="600" y2="112" stroke="var(--hair)" stroke-width="1"/>
          <line x1="0" y1="75"  x2="600" y2="75"  stroke="var(--hair)" stroke-width="1" stroke-dasharray="3 5"/>
          <line x1="0" y1="38"  x2="600" y2="38"  stroke="var(--hair)" stroke-width="1" stroke-dasharray="3 5"/>
          <path id="spark-area" fill="var(--bluewash)" stroke="none" d=""/>
          <path id="spark-line" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" d=""/>
          <circle id="spark-dot" r="4.5" fill="var(--blue)" cx="0" cy="0"/>
        </svg>
        <div class="mono" style="display:flex;justify-content:space-between;font-size:9.5px;letter-spacing:.14em;color:var(--mut);margin-top:8px">
          <span>10:00</span><span>13:00</span><span>16:00</span><span>19:00</span><span>NOW</span>
        </div>
      </div>

      <div class="split">
        <div class="box">
          <p class="bh">WAVE SELL-THROUGH</p>
          <div class="wave"><div class="wr"><span>Wave 01</span><span class="mono">1,000 / 1,000 — SOLD OUT</span></div><div class="bar"><i class="done" style="width:100%"></i></div></div>
          <div class="wave"><div class="wr"><span>Wave 02</span><span class="mono" id="w2-label">984 / 1,200</span></div><div class="bar"><i id="w2-bar" style="width:82%"></i></div></div>
          <div class="wave"><div class="wr"><span>Wave 03</span><span class="mono">LOCKED — OPENS AT W02 ZERO</span></div><div class="bar"><i style="width:0%"></i></div></div>
          <div class="wave" style="margin-bottom:0"><div class="wr"><span>Cabanas — crew of 6</span><span class="mono">31 / 40</span></div><div class="bar"><i style="width:77.5%"></i></div></div>
        </div>
        <div class="box">
          <p class="bh">LIVE ENTRY FEED</p>
          <div class="feed" id="feed"></div>
        </div>
      </div>
    </div>

    <!-- ═══ DROPS ═══ -->
    <div class="panel" id="p-drops">
      <p class="crumb">DASHBOARD / DROPS</p>
      <h1>Drops</h1>
      <p class="sub">Waves, caps and unlock rules. Every drop gets its own countdown page on your storefront automatically.</p>

      <div class="drop-row">
        <div>
          <p class="dn" id="d1-name">DROP 001 — OFFSHORE</p>
          <p class="dm" id="d1-meta">SAT 15 AUG 2026 · DAR ES SALAAM · 5 TIERS · DROPS IN <span id="d1-count" class="mono">--:--:--:--</span></p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="tag live">ON SALE SOON</span>
          <a class="btn ghost" href="/drop-001.html" target="_blank">VIEW PAGE</a>
        </div>
      </div>
      <div class="drop-row">
        <div>
          <p class="dn" style="color:var(--mut)">DROP 002 — UNTITLED</p>
          <p class="dm">DRAFT · GUEST COLOR UNASSIGNED · 0 TIERS</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="tag draft">DRAFT</span>
          <button class="btn ghost" onclick="toast('Demo — drop editor opens here')">EDIT</button>
        </div>
      </div>
      <button class="btn blue" onclick="toast('Demo — new drop wizard: name, date, waves, unlock rules')" style="margin-top:8px">NEW DROP</button>
    </div>

    <!-- ═══ MONEY ═══ -->
    <div class="panel" id="p-money">
      <p class="crumb">DASHBOARD / MONEY</p>
      <h1>Money</h1>
      <p class="sub">The same honest number your buyers see, from your side of the counter. No reconciliation spreadsheet. Ever.</p>

      <div class="split">
        <div class="box">
          <p class="bh">DROP 001 — THE LEDGER</p>
          <table class="ledger">
            <tr><td>Gross sales <span class="note">— 2,847 passes + 31 cabanas</span></td><td>176,540,000 TZS</td></tr>
            <tr><td>Zora <span class="note">— one flat line, 5%</span></td><td>&minus;8,827,000 TZS</td></tr>
            <tr><td>Buyer fees <span class="note">— there are none. This line exists to remind you.</span></td><td>0 TZS</td></tr>
            <tr class="total"><td>Your net</td><td>167,713,000 TZS</td></tr>
          </table>
        </div>
        <div class="box">
          <p class="bh">PAYOUTS</p>
          <table class="ledger">
            <tr><td>Settled to CRDB &middot;&middot;&middot;&middot;4417 <span class="note">— 28 Jul</span></td><td>120,000,000 TZS</td></tr>
            <tr><td>Arriving Friday <span class="note">— automatic</span></td><td>47,713,000 TZS</td></tr>
          </table>
          <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
            <button class="btn" id="pay-instant">INSTANT PAYOUT — M-PESA</button>
            <button class="btn ghost" onclick="toast('Demo — statement PDF downloads here')">STATEMENT</button>
          </div>
          <p class="pay-lock" id="pay-lock" style="display:none;align-items:center;gap:8px;margin-top:14px;font-family:var(--mono);font-size:11px;letter-spacing:.02em;color:#854F0B;background:#FAEEDA;border:1px solid #EF9F27;border-radius:9px;padding:10px 13px;line-height:1.5">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#854F0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-2px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            <b>Payouts locked</b> until your identity is verified. <a href="/dashboard/onboarding" style="color:#854F0B;text-decoration:underline">Verify now &rarr;</a>
          </p>
        </div>
      </div>
    </div>

    <!-- ═══ PEOPLE ═══ -->
    <div class="panel" id="p-people">
      <p class="crumb">DASHBOARD / PEOPLE</p>
      <h1>People</h1>
      <p class="sub">Your database, not ours. Every buyer, every crew, exportable in one click. Crew Leads are the ones who bring everyone else.</p>

      <div class="chips" id="chips"></div>
      <div class="box" style="padding:6px 20px 14px">
        <div class="table-scroll">
          <table class="ptable">
            <thead><tr><th>NAME</th><th>PHONE</th><th>SEGMENT</th><th>EVENTS</th><th>AVG CREW</th><th>LIFETIME</th></tr></thead>
            <tbody id="people-body"></tbody>
          </table>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:18px;align-items:center;flex-wrap:wrap">
        <button class="btn blue" id="launch-campaign">LAUNCH CAMPAIGN &rarr;</button>
        <button class="btn ghost" id="csv-export">EXPORT CSV</button>
        <span class="mono" style="font-size:11px;color:var(--mut);letter-spacing:.1em" id="people-count"></span>
      </div>
    </div>

    <!-- ═══ SIGNALS ═══ -->
    <div class="panel" id="p-signals">
      <p class="crumb">DASHBOARD / SIGNALS</p>
      <h1>Signals</h1>
      <p class="sub">Built-in email, tuned for drops. Pick a segment, pick a template, send. Deliverability is our problem, not yours.</p>

      <div class="sig-grid">
        <div class="box">
          <p class="bh">COMPOSE</p>
          <div class="field">
            <label>SEGMENT</label>
            <select id="sig-seg">
              <option value="Crew Leads|214">Crew Leads — 214 people, reach ~1,000</option>
              <option value="Regulars|682">Regulars (3+) — 682 people</option>
              <option value="First-timers|1893">First-timers — 1,893 people</option>
              <option value="Lapsed|347">Lapsed — 347 people</option>
              <option value="Everyone|3102">Everyone — 3,102 people</option>
            </select>
          </div>
          <div class="field">
            <label>TEMPLATE</label>
            <select id="sig-tpl">
              <option value="drop">Drop announcement — countdown block</option>
              <option value="wave">Wave unlock — price table</option>
              <option value="after">The aftermath — recap + next drop</option>
            </select>
          </div>
          <div class="field">
            <label>SUBJECT</label>
            <input type="text" id="sig-subj" value="DROP 001 — the signal you registered for">
          </div>
          <button class="btn blue" id="sig-send">SEND THE SIGNAL</button>
        </div>
        <div class="preview" id="sig-preview">
          <p class="ph">FROM OFFSHORE LTD · VIA ZORA SIGNALS</p>
          <p class="pt" id="pv-title">The manifest is about to open.</p>
          <p class="pb" id="pv-body">You registered your crew. Here is what that was for — boarding passes drop Thursday, 20:00 EAT, in the app only. Crews on the manifest get ten minutes before everyone else.</p>
          <p class="countline" id="pv-extra">26 : 14 : 09 : 33</p>
          <span class="pc">OPEN THE APP</span>
        </div>
      </div>
    </div>

    <!-- ═══ STOREFRONT ═══ -->
    <div class="panel" id="p-storefront">
      <p class="crumb">DASHBOARD / STOREFRONT</p>
      <h1>Storefront</h1>
      <p class="sub">Four tokens. That constraint is why every storefront on the network looks expensive. Checkout stays Zora — you brand the invitation, we brand the promise.</p>

      <div class="sf-grid">
        <div class="box">
          <p class="bh">BRAND KIT</p>
          <div class="field"><label>DISPLAY NAME</label><input type="text" id="bk-name" value="The Brunch City"></div>
          <div class="field"><label>HANDLE</label><input type="text" id="bk-handle" value="thebrunchcity"></div>
          <div class="field"><label>ACCENT</label><input type="color" id="bk-accent" value="#C46A28"></div>
          <div class="field">
            <label>TYPE PAIRING</label>
            <select id="bk-type">
              <option value="editorial">Editorial — serif display + grotesque</option>
              <option value="grotesque">Grotesque — all sans, tight</option>
              <option value="monoforward">Mono-forward — technical</option>
            </select>
          </div>
          <div class="row-actions"><a class="btn" href="/dashboard/storefront/studio">OPEN THE STUDIO &rarr;</a><a class="btn ghost" href="/thebrunchcity.html" target="_blank">LIVE PILOT</a></div>
        </div>
        <div>
          <div class="sf-preview">
            <p class="url" id="sf-url">thebrunchcity.zora.com</p>
            <div class="sf-body">
              <p class="sfname" id="sf-name">The Brunch City</p>
              <p class="sftag">DAR ES SALAAM · DAYTIME DONE PROPERLY</p>
              <div class="sf-event">
                <div><p class="en">GARDEN BRUNCH — VOL. 09</p><p class="ed">SAT 08 AUG · SECRET GARDEN · FROM 45,000 TZS</p></div>
                <span class="sf-cta" id="sf-cta1">GET PASSES</span>
              </div>
              <div class="sf-event">
                <div><p class="en">SUNSET SOCIAL — 002</p><p class="ed">SUN 30 AUG · COCO BEACH · FROM 35,000 TZS</p></div>
                <span class="sf-cta" id="sf-cta2">GET PASSES</span>
              </div>
            </div>
            <p class="sf-foot">RUNS ON Z<span style="color:var(--blue)">O</span>RA — NO FEES AT CHECKOUT, EVER</p>
          </div>
        </div>
      </div>
    </div>

  </main>
</div>

<p class="toast" id="toastEl"></p>
`;

const SCRIPT = String.raw`
  const $ = id => document.getElementById(id);
  function toast(msg){
    const t = $('toastEl');
    t.textContent = msg.toUpperCase();
    t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }
  if (typeof window !== 'undefined') window.toast = toast;

  /* ── nav ── */
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => {
    if (!b.dataset.p) return;
    document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    $('p-' + b.dataset.p).classList.add('on');
  }));

  /* ── tonight: live simulation ── */
  let rev = 167713000, sold = 2847, inside = 1904, w2 = 984, clockS = 22*3600 + 41*60 + 7;
  const fmt = n => n.toLocaleString('en-US');
  const pad = n => String(n).padStart(2, '0');
  const feedEl = $('feed');

  function feedRow(){
    clockS = (clockS + 2 + Math.floor(Math.random()*7)) % 86400;
    const hh = pad(Math.floor(clockS/3600)), mm = pad(Math.floor(clockS/60)%60), ss = pad(clockS%60);
    const row = document.createElement('div');
    if (Math.random() < 0.18){
      const n = 2 + Math.floor(Math.random()*5);
      row.innerHTML = '<span>' + hh + ':' + mm + ':' + ss + ' &middot; crew of ' + n + ' in</span><span class="s">SPLIT</span>';
      inside += n;
    } else {
      const code = 'Z001-' + pad(Math.floor(Math.random()*2999) + 1).padStart(4, '0');
      const gate = Math.random() < 0.5 ? 'GATE A' : 'GATE B';
      row.innerHTML = '<span>' + hh + ':' + mm + ':' + ss + ' &middot; ' + code + '</span><span class="g">' + gate + '</span>';
      inside += 1;
    }
    feedEl.prepend(row);
    while (feedEl.children.length > 9) feedEl.removeChild(feedEl.lastChild);
    $('m-inside').textContent = fmt(Math.min(inside, sold));
  }
  for (let i = 0; i < 6; i++) feedRow();
  setInterval(feedRow, 1900);

  setInterval(() => { $('m-scans').textContent = 28 + Math.floor(Math.random()*15); }, 2600);
  setInterval(() => {
    if (sold >= 3000 || w2 >= 1200) return;
    sold += 1; w2 += 1; rev += 84750; /* 85,000 minus the flat line */
    $('m-sold').innerHTML = fmt(sold) + '<small>/3,000</small>';
    $('m-rev').innerHTML = fmt(rev) + ' <small>TZS</small>';
    $('w2-label').textContent = fmt(w2) + ' / 1,200';
    $('w2-bar').style.width = (w2/1200*100).toFixed(1) + '%';
  }, 4300);

  /* ── tonight: real-time sales graph ── */
  const W = 600, H = 150, TOP = 12, BOT = 112;
  let series = [];
  (function seed(){
    let v = 8;
    for (let i = 0; i < 46; i++){
      const hour = i / 46;
      const shape = 0.4 + hour*hour*2.4 + Math.sin(hour*7)*0.18;
      v = Math.max(2, v*0.55 + shape*9 + Math.random()*3);
      series.push(v);
    }
  })();
  function drawSpark(){
    const max = Math.max(...series) * 1.12;
    const stepX = W / (series.length - 1);
    const pts = series.map((val, i) => [i*stepX, BOT - (val/max)*(BOT-TOP)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    $('spark-line').setAttribute('d', line);
    $('spark-area').setAttribute('d', line + ' L' + W + ' ' + BOT + ' L0 ' + BOT + ' Z');
    const last = pts[pts.length - 1];
    $('spark-dot').setAttribute('cx', last[0]); $('spark-dot').setAttribute('cy', last[1]);
  }
  drawSpark();
  let grossToday = 176540000, lastHour = 2100000;
  setInterval(() => {
    const tail = series[series.length - 1];
    const next = Math.max(4, tail*0.7 + 30 + Math.random()*22);
    series.push(next); series.shift();
    drawSpark();
    grossToday += Math.round(next * 1500);
    lastHour = Math.round(lastHour*0.94 + next*26000);
    $('gross-big').innerHTML = fmt(grossToday) + ' <small style="font-size:15px;color:var(--mut)">TZS</small>';
    $('gross-delta').textContent = '+' + fmt(lastHour) + ' TZS last hour';
  }, 2200);

  /* ── people: launch campaign shortcut ── */
  $('launch-campaign').addEventListener('click', () => {
    const seg = document.querySelector('.chip.on');
    document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('on'));
    document.querySelector('.nav-item[data-p="signals"]').classList.add('on');
    $('p-signals').classList.add('on');
    if (seg && seg.dataset.s && seg.dataset.s !== 'All'){
      const opt = [...$('sig-seg').options].find(o => o.text.toLowerCase().startsWith(seg.dataset.s.toLowerCase()));
      if (opt) $('sig-seg').value = opt.value;
    }
    toast('Campaign started — pick a template and send');
    window.scrollTo(0, 0);
  });

  /* ── drops: real countdown from the live API ── */
  let dropAt = '2026-07-30T20:00:00+03:00';
  fetch('/api/settings').then(r => r.ok ? r.json() : Promise.reject()).then(s => {
    if (s.dropAt) dropAt = s.dropAt;
    if (s.dropTitle && s.dropName) $('d1-name').textContent = s.dropTitle + ' — ' + s.dropName;
  }).catch(() => {});
  setInterval(() => {
    const diff = new Date(dropAt) - Date.now();
    $('d1-count').textContent = diff <= 0 ? 'LIVE NOW' :
      pad(Math.floor(diff/86400000)) + ':' + pad(Math.floor(diff/3600000)%24) + ':' + pad(Math.floor(diff/60000)%60) + ':' + pad(Math.floor(diff/1000)%60);
  }, 1000);

  /* ── people ── */
  const PEOPLE = [
    { name:'Amani Kessy',    phone:'+2557•• ••• 412', seg:'Crew Lead',    events:6, crew:5.2, ltv:'2,140,000' },
    { name:'Neema Mushi',    phone:'+2556•• ••• 887', seg:'Crew Lead',    events:5, crew:4.8, ltv:'1,865,000' },
    { name:'Baraka Temba',   phone:'+2557•• ••• 133', seg:'Big Spender',  events:4, crew:3.1, ltv:'3,400,000' },
    { name:'Zawadi Nyerere', phone:'+2557•• ••• 954', seg:'Regular',      events:4, crew:2.4, ltv:'820,000'  },
    { name:'Imani Mrema',    phone:'+2556•• ••• 271', seg:'Regular',      events:3, crew:3.6, ltv:'615,000'  },
    { name:'Juma Kileo',     phone:'+2557•• ••• 508', seg:'Regular',      events:3, crew:2.0, ltv:'480,000'  },
    { name:'Salma Rajabu',   phone:'+2556•• ••• 662', seg:'First-timer',  events:1, crew:4.0, ltv:'150,000'  },
    { name:'David Mwakyusa', phone:'+2557•• ••• 390', seg:'First-timer',  events:1, crew:1.0, ltv:'65,000'   },
    { name:'Grace Shirima',  phone:'+2557•• ••• 815', seg:'Lapsed',       events:2, crew:2.5, ltv:'310,000'  },
    { name:'Hassan Mbwana',  phone:'+2556•• ••• 049', seg:'Lapsed',       events:2, crew:3.0, ltv:'295,000'  }
  ];
  const SEGS = ['All', 'Crew Lead', 'Big Spender', 'Regular', 'First-timer', 'Lapsed'];
  let activeSeg = 'All';

  function renderChips(){
    $('chips').innerHTML = SEGS.map(s =>
      '<button class="chip' + (s === activeSeg ? ' on' : '') + '" data-s="' + s + '">' + s.toUpperCase() + (s === 'All' ? ' — 3,102' : '') + '</button>').join('');
  }
  function renderPeople(){
    const rows = PEOPLE.filter(p => activeSeg === 'All' || p.seg === activeSeg);
    $('people-body').innerHTML = rows.map(p =>
      '<tr><td><b>' + p.name + '</b></td><td class="mono">' + p.phone + '</td><td><span class="seg">' + p.seg.toUpperCase() + '</span></td>' +
      '<td class="mono">' + p.events + '</td><td class="mono">' + p.crew.toFixed(1) + '</td><td class="mono">' + p.ltv + ' TZS</td></tr>').join('');
    $('people-count').textContent = 'SHOWING ' + rows.length + ' OF 3,102 — DEMO SAMPLE';
  }
  $('chips').addEventListener('click', e => {
    if (!e.target.dataset.s) return;
    activeSeg = e.target.dataset.s;
    renderChips(); renderPeople();
  });
  renderChips(); renderPeople();

  $('csv-export').addEventListener('click', () => {
    const rows = [['name','phone','segment','events','avg_crew','lifetime_tzs']]
      .concat(PEOPLE.map(p => [p.name, p.phone.replace(/•/g, 'x'), p.seg, p.events, p.crew, p.ltv.replace(/,/g, '')]));
    const csv = rows.map(r => r.map(v => '"' + v + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'zora-dashboard-people-demo.csv';
    a.click();
    toast('CSV exported — your data, one click');
  });

  /* ── signals ── */
  const TPL = {
    drop:  { t:'The manifest is about to open.', b:'You registered your crew. Here is what that was for — boarding passes drop Thursday, 20:00 EAT, in the app only. Crews on the manifest get ten minutes before everyone else.', x:'26 : 14 : 09 : 33' },
    wave:  { t:'Wave 02 just unlocked.', b:'Wave 01 went to zero in 41 minutes. Wave 02 is live at 85,000 TZS — one number, nothing added at checkout. The cabanas are moving.', x:'85,000 TZS — 1,200 PASSES' },
    after: { t:'That was DROP 001.', b:'2,847 of you came through the gates. The recap film lands Friday. Verified attendance means you board the DROP 002 manifest before it goes public.', x:'DROP 002 — LOADING' }
  };
  $('sig-tpl').addEventListener('change', () => {
    const t = TPL[$('sig-tpl').value];
    $('pv-title').textContent = t.t; $('pv-body').textContent = t.b; $('pv-extra').textContent = t.x;
  });
  $('sig-send').addEventListener('click', () => {
    const [seg, n] = $('sig-seg').value.split('|');
    toast('Demo — signal queued to ' + n + ' ' + seg);
  });

  /* ── storefront brand kit ── */
  function bkRender(){
    const name = $('bk-name').value || 'Your brand';
    const handle = ($('bk-handle').value || 'yourbrand').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const accent = $('bk-accent').value;
    $('sf-name').textContent = name;
    $('sf-url').textContent = handle + '.zora.com';
    $('sf-cta1').style.background = accent;
    $('sf-cta2').style.background = accent;
    const pairing = $('bk-type').value;
    $('sf-name').style.fontFamily = pairing === 'monoforward' ? "'IBM Plex Mono',monospace" : "'Archivo',sans-serif";
    $('sf-name').style.fontStyle = pairing === 'editorial' ? 'italic' : 'normal';
  }
  ['bk-name','bk-handle','bk-accent','bk-type'].forEach(id => $(id).addEventListener('input', bkRender));
  bkRender();

  /* Admin "act on behalf" banner — shows when an admin is impersonating this organizer. */
  fetch('/api/impersonation').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if (!d || !d.impersonating) return;
    var imp = d.impersonating;
    var bar = document.createElement('div');
    bar.style.cssText = 'position:sticky;top:0;z-index:200;display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:#241a05;border-bottom:1px solid #BA7517;color:#F0C674;font-family:\'IBM Plex Mono\',monospace;font-size:12px;letter-spacing:.04em;padding:12px 20px';
    bar.innerHTML = '<span>ADMIN MODE — acting on behalf of <b style="color:#FFD98A">' + imp.name + '</b> (' + imp.handle + '.zora.com). Every action is logged.</span>' +
      '<button id="imp-exit" style="margin-left:auto;background:#F0C674;color:#241a05;border:none;border-radius:8px;font-family:inherit;font-size:11px;font-weight:600;letter-spacing:.1em;padding:9px 18px;cursor:pointer">EXIT ADMIN MODE</button>';
    document.body.prepend(bar);
    document.getElementById('imp-exit').onclick = function(){
      fetch('/api/impersonate/exit', { method:'POST' }).then(function(){ location.href = '/admin'; });
    };
  }).catch(function(){});

  /* Live KYC verification status — driven by the ref stored at signup. */
  (function(){
    var pill = document.getElementById('verif-pill');
    var banner = document.getElementById('verif-banner');
    var icLock = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    var icCheck = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
    var ref; try { ref = localStorage.getItem('zora_kyc_ref'); } catch(e){}
    var kycVerified = false;

    function gatePayout(verified){
      kycVerified = !!verified;
      var btn = document.getElementById('pay-instant');
      var lock = document.getElementById('pay-lock');
      if (!btn) return;
      if (verified){
        btn.style.opacity = ''; btn.style.cursor = ''; btn.removeAttribute('aria-disabled');
        if (lock) lock.style.display = 'none';
      } else {
        btn.style.opacity = '.45'; btn.style.cursor = 'not-allowed'; btn.setAttribute('aria-disabled', 'true');
        if (lock) lock.style.display = 'flex';
      }
    }
    (function(){
      var btn = document.getElementById('pay-instant');
      if (btn) btn.onclick = function(){
        if (!kycVerified){ toast('Verify your identity to unlock payouts', true); location.href = '/dashboard/onboarding'; return; }
        toast('Instant payout to M-Pesa — minutes, not days');
      };
      gatePayout(false);
    })();

    function paint(s){
      gatePayout(s.status === 'approved');
      if (!banner) return;
      var t = document.getElementById('vb-title') || banner.querySelector('.vb-t');
      var badge = document.getElementById('vb-badge');
      var desc = document.getElementById('vb-desc');
      var ic = document.getElementById('vb-ic');
      if (s.status === 'approved'){
        banner.style.background = '#E7F4EC'; banner.style.borderColor = '#39A06B';
        ic.style.borderColor = '#39A06B'; ic.innerHTML = icCheck; ic.querySelector('svg').style.stroke = '#1B6B41';
        t.innerHTML = 'Identity verified <span class="vb-badge" id="vb-badge" style="background:#39A06B;color:#062b18">APPROVED</span>';
        t.style.color = '#0f5230';
        desc.innerHTML = 'You\'re verified. <b>Ticket payouts and your public listing are unlocked</b> — you\'re ready to get paid.';
        desc.style.color = '#2f6b49';
        document.getElementById('vb-actions').style.display = 'none';
        if (pill){ pill.style.background = '#E7F4EC'; pill.style.borderColor = '#39A06B'; pill.style.color = '#1B6B41'; pill.innerHTML = icCheck + 'VERIFIED'; pill.querySelector('svg').style.stroke = '#1B6B41'; }
      } else if (s.status === 'rejected'){
        banner.style.background = '#FBEAE7'; banner.style.borderColor = '#D9503B';
        ic.style.borderColor = '#D9503B'; ic.querySelector('svg') && (ic.querySelector('svg').style.stroke = '#8f2a1b');
        t.innerHTML = 'We couldn\'t verify your ID <span class="vb-badge" style="background:#D9503B;color:#3a0d06">ACTION NEEDED</span>';
        t.style.color = '#7a2317';
        desc.innerHTML = (s.reason ? '<b>' + s.reason + '</b> ' : '') + 'No problem — fix the issue and resubmit. Payouts stay locked until your ID clears.';
        desc.style.color = '#8a3a2c';
        if (pill){ pill.style.background = '#FBEAE7'; pill.style.borderColor = '#D9503B'; pill.style.color = '#8f2a1b'; pill.innerHTML = 'VERIFICATION REJECTED'; }
      } else {
        if (badge) badge.textContent = 'UNDER REVIEW · ~24H';
        if (pill) pill.lastChild && (pill.lastChild.textContent = ' UNDER REVIEW');
      }
    }

    function check(announce){
      if (!ref){ if (announce) toast('No ID on file yet — tap Resubmit to verify'); return; }
      fetch('/api/kyc/status/' + encodeURIComponent(ref)).then(function(r){ return r.ok ? r.json() : null; }).then(function(s){
        if (!s) return;
        paint(s);
        if (announce){
          var msg = s.status === 'approved' ? 'Approved — payouts unlocked' :
                    s.status === 'rejected' ? 'Rejected: ' + (s.reason || 'please resubmit') :
                    'Still under review — usually within 24 hours';
          toast(msg);
        }
      }).catch(function(){});
    }
    var vbtn = document.getElementById('vb-check');
    if (vbtn) vbtn.onclick = function(){ check(true); };
    check(false);
  })();
`;

export default function DashboardPage() {
  useEffect(() => {
    const intervals: number[] = [];
    const native = window.setInterval.bind(window);
    const scopedSetInterval = (fn: TimerHandler, ms?: number) => {
      const id = native(fn, ms);
      intervals.push(id);
      return id;
    };
    // Any admin-impersonation bar the script prepends to <body> must also be
    // removed on unmount so it never survives navigation to another route.
    const bars = new Set<Element>();
    const bodyChildrenBefore = new Set(Array.from(document.body.children));
    try {
      // eslint-disable-next-line no-new-func
      new Function('setInterval', SCRIPT)(scopedSetInterval);
    } catch (e) {
      console.error('[dashboard] script error', e);
    }
    for (const child of Array.from(document.body.children)) {
      if (!bodyChildrenBefore.has(child)) bars.add(child);
    }
    return () => {
      intervals.forEach((id) => clearInterval(id));
      bars.forEach((el) => el.remove());
    };
  }, []);

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="zora-dash" dangerouslySetInnerHTML={{ __html: MARKUP }} />
    </>
  );
}
