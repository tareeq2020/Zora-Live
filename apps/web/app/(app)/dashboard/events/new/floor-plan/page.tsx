'use client';

/* PR-F6 — the no-code floor-plan builder (dashboard-seatbuilder.html) at
   /dashboard/events/new/floor-plan. The interactive SVG canvas (pointer
   draw/select zones, sample stadium, PUT /api/floorplan) is preserved verbatim.
   Same faithful pattern: page-scoped styles + markup via
   dangerouslySetInnerHTML, original script run once on mount. Styles scoped
   under `.zora-seatbuilder`; the DASHBOARD breadcrumb points to /dashboard. */

import { useEffect } from 'react';

const STYLE = `
.zora-seatbuilder{--paper:#F4F1EA;--card:#FBF9F4;--ink:#0A0A0B;--hair:#DDD8CB;--mut:#8A877E;--blue:#3D5AFE;--bluewash:#E8EBFE;--green:#1D9E75;--amber:#BA7517;--sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;min-height:100vh}
.zora-seatbuilder *{margin:0;padding:0;box-sizing:border-box}
.zora-seatbuilder a{color:inherit;text-decoration:none}
.zora-seatbuilder .mono{font-family:var(--mono)}
.zora-seatbuilder button{font-family:inherit}
.zora-seatbuilder .top{position:sticky;top:0;z-index:20;background:rgba(244,241,234,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--hair)}
.zora-seatbuilder .top-in{display:flex;align-items:center;gap:14px;padding:13px 22px}
.zora-seatbuilder .back{font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;color:var(--mut)}
.zora-seatbuilder .back:hover{color:var(--ink)}
.zora-seatbuilder .top .brand{font-weight:600;font-size:16px;letter-spacing:-.02em}
.zora-seatbuilder .top .brand .o{color:var(--blue)}
.zora-seatbuilder .top .title{font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--mut)}
.zora-seatbuilder .top-actions{margin-left:auto;display:flex;gap:10px}
.zora-seatbuilder .ghost{background:none;border:1px solid var(--hair);border-radius:9px;font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--mut);padding:11px 16px;cursor:pointer}
.zora-seatbuilder .ghost:hover{border-color:var(--mut);color:var(--ink)}
.zora-seatbuilder .pub{background:var(--ink);color:var(--paper);border:none;border-radius:9px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.14em;padding:11px 22px;cursor:pointer}
.zora-seatbuilder .pub:hover{background:var(--blue)}
.zora-seatbuilder .grid{display:grid;grid-template-columns:1fr 330px;gap:0;min-height:calc(100vh - 55px)}
@media(max-width:900px){.zora-seatbuilder .grid{grid-template-columns:1fr}}
.zora-seatbuilder .stage{padding:20px;display:flex;flex-direction:column;gap:14px}
.zora-seatbuilder .toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.zora-seatbuilder .tool{display:flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--hair);border-radius:10px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--mut);padding:10px 14px;cursor:pointer}
.zora-seatbuilder .tool.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.zora-seatbuilder .tool svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2}
.zora-seatbuilder .tool-sep{width:1px;height:22px;background:var(--hair);margin:0 4px}
.zora-seatbuilder .canvas-wrap{position:relative;border:1px solid var(--hair);border-radius:14px;overflow:hidden;background:#fff;aspect-ratio:16/9}
.zora-seatbuilder .canvas-wrap.grid-on{background-image:linear-gradient(var(--hair) 1px,transparent 1px),linear-gradient(90deg,var(--hair) 1px,transparent 1px);background-size:5% 8.9%}
.zora-seatbuilder .map-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:.9}
.zora-seatbuilder .empty-map{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--mut);gap:8px;pointer-events:none}
.zora-seatbuilder .empty-map svg{width:34px;height:34px;stroke:var(--mut);fill:none;stroke-width:1.6}
.zora-seatbuilder .empty-map .et{font-size:14px;font-weight:500;color:var(--ink)}
.zora-seatbuilder .empty-map .ed{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em}
.zora-seatbuilder #overlay{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
.zora-seatbuilder #overlay.select{cursor:default}
.zora-seatbuilder .zrect{cursor:pointer}
.zora-seatbuilder .ztext{font-family:var(--mono);fill:#0A0A0B;font-weight:600;pointer-events:none}
.zora-seatbuilder .zsub{font-family:var(--mono);fill:#0A0A0B;opacity:.7;pointer-events:none}
.zora-seatbuilder .upload-row{display:flex;gap:10px;flex-wrap:wrap}
.zora-seatbuilder .up-btn{display:inline-flex;align-items:center;gap:9px;background:var(--card);border:1px dashed var(--hair);border-radius:10px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--mut);padding:11px 16px;cursor:pointer}
.zora-seatbuilder .up-btn:hover{border-color:var(--blue);color:var(--blue)}
.zora-seatbuilder .up-btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2}
.zora-seatbuilder .up-name{font-family:var(--mono);font-size:11px;color:var(--green);align-self:center}
.zora-seatbuilder .panel{border-left:1px solid var(--hair);background:var(--card);padding:20px;display:flex;flex-direction:column;gap:18px}
@media(max-width:900px){.zora-seatbuilder .panel{border-left:none;border-top:1px solid var(--hair)}}
.zora-seatbuilder .p-h{font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--mut)}
.zora-seatbuilder label{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.2em;color:var(--mut);margin-bottom:7px}
.zora-seatbuilder .in{width:100%;background:#fff;border:1px solid var(--hair);border-radius:9px;color:var(--ink);font-family:var(--sans);font-size:14px;padding:11px 12px;outline:none}
.zora-seatbuilder .in:focus{border-color:var(--blue)}
.zora-seatbuilder select.in{-webkit-appearance:none;appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238A877E'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 13px center}
.zora-seatbuilder .field{margin-bottom:14px}
.zora-seatbuilder .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.zora-seatbuilder .swatches{display:flex;gap:8px}
.zora-seatbuilder .sw{width:26px;height:26px;border-radius:7px;cursor:pointer;border:2px solid transparent}
.zora-seatbuilder .sw.on{border-color:var(--ink)}
.zora-seatbuilder .cap-pill{background:var(--bluewash);border-radius:9px;padding:12px 14px;font-family:var(--mono);font-size:12px;color:var(--blue);display:flex;justify-content:space-between}
.zora-seatbuilder .cap-pill b{font-size:15px}
.zora-seatbuilder .no-sel{color:var(--mut);font-family:var(--mono);font-size:12px;line-height:1.7;letter-spacing:.03em}
.zora-seatbuilder .zlist{display:flex;flex-direction:column;gap:8px}
.zora-seatbuilder .zitem{display:flex;align-items:center;gap:10px;border:1px solid var(--hair);border-radius:10px;padding:10px 12px;cursor:pointer;background:#fff}
.zora-seatbuilder .zitem.on{border-color:var(--blue);background:var(--bluewash)}
.zora-seatbuilder .zitem .dot{width:12px;height:12px;border-radius:4px;flex-shrink:0}
.zora-seatbuilder .zitem .zn{font-size:13px;font-weight:500;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zora-seatbuilder .zitem .zc{font-family:var(--mono);font-size:10px;color:var(--mut)}
.zora-seatbuilder .zitem .del{background:none;border:none;color:var(--mut);cursor:pointer;font-size:15px}
.zora-seatbuilder .zitem .del:hover{color:#D85A30}
.zora-seatbuilder .summary{border-top:1px solid var(--hair);padding-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.zora-seatbuilder .stat{background:#fff;border:1px solid var(--hair);border-radius:9px;padding:12px}
.zora-seatbuilder .stat .sv{font-family:var(--mono);font-size:18px;font-weight:500}
.zora-seatbuilder .stat .sl{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;color:var(--mut);margin-top:3px}
.zora-seatbuilder .btn-row{display:grid;gap:8px}
.zora-seatbuilder .btn{background:var(--ink);color:var(--paper);border:none;border-radius:10px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.12em;padding:13px;cursor:pointer;text-align:center}
.zora-seatbuilder .btn:hover{background:var(--blue)}
.zora-seatbuilder .btn.sec{background:none;border:1px solid var(--hair);color:var(--ink)}
.zora-seatbuilder .btn.sec:hover{border-color:var(--blue);color:var(--blue);background:none}
.zora-seatbuilder .toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:12px;letter-spacing:.08em;padding:13px 24px;border-radius:9px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:50}
.zora-seatbuilder .toast.show{opacity:1}
`;

