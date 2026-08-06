/* PR-BS36 — the AdminShell stylesheet. House convention (apps/web has NO
   Tailwind): one page-scoped `<style>` block injected under a single root class
   so the bespoke control-room look never leaks past /admin/*.

   Palette = DESIGN.md "Control-room" plane (dark `#0A0A0B`), carried over from
   the legacy console tokens so the port is visually continuous. Type = Archivo
   (sans) + IBM Plex Mono (labels, money, codes, timers — DESIGN.md rules 2/4b:
   mono is never below 11.5px and never below `--mut` contrast).

   Responsive contract (design-review-spec, cross-cutting):
     · sidebar  -> hamburger drawer below 900px
     · tables   -> stacked cards below 620px (td[data-label] pseudo-labels)
     · touch targets >= 44px, no hover-only affordances. */

export const ADMIN_STYLE = `
.admin-shell{
  --black:#0A0A0B;--ink:#101012;--ink2:#16161A;--hair:#222226;--hair2:#2E2E34;
  --bone:#F4F1EA;--mut:#8A877E;--mut2:#615F59;
  --blue:#3D5AFE;--orange:#FF5A1F;--teal:#2FA9A0;--amber:#F0C674;
  --sans:'Archivo',system-ui,-apple-system,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;
  --rail:236px;
  background:var(--black);color:var(--bone);font-family:var(--sans);font-size:15px;line-height:1.55;
  -webkit-font-smoothing:antialiased;min-height:100vh}
.admin-shell *{margin:0;padding:0;box-sizing:border-box}
.admin-shell a{color:inherit;text-decoration:none}
.admin-shell .mono{font-family:var(--mono)}
.admin-shell :focus-visible{outline:2px solid var(--blue);outline-offset:2px}

/* ── layout ─────────────────────────────────────────────── */
.admin-shell .layout{display:flex;min-height:100vh}
.admin-shell .rail{
  width:var(--rail);flex:0 0 var(--rail);border-right:1px solid var(--hair);background:var(--black);
  position:sticky;top:0;height:100vh;overflow-y:auto;display:flex;flex-direction:column}
.admin-shell .rail-head{padding:20px 20px 18px;border-bottom:1px solid var(--hair)}
.admin-shell .wordmark{font-weight:600;font-size:21px;letter-spacing:-.02em;display:block}
.admin-shell .wordmark .o{color:var(--blue)}
.admin-shell .rail-head small{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.26em;color:var(--mut);margin-top:6px}
.admin-shell .nav{padding:10px 10px 20px;flex:1}
.admin-shell .nav-item{
  display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:11px 12px;
  background:none;border:none;border-left:2px solid transparent;cursor:pointer;text-align:left;
  font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;color:var(--mut);transition:color .15s,background .15s}
.admin-shell .nav-item:hover{color:var(--bone);background:var(--ink)}
.admin-shell .nav-item.on{color:var(--bone);background:var(--ink);border-left-color:var(--blue)}
.admin-shell .nav-item .dot{width:5px;height:5px;border-radius:50%;background:var(--hair2);flex:0 0 5px}
.admin-shell .nav-item.on .dot{background:var(--blue)}
.admin-shell .nav-item .soon{margin-left:auto;font-size:8.5px;letter-spacing:.12em;color:var(--mut2);border:1px solid var(--hair);padding:2px 5px}
.admin-shell .rail-foot{padding:14px 12px 22px;border-top:1px solid var(--hair);display:grid;gap:6px}
.admin-shell .rail-foot a,.admin-shell .rail-foot button{
  font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;color:var(--mut);background:none;border:none;
  text-align:left;padding:11px 12px;min-height:44px;cursor:pointer;display:flex;align-items:center}
.admin-shell .rail-foot a:hover{color:var(--bone)}
.admin-shell .rail-foot button:hover{color:var(--orange)}

.admin-shell .content{flex:1;min-width:0;display:flex;flex-direction:column}
.admin-shell .topbar{
  display:none;position:sticky;top:0;z-index:30;align-items:center;gap:14px;height:58px;padding:0 16px;
  background:var(--black);border-bottom:1px solid var(--hair)}
.admin-shell .burger{
  width:44px;height:44px;display:flex;flex-direction:column;justify-content:center;gap:5px;
  background:none;border:1px solid var(--hair);cursor:pointer;padding:0 11px}
.admin-shell .burger i{display:block;height:1.5px;background:var(--bone)}
.admin-shell .topbar .tb-t{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--mut)}
.admin-shell main{padding:34px 30px 90px;max-width:1180px;width:100%}
.admin-shell .scrim{display:none}

@media(max-width:900px){
  .admin-shell .layout{display:block}
  .admin-shell .topbar{display:flex}
  .admin-shell .rail{
    position:fixed;top:0;left:0;z-index:60;height:100vh;transform:translateX(-100%);
    transition:transform .2s ease;box-shadow:0 0 40px rgba(0,0,0,.6)}
  .admin-shell.drawer-open .rail{transform:none}
  .admin-shell.drawer-open .scrim{display:block;position:fixed;inset:0;z-index:50;background:rgba(6,7,12,.66)}
  .admin-shell main{padding:24px 18px 80px}
}
@media(prefers-reduced-motion:reduce){.admin-shell .rail{transition:none}}

/* ── section chrome ─────────────────────────────────────── */
.admin-shell .sec-h{margin-bottom:26px}
.admin-shell h2{font-size:23px;font-weight:600;letter-spacing:-.01em;margin-bottom:7px}
.admin-shell h3{font-size:16px;font-weight:600;letter-spacing:-.01em}
.admin-shell .hint{font-family:var(--mono);font-size:11.5px;color:var(--mut);letter-spacing:.04em;line-height:1.7}
.admin-shell .sec-h .hint{max-width:76ch}
.admin-shell .stack{display:grid;gap:26px}

/* ── card ───────────────────────────────────────────────── */
.admin-shell .card{border:1px solid var(--hair);background:var(--black)}
.admin-shell .card-h{
  display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding:16px 20px;border-bottom:1px solid var(--hair)}
.admin-shell .card-h .ct{font-family:var(--mono);font-size:11px;letter-spacing:.24em;color:var(--blue);font-weight:500}
.admin-shell .card-h .cs{font-family:var(--mono);font-size:11.5px;color:var(--mut);margin-top:6px;letter-spacing:.03em}
.admin-shell .card-h .ca{display:flex;gap:8px;flex-wrap:wrap}
.admin-shell .card-b{padding:20px}
.admin-shell .card-b.flush{padding:0}

/* ── sub-tabs ───────────────────────────────────────────── */
.admin-shell .subtabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:22px;border-bottom:1px solid var(--hair)}
.admin-shell .subtab{
  font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--mut);background:none;border:none;
  border-bottom:2px solid transparent;padding:12px 14px;min-height:44px;cursor:pointer}
.admin-shell .subtab:hover{color:var(--bone)}
.admin-shell .subtab.on{color:var(--bone);border-bottom-color:var(--blue)}

/* ── forms ──────────────────────────────────────────────── */
.admin-shell label{display:block;font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;color:var(--mut);margin-bottom:7px}
.admin-shell input,.admin-shell select,.admin-shell textarea{
  width:100%;background:var(--ink);border:1px solid var(--hair);color:var(--bone);font-family:var(--mono);
  font-size:14px;padding:12px 14px;min-height:44px;outline:none;border-radius:0;-webkit-appearance:none;appearance:none}
.admin-shell input:focus,.admin-shell select:focus,.admin-shell textarea:focus{border-color:var(--blue)}
.admin-shell input:disabled,.admin-shell select:disabled,.admin-shell textarea:disabled{opacity:.45;cursor:not-allowed}
.admin-shell .field{margin-bottom:18px}
.admin-shell .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.admin-shell .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:760px){.admin-shell .grid2,.admin-shell .grid3{grid-template-columns:1fr}}

/* ── buttons ────────────────────────────────────────────── */
.admin-shell .btn{
  background:var(--bone);color:var(--black);border:1px solid var(--bone);font-family:var(--mono);font-size:11.5px;
  font-weight:500;letter-spacing:.16em;padding:13px 26px;min-height:44px;cursor:pointer;transition:background .18s,color .18s}
.admin-shell .btn:hover:not(:disabled){background:var(--blue);border-color:var(--blue);color:var(--bone)}
.admin-shell .btn:disabled{opacity:.4;cursor:not-allowed}
.admin-shell .btn.ghost{background:none;border-color:var(--hair);color:var(--mut)}
.admin-shell .btn.ghost:hover:not(:disabled){border-color:var(--bone);color:var(--bone);background:none}
.admin-shell .btn.danger{background:none;border-color:var(--hair);color:var(--mut)}
.admin-shell .btn.danger:hover:not(:disabled){border-color:var(--orange);color:var(--orange);background:none}
.admin-shell .btn.small{padding:9px 14px;font-size:10.5px;min-height:44px}
.admin-shell .row-actions{display:flex;gap:8px;flex-wrap:wrap}

/* ── table -> stacked cards below 620px ─────────────────── */
.admin-shell .tbl-wrap{overflow-x:auto}
.admin-shell table{width:100%;border-collapse:collapse;font-size:13px}
.admin-shell th{
  font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--mut);text-align:left;padding:11px 14px;
  border-bottom:1px solid var(--hair);white-space:nowrap;font-weight:400}
.admin-shell td{padding:13px 14px;border-bottom:1px solid var(--hair);vertical-align:top}
.admin-shell td .mono{font-size:12.5px}
.admin-shell tbody tr:last-child td{border-bottom:none}
@media(max-width:620px){
  .admin-shell table,.admin-shell thead,.admin-shell tbody,.admin-shell tr,.admin-shell td{display:block;width:100%}
  .admin-shell thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .admin-shell tbody tr{border:1px solid var(--hair);background:var(--ink);margin:0 0 12px;padding:4px 0}
  .admin-shell tbody tr:last-child{margin-bottom:0}
  .admin-shell td{border-bottom:1px solid var(--hair);padding:11px 14px;display:flex;gap:14px;justify-content:space-between;align-items:flex-start}
  .admin-shell tbody tr td:last-child{border-bottom:none}
  .admin-shell td::before{
    content:attr(data-label);font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--mut);
    flex:0 0 34%;padding-top:2px}
  .admin-shell td[data-label='']::before{display:none}
  .admin-shell td>*{text-align:right}
  .admin-shell td .row-actions{justify-content:flex-end}
}

/* ── pills ──────────────────────────────────────────────── */
.admin-shell .pill{
  display:inline-block;font-family:var(--mono);font-size:10px;letter-spacing:.14em;padding:4px 9px;border:1px solid var(--hair);color:var(--mut)}
.admin-shell .pill.blue,.admin-shell .pill.open,.admin-shell .pill.submitted,.admin-shell .pill.in_review{color:var(--blue);border-color:var(--blue)}
.admin-shell .pill.teal,.admin-shell .pill.active,.admin-shell .pill.approved,.admin-shell .pill.shore{color:var(--teal);border-color:var(--teal)}
.admin-shell .pill.warn,.admin-shell .pill.suspended,.admin-shell .pill.rejected,.admin-shell .pill.soldout,.admin-shell .pill.flagged,.admin-shell .pill.vessel{color:var(--orange);border-color:var(--orange)}
.admin-shell .pill.locked,.admin-shell .pill.pending{color:var(--mut);border-color:var(--mut)}

/* ── stats ──────────────────────────────────────────────── */
.admin-shell .stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px}
.admin-shell .stat{border:1px solid var(--hair);padding:18px 20px;background:var(--black)}
.admin-shell .stat .sv{font-family:var(--mono);font-size:25px;font-weight:500;letter-spacing:-.01em}
.admin-shell .stat .sk{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--mut);margin-top:6px}

/* ── the six states ─────────────────────────────────────── */
.admin-shell .skel{display:grid;gap:9px;padding:20px}
.admin-shell .skel i{display:block;height:13px;background:linear-gradient(90deg,var(--ink) 0%,var(--hair) 50%,var(--ink) 100%);
  background-size:220% 100%;animation:admShimmer 1.25s linear infinite}
@keyframes admShimmer{0%{background-position:120% 0}100%{background-position:-120% 0}}
@media(prefers-reduced-motion:reduce){.admin-shell .skel i{animation:none;background:var(--ink)}}
.admin-shell .state{padding:34px 24px;text-align:center;display:grid;gap:14px;justify-items:center}
.admin-shell .state .st-l{font-size:14.5px;color:var(--bone);max-width:46ch;line-height:1.6}
.admin-shell .state .st-s{font-family:var(--mono);font-size:11.5px;color:var(--mut);letter-spacing:.04em;max-width:60ch}
.admin-shell .state.err{border:1px dashed var(--orange)}
.admin-shell .state.err .st-l{color:var(--orange)}
.admin-shell .state.soon .st-l{color:var(--mut)}
.admin-shell .banner-soon{
  font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;color:var(--amber);
  border:1px dashed #6b5314;background:#191305;padding:12px 16px;line-height:1.7}

/* ── impersonation banner (pinned) ──────────────────────── */
.admin-shell .imp-banner{
  position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  background:#241a05;border-bottom:1px solid #BA7517;padding:12px 20px}
.admin-shell .imp-banner .ib-t{font-weight:500;font-size:14px;color:var(--amber)}
.admin-shell .imp-banner .ib-d{font-family:var(--mono);font-size:11.5px;color:var(--mut);letter-spacing:.03em}
.admin-shell .imp-banner .btn{margin-left:auto}

/* ── toast ──────────────────────────────────────────────── */
.admin-shell .toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--blue);color:var(--bone);
  font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;padding:13px 26px;z-index:99;max-width:calc(100vw - 32px);
  text-align:center}
.admin-shell .toast.err{background:var(--orange);color:var(--black)}

/* ── media grid ─────────────────────────────────────────── */
.admin-shell .filterbar{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
.admin-shell .fbtn{
  font-family:var(--mono);font-size:11px;letter-spacing:.08em;background:none;border:1px solid var(--hair);
  color:var(--mut);padding:9px 15px;min-height:44px;cursor:pointer}
.admin-shell .fbtn.on{background:var(--bone);color:var(--black);border-color:var(--bone)}
.admin-shell .media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.admin-shell .mcard{border:1px solid var(--hair);overflow:hidden;background:var(--ink);display:flex;flex-direction:column}
.admin-shell .mcard .thumb{aspect-ratio:16/10;background:#000 center/cover no-repeat;position:relative}
.admin-shell .mcard .cat{
  position:absolute;top:8px;left:8px;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;
  background:rgba(10,10,11,.75);padding:4px 8px;color:var(--bone)}
.admin-shell .mstatus{position:absolute;top:8px;right:8px;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;padding:4px 8px}
.admin-shell .mstatus.approved{background:var(--teal);color:#04342C}
.admin-shell .mstatus.flagged{background:var(--orange);color:#0A0A0B}
.admin-shell .mstatus.pending{background:var(--hair);color:var(--bone)}
.admin-shell .mcard .minfo{padding:12px 14px;flex:1}
.admin-shell .mcard .mname{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-shell .mcard .mmeta{font-family:var(--mono);font-size:11.5px;color:var(--mut);margin-top:8px;line-height:1.7}
.admin-shell .mcard .mmeta .warn{color:var(--orange)}
.admin-shell .mcard .mcdn{
  font-family:var(--mono);font-size:11.5px;color:var(--blue);word-break:break-all;margin-top:8px;
  background:var(--black);border:1px solid var(--hair);padding:7px 9px}
.admin-shell .mcard .mact{display:flex;gap:8px;padding:0 14px 14px}
.admin-shell .mcard .mact button{
  flex:1;font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;padding:11px;min-height:44px;cursor:pointer;
  border:1px solid var(--hair);background:none;color:var(--mut)}
.admin-shell .mcard .mact .ok:hover{border-color:var(--teal);color:var(--teal)}
.admin-shell .mcard .mact .flag:hover{border-color:var(--orange);color:var(--orange)}

/* ── site-media slots ───────────────────────────────────── */
.admin-shell .slots-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.admin-shell .slot-card{border:1px solid var(--hair);overflow:hidden;background:var(--ink)}
.admin-shell .slot-card .sc-h{padding:12px 14px;border-bottom:1px solid var(--hair)}
.admin-shell .slot-card .rn{font-weight:500;font-size:14px}
.admin-shell .slot-card .rk{font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;color:var(--mut);margin-top:3px}
.admin-shell .slot-dz{
  aspect-ratio:16/9;background:#000 center/cover no-repeat;position:relative;cursor:pointer;
  display:flex;align-items:center;justify-content:center;border:none;width:100%;padding:0}
.admin-shell .slot-dz.drag{outline:2px dashed var(--blue);outline-offset:-6px}
.admin-shell .slot-dz .dz-hint{
  font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--bone);background:rgba(10,10,11,.62);
  padding:7px 13px;text-align:center}

/* ── scanner-agent role cards ───────────────────────────── */
.admin-shell .roles{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.admin-shell .role{border:1px solid var(--hair);padding:20px}
.admin-shell .role.master{border-color:var(--blue)}
.admin-shell .role .rt{font-weight:600;font-size:15px;display:flex;align-items:center;gap:8px}
.admin-shell .role .rtag{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;color:var(--mut);margin-top:6px}
.admin-shell .role ul{list-style:none;margin-top:14px;font-size:12.5px;color:var(--mut)}
.admin-shell .role li{padding:5px 0;display:flex;gap:8px}
.admin-shell .role li::before{content:'—';color:var(--blue)}
.admin-shell .agentcode{
  font-family:var(--mono);font-size:14px;letter-spacing:.2em;color:var(--teal);background:var(--black);
  border:1px dashed var(--teal);padding:5px 10px;white-space:nowrap;display:inline-block}

/* ── KYC drawer ─────────────────────────────────────────── */
.admin-shell .drawer{position:fixed;inset:0;z-index:70;display:flex;justify-content:flex-end;background:rgba(6,7,12,.72)}
.admin-shell .drawer-sheet{
  width:min(720px,100%);height:100%;overflow-y:auto;background:var(--ink);border-left:1px solid var(--hair);
  padding:26px 28px 60px;position:relative}
.admin-shell .drawer-close{
  position:absolute;top:14px;right:16px;background:none;border:none;color:var(--mut);font-size:26px;cursor:pointer;
  line-height:1;width:44px;height:44px}
.admin-shell .drawer-close:hover{color:var(--bone)}
.admin-shell .kyc-meta{display:grid;grid-template-columns:repeat(2,1fr);gap:12px 18px;margin:18px 0 22px}
@media(max-width:560px){.admin-shell .kyc-meta{grid-template-columns:1fr}}
.admin-shell .kyc-meta .m-k{font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--mut)}
.admin-shell .kyc-meta .m-v{font-size:14px;margin-top:3px}
.admin-shell .kyc-docs{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:18px}
.admin-shell .kyc-doc{border:1px solid var(--hair);overflow:hidden;background:var(--black);position:relative}
.admin-shell .kyc-doc .kd-h{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;color:var(--mut);padding:8px 10px;border-bottom:1px solid var(--hair)}
.admin-shell .kyc-doc img{display:block;width:100%;max-height:230px;object-fit:contain;background:#000;cursor:zoom-in}
.admin-shell .kyc-doc .kd-wm{
  position:absolute;bottom:8px;left:8px;font-family:var(--mono);font-size:9px;letter-spacing:.08em;
  color:rgba(255,255,255,.5);pointer-events:none}
.admin-shell .kyc-doc .kd-pdf{display:block;padding:34px 10px;text-align:center;font-family:var(--mono);font-size:11.5px;color:var(--blue)}
.admin-shell .kyc-decide{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.admin-shell .kyc-reject-box{margin-top:14px;padding:14px;border:1px solid var(--orange)}
.admin-shell .kyc-reject-box select,.admin-shell .kyc-reject-box textarea{margin-top:8px}
.admin-shell .kyc-events{margin-top:22px;border-top:1px solid var(--hair);padding-top:16px;list-style:none}
.admin-shell .kyc-events li{display:flex;gap:10px;flex-wrap:wrap;font-family:var(--mono);font-size:11.5px;color:var(--mut);padding:4px 0}
.admin-shell .kyc-events .ke-a{color:var(--bone)}
.admin-shell .kyc-sla{font-family:var(--mono);font-size:11.5px;color:var(--mut)}
.admin-shell .kyc-sla.late{color:var(--orange)}
`;