const MARKUP = `
<div class="top">
  <div class="top-in">
    <a class="back" href="/dashboard">&larr; DASHBOARD</a>
    <span class="brand">z<span class="o">o</span>ra</span>
    <span class="title">FLOOR PLAN BUILDER</span>
    <div class="top-actions">
      <button class="ghost" id="preview">PREVIEW AS BUYER</button>
      <button class="pub" id="publish">PUBLISH MAP</button>
    </div>
  </div>
</div>

<div class="grid">
  <div class="stage">
    <div class="upload-row">
      <button class="up-btn" id="up-btn"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>UPLOAD VENUE MAP (SVG / PNG / JPG)</button>
      <input type="file" id="up-file" accept="image/*,.svg" hidden>
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

  const COLORS = ['#3D5AFE','#2FA9A0','#B98A2E','#7A5AF8','#639922','#D4537E'];
  let tool='draw', zones=[], sel=null, nextId=1;

  /* ── upload ── */
  $('up-btn').onclick=()=>$('up-file').click();
  $('up-file').onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=ev=>{ $('map-img').src=ev.target.result; $('map-img').style.display='block'; $('empty-map').style.display='none'; $('up-name').textContent='✓ '+f.name; };
    rd.readAsDataURL(f);
  };

  /* ── tools ── */
  function setTool(t){ tool=t; $('t-draw').classList.toggle('on',t==='draw'); $('t-select').classList.toggle('on',t==='select'); $('overlay').classList.toggle('select',t==='select'); }
  $('t-draw').onclick=()=>setTool('draw');
  $('t-select').onclick=()=>setTool('select');
  $('t-grid').onclick=()=>{ $('canvas').classList.toggle('grid-on'); $('t-grid').classList.toggle('on'); };
  $('t-clear').onclick=()=>{ if(zones.length&&!confirm('Remove all zones?'))return; zones=[]; sel=null; render(); renderEditor(); toast('Cleared'); };
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
    const z={ id:'z'+(nextId++), name:'Zone '+(zones.length+1), type:'seated', x,y,w,h, color:COLORS[zones.length%COLORS.length], price:50000, rows:10, perRow:20, cap:200, tables:16, perTable:8 };
    zones.push(z); selectZone(z.id); toast('Zone added — set its details');
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
  }

  function capOf(z){ return z.type==='ga' ? (z.cap||0) : z.type==='table' ? ((z.tables||0)*(z.perTable||0)) : (z.rows*z.perRow); }

  /* ── editor ── */
  function selectZone(id){ sel=id; setTool('select'); render(); renderEditor(); }
  function renderEditor(){
    const z=zones.find(x=>x.id===sel);
    const box=$('editor');
    if(!z){ box.innerHTML='<p class="no-sel">Draw a zone on the map, or pick one from the list below, to set its name, seating, capacity and price.</p>'; return; }
    box.innerHTML =
      '<div class="field"><label>ZONE NAME</label><input class="in" id="e-name" value="'+z.name.replace(/"/g,'&quot;')+'"></div>'+
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
      '<div class="field"><label>'+(z.type==='table'?'PRICE PER TABLE (TZS)':'PRICE (TZS)')+'</label><input class="in" id="e-price" type="number" min="0" value="'+z.price+'"></div>'+
      '<div class="field"><label>COLOUR</label><div class="swatches" id="e-sw">'+COLORS.map(c=>'<span class="sw'+(c===z.color?' on':'')+'" style="background:'+c+'" data-c="'+c+'"></span>').join('')+'</div></div>'+
      '<div class="cap-pill"><span>'+(z.type==='table'?'Tables · total seats':'This zone holds')+'</span><b>'+(z.type==='table'?(fmt(z.tables||0)+' tables · '+fmt(capOf(z))+' seats'):(fmt(capOf(z))+' tickets'))+'</b></div>';

    const capText=()=>{ const b=$('editor').querySelector('.cap-pill b'); if(b) b.textContent = z.type==='table' ? (fmt(z.tables||0)+' tables · '+fmt(capOf(z))+' seats') : (fmt(capOf(z))+' tickets'); };
    const upd=()=>{ z.name=$('e-name').value||z.name; z.price=parseInt($('e-price').value)||0;
      if(z.type==='seated'){ z.rows=Math.max(1,parseInt($('e-rows').value)||1); z.perRow=Math.max(1,parseInt($('e-per').value)||1); }
      else if(z.type==='table'){ z.tables=Math.max(1,parseInt($('e-tables').value)||1); z.perTable=Math.max(1,parseInt($('e-pertable').value)||1); }
      else { z.cap=parseInt($('e-cap').value)||0; }
      capText(); render(); };
    $('e-name').oninput=upd; $('e-price').oninput=upd;
    $('e-type').onchange=()=>{ z.type=$('e-type').value;
      if(z.type==='table'){ if(!z.tables)z.tables=16; if(!z.perTable)z.perTable=8; }
      if(z.type==='ga'&&!z.cap)z.cap=(z.rows||10)*(z.perRow||20);
      renderEditor(); render(); };
    if($('e-rows')){ $('e-rows').oninput=upd; $('e-per').oninput=upd; }
    if($('e-tables')){ $('e-tables').oninput=upd; $('e-pertable').oninput=upd; }
    if($('e-cap')) $('e-cap').oninput=upd;
    $('e-sw').onclick=e=>{ const c=e.target.getAttribute('data-c'); if(c){ z.color=c; renderEditor(); render(); } };
  }

  function renderList(){
    $('zlist').innerHTML = zones.length ? zones.map(z=>
      '<div class="zitem'+(sel===z.id?' on':'')+'" data-z="'+z.id+'">'+
        '<span class="dot" style="background:'+z.color+'"></span>'+
        '<span class="zn">'+z.name+'</span>'+
        '<span class="zc">'+fmt(capOf(z))+'</span>'+
        '<button class="del" data-del="'+z.id+'" aria-label="Delete">&times;</button>'+
      '</div>').join('') : '<p class="no-sel">No zones yet.</p>';
  }
  $('zlist').addEventListener('click', e=>{
    const del=e.target.getAttribute('data-del');
    if(del){ zones=zones.filter(z=>z.id!==del); if(sel===del)sel=null; render(); renderEditor(); return; }
    const item=e.target.closest('.zitem'); if(item) selectZone(item.getAttribute('data-z'));
  });

  function renderSummary(){
    $('s-zones').textContent=zones.length;
    $('s-cap').textContent=fmt(zones.reduce((a,z)=>a+capOf(z),0));
  }

  /* ── sample ── */
  function loadSample(){
    zones=[
      {id:'z'+(nextId++),name:'Golden Circle',type:'ga',x:560,y:150,w:480,h:190,color:COLORS[1],price:180000,cap:2000,rows:10,perRow:20},
      {id:'z'+(nextId++),name:'VIP Tables',type:'table',x:560,y:360,w:480,h:120,color:COLORS[5],price:900000,tables:16,perTable:8},
      {id:'z'+(nextId++),name:'Grandstand A',type:'seated',x:150,y:150,w:360,h:520,color:COLORS[0],price:90000,rows:16,perRow:12},
      {id:'z'+(nextId++),name:'Grandstand B',type:'seated',x:1090,y:150,w:360,h:520,color:COLORS[0],price:90000,rows:16,perRow:12},
      {id:'z'+(nextId++),name:'Lawn GA',type:'ga',x:150,y:700,w:1300,h:150,color:COLORS[4],price:55000,cap:5000,rows:10,perRow:20}
    ];
    sel=zones[0].id; render(); renderEditor(); toast('Sample stadium loaded — edit any zone');
  }

  /* ── publish / preview ── */
  async function publish(){
    if(!zones.length){ toast('Draw at least one zone first'); return; }
    const cap=zones.reduce((a,z)=>a+capOf(z),0);
    try{
      const r=await fetch('/api/floorplan',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ space:{w:1600,h:900}, zones })});
      const d=await r.json(); if(!r.ok) throw new Error(d.error||'Publish failed');
      toast('Published live — '+zones.length+' zones, '+fmt(cap)+' seats. Buyers see it now.');
    }catch(err){ toast('Publish failed: '+(err.message||err)); }
  }
  $('publish').onclick=publish; $('publish2').onclick=publish;
  $('preview').onclick=()=>location.href='/seatmap.html'; $('preview2').onclick=()=>location.href='/seatmap.html';

  render();
`;

export default function FloorPlanBuilderPage() {
  useEffect(() => {
    try {
      // eslint-disable-next-line no-new-func
      new Function(SCRIPT)();
    } catch (e) {
      console.error('[floor-plan] script error', e);
    }
  }, []);

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="zora-seatbuilder" dangerouslySetInnerHTML={{ __html: MARKUP }} />
    </>
  );
}
