import type { Metadata } from 'next';
import { DiscoverApp } from './discover-app';

/* /discover — React port of public/discover.html (the marketplace). The whole
   body is interactive (location/currency, chips, search, /api/events, ticket
   sheet, ZBot, placements) so it lives in <DiscoverApp> (client). This server
   shell just carries the page metadata, per-page fonts and the two inline
   <style> blocks. Its nav diverges from the shared SiteNav, so the marketing
   layout omits SiteNav for /discover (see marketing-chrome.tsx). */

export const metadata: Metadata = {
  title: 'ZORA — Find your night',
  description:
    'Every event worth being at, near you. Concerts, festivals, nightlife and daytime — one honest price, no fees at checkout. Powered by Zora.',
};

const CSS = `
  :root{
    --black:#0A0A0B; --ink:#101012; --ink2:#16161A; --hair:#26262B; --hair2:#33333A;
    --bone:#F4F1EA; --mut:#8A877E; --mut2:#B4B1A8;
    --blue:#3D5AFE; --orange:#FF5A1F;
    --sans:'Archivo',system-ui,sans-serif; --mono:'IBM Plex Mono',monospace; --stamp:'Anton',sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--black);color:var(--bone);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  ::selection{background:var(--blue);color:var(--bone)}
  .wrap{max-width:1180px;margin:0 auto;padding:0 24px}
  .mono{font-family:var(--mono)}

  /* ── nav ── */
  nav{position:sticky;top:0;z-index:50;background:var(--c-nav);backdrop-filter:blur(14px);border-bottom:1px solid var(--hair)}
  .nav-in{display:flex;align-items:center;gap:20px;height:66px}
  .wordmark{font-weight:600;font-size:22px;letter-spacing:-.02em}
  .wordmark .o{color:var(--blue)}

  /* location pill */
  .loc{position:relative}
  .loc-btn{display:flex;align-items:center;gap:9px;background:var(--ink);border:1px solid var(--hair);border-radius:99px;padding:9px 15px;cursor:pointer;color:var(--bone);font-family:var(--sans);font-size:13.5px;transition:border-color .2s}
  .loc-btn:hover{border-color:var(--hair2)}
  .loc-btn .pin{width:7px;height:7px;border-radius:50%;background:var(--blue);flex-shrink:0}
  .loc-btn .city{font-weight:500}
  .loc-btn .chev{color:var(--mut);font-size:11px;margin-left:2px}
  .loc-btn .detecting{color:var(--mut);font-family:var(--mono);font-size:12px}
  .loc-menu{position:absolute;top:48px;left:0;background:var(--ink2);border:1px solid var(--hair2);border-radius:14px;padding:8px;min-width:230px;display:none;box-shadow:0 20px 50px rgba(0,0,0,.5);z-index:60}
  .loc-menu.on{display:block}
  .loc-menu .lm-h{font-family:var(--mono);font-size:9.5px;letter-spacing:.2em;color:var(--mut);padding:8px 12px 6px}
  .loc-opt{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:9px;cursor:pointer;font-size:14px}
  .loc-opt:hover{background:var(--ink)}
  .loc-opt .co{font-family:var(--mono);font-size:11px;color:var(--mut)}
  .loc-opt.on{color:var(--blue)}
  .loc-opt.on .co{color:var(--blue)}

  /* search */
  .search{flex:1;max-width:420px;position:relative}
  .search input{width:100%;background:var(--ink);border:1px solid var(--hair);border-radius:99px;color:var(--bone);font-family:var(--sans);font-size:14px;padding:11px 16px 11px 42px;outline:none;transition:border-color .2s}
  .search input:focus{border-color:var(--blue)}
  .search input::placeholder{color:var(--mut)}
  .search .mag{position:absolute;left:16px;top:50%;transform:translateY(-50%);width:15px;height:15px;stroke:var(--mut);fill:none;stroke-width:2}
  .nav-right{display:flex;align-items:center;gap:14px;margin-left:auto}
  .nav-right .link{font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--mut)}
  .nav-right .link:hover{color:var(--bone)}
  .app-btn{font-family:var(--mono);font-size:12px;letter-spacing:.08em;background:var(--bone);color:var(--black);padding:9px 16px;border-radius:99px;transition:background .2s}
  .app-btn:hover{background:var(--blue);color:var(--bone)}
  @media(max-width:880px){.search{display:none}.nav-right .link{display:none}}

  /* ── hero ── */
  .hero{position:relative;overflow:hidden;border-bottom:1px solid var(--hair)}
  .hero-bg{position:absolute;inset:0;background:radial-gradient(120% 90% at 15% 0%,rgba(61,90,254,.28),transparent 55%),radial-gradient(90% 80% at 95% 20%,rgba(255,90,31,.14),transparent 50%);animation:drift 14s ease-in-out infinite alternate}
  @keyframes drift{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(-3%,2%,0) scale(1.08)}}
  .hero-in{position:relative;padding:80px 0 66px}
  .hero .now{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;color:var(--mut2);background:var(--ink);border:1px solid var(--hair);border-radius:99px;padding:8px 15px;margin-bottom:26px}
  .hero .now .live-dot{width:7px;height:7px;border-radius:50%;background:var(--blue);animation:pulse 1.6s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .hero .now b{color:var(--bone);font-weight:500}
  .hero h1{font-weight:600;letter-spacing:-.035em;line-height:.98;font-size:clamp(42px,7vw,88px);max-width:14ch;text-transform:lowercase}
  .hero h1 .g{color:var(--blue)}
  .hero .subline{color:var(--mut2);font-size:clamp(15px,1.8vw,18px);margin-top:22px;max-width:46ch}

  .hero-search{margin-top:34px;display:flex;gap:10px;max-width:560px}
  .hero-search .box{flex:1;position:relative}
  .hero-search input{width:100%;background:var(--ink);border:1px solid var(--hair2);border-radius:14px;color:var(--bone);font-size:15px;padding:16px 16px 16px 48px;outline:none;transition:border-color .2s}
  .hero-search input:focus{border-color:var(--blue)}
  .hero-search input::placeholder{color:var(--mut)}
  .hero-search .mag{position:absolute;left:17px;top:50%;transform:translateY(-50%);width:18px;height:18px;stroke:var(--mut);fill:none;stroke-width:2}
  .hero-search .go{background:var(--bone);color:var(--black);border:none;border-radius:14px;font-family:var(--mono);font-size:12px;font-weight:500;letter-spacing:.1em;padding:0 26px;cursor:pointer;transition:background .2s}
  .hero-search .go:hover{background:var(--blue);color:var(--bone)}
  @media(max-width:560px){.hero-search .go{padding:0 18px}}

  /* ── filter bar ── */
  .filters{position:sticky;top:66px;z-index:40;background:var(--c-nav);backdrop-filter:blur(12px);border-bottom:1px solid var(--hair)}
  .filters-in{display:flex;gap:9px;padding:16px 0;overflow-x:auto;scrollbar-width:none}
  .filters-in::-webkit-scrollbar{display:none}
  .chip{white-space:nowrap;font-family:var(--mono);font-size:12px;letter-spacing:.06em;background:var(--ink);border:1px solid var(--hair);color:var(--mut2);padding:10px 18px;border-radius:99px;cursor:pointer;transition:all .18s}
  .chip:hover{border-color:var(--hair2);color:var(--bone)}
  .chip.on{background:var(--bone);color:var(--black);border-color:var(--bone)}

  /* ── grid ── */
  section{padding:52px 0}
  .sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:26px;flex-wrap:wrap}
  .sec-head h2{font-size:23px;font-weight:600;letter-spacing:-.01em}
  .sec-head .count{font-family:var(--mono);font-size:12px;color:var(--mut);letter-spacing:.06em}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:22px}

  .tile{background:var(--ink);border:1px solid var(--hair);border-radius:16px;overflow:hidden;cursor:pointer;transition:transform .18s,border-color .18s;display:flex;flex-direction:column}
  .tile:hover{transform:translateY(-3px);border-color:var(--hair2)}
  .cover{position:relative;aspect-ratio:16/10;padding:14px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
  .cover::after{content:'';position:absolute;inset:0;background:linear-gradient(160deg,var(--a),var(--b));opacity:.92;z-index:0}
  .cover::before{content:'';position:absolute;inset:0;background:radial-gradient(80% 60% at 80% 10%,rgba(255,255,255,.18),transparent 60%);z-index:1}
  .cover > *{position:relative;z-index:2}
  .cover .cat{align-self:flex-start;font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;background:rgba(10,10,11,.5);backdrop-filter:blur(4px);color:#fff;padding:5px 11px;border-radius:99px}
  .cover .ct{font-family:var(--stamp);font-size:clamp(24px,3vw,34px);line-height:.92;color:#fff;letter-spacing:.01em;text-shadow:0 2px 20px rgba(0,0,0,.35);max-width:90%}
  .cover .wknd{position:absolute;top:14px;right:14px;z-index:2;font-family:var(--mono);font-size:9px;letter-spacing:.14em;background:var(--blue);color:#fff;padding:5px 10px;border-radius:99px}
  .info{padding:16px 17px 17px;display:flex;flex-direction:column;flex:1}
  .info h3{font-size:16.5px;font-weight:600;letter-spacing:-.01em;line-height:1.2}
  .info .art{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.04em;margin-top:5px}
  .info .meta{font-family:var(--mono);font-size:11.5px;color:var(--mut2);letter-spacing:.03em;margin-top:12px;line-height:1.8}
  .info .meta .ic{color:var(--mut);margin-right:7px}
  .info .foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--hair)}
  .info .price{font-family:var(--mono);font-size:13px}
  .info .price small{color:var(--mut);font-size:10px;letter-spacing:.1em;display:block}
  .info .price b{font-weight:500;font-size:15px}
  .get{background:var(--blue);color:var(--bone);border:none;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.1em;padding:11px 18px;border-radius:99px;cursor:pointer;transition:background .2s;white-space:nowrap}
  .get:hover{background:var(--bone);color:var(--black)}

  .empty{text-align:center;padding:70px 20px;color:var(--mut);font-family:var(--mono);font-size:13px;letter-spacing:.06em}
  .empty b{color:var(--bone);font-weight:500}

  /* ── KULTUR banner ── */
  .kultur{position:relative;margin:20px 0;border-radius:22px;overflow:hidden;border:1px solid #3a1c10}
  .kultur-bg{position:absolute;inset:0;background:linear-gradient(120deg,#1a0d06,#0A0A0B 60%),radial-gradient(90% 120% at 10% 10%,rgba(255,90,31,.4),transparent 55%);z-index:0}
  .kultur-bg::after{content:'';position:absolute;inset:0;background:radial-gradient(60% 80% at 85% 90%,rgba(255,90,31,.22),transparent 60%);animation:kb 9s ease-in-out infinite alternate}
  @keyframes kb{from{opacity:.5;transform:scale(1)}to{opacity:1;transform:scale(1.15)}}
  .kultur-in{position:relative;z-index:2;display:grid;grid-template-columns:1.5fr auto;gap:32px;align-items:center;padding:52px 44px}
  @media(max-width:820px){.kultur-in{grid-template-columns:1fr;gap:30px;padding:38px 26px}}
  .kultur .tagpre{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--orange);margin-bottom:18px}
  .kultur .big{font-family:var(--stamp);font-size:clamp(48px,8vw,104px);line-height:.86;letter-spacing:.01em;color:var(--bone)}
  .kultur .big .div{display:block;font-size:clamp(15px,1.6vw,19px);font-family:var(--mono);letter-spacing:.24em;color:var(--orange);margin-top:16px}
  .kultur .flag{font-size:clamp(17px,2vw,21px);color:var(--mut2);margin-top:22px;max-width:34ch;line-height:1.45}
  .kultur .flag b{color:var(--bone);font-weight:500}
  .kultur .cta-row{display:flex;gap:12px;margin-top:30px;flex-wrap:wrap}
  .k-btn{font-family:var(--mono);font-size:12px;letter-spacing:.1em;padding:14px 26px;border-radius:99px;cursor:pointer;border:1px solid var(--orange);background:var(--orange);color:#0A0A0B;transition:all .2s}
  .k-btn:hover{background:transparent;color:var(--orange)}
  .k-btn.ghost{background:transparent;color:var(--orange)}
  .k-btn.ghost:hover{background:var(--orange);color:#0A0A0B}
  .kultur .qr-card{display:block;text-decoration:none;color:inherit;background:#0A0A0B;border:1px solid #3a1c10;border-radius:16px;padding:20px;text-align:center;width:180px;justify-self:end}
  @media(max-width:820px){.kultur .qr-card{justify-self:start}}
  .kultur .qr-card .qr{width:130px;height:130px;margin:0 auto;background:#fff;border-radius:8px;padding:8px}
  .kultur .qr-card .qlabel{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;color:var(--orange);margin-top:14px;line-height:1.5}

  /* ── organize CTA ── */
  .organize{margin:36px 0 10px;border:1px solid var(--hair);border-radius:22px;background:linear-gradient(150deg,var(--ink2),var(--black));padding:64px 44px;text-align:center}
  @media(max-width:620px){.organize{padding:44px 24px}}
  .organize .pre{font-family:var(--mono);font-size:11.5px;letter-spacing:.24em;color:var(--blue);margin-bottom:20px}
  .organize h2{font-size:clamp(28px,4.5vw,50px);font-weight:600;letter-spacing:-.025em;line-height:1.05;max-width:20ch;margin:0 auto}
  .organize p{color:var(--mut2);font-size:16px;margin-top:20px;max-width:48ch;margin-left:auto;margin-right:auto}
  .big-btn{display:inline-flex;align-items:center;gap:12px;margin-top:34px;background:var(--bone);color:var(--black);font-family:var(--mono);font-size:14px;font-weight:500;letter-spacing:.08em;padding:20px 40px;border-radius:99px;transition:all .2s}
  .big-btn:hover{background:var(--blue);color:var(--bone);transform:translateY(-2px)}
  .big-btn .g{width:20px;height:20px}
  .organize .fine{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.06em;margin-top:18px}

  /* ── footer ── */
  footer{border-top:1px solid var(--hair);padding:44px 0;margin-top:40px}
  .foot{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
  .foot .cols{display:flex;gap:36px;font-family:var(--mono);font-size:12px;color:var(--mut)}
  .foot .cols a:hover{color:var(--bone)}
  .foot .legal{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.06em}

  /* ── ticket sheet ── */
  .sheet{position:fixed;inset:0;background:rgba(5,5,6,.6);backdrop-filter:blur(5px);display:none;align-items:flex-end;justify-content:center;z-index:90}
  .sheet.on{display:flex}
  @media(min-width:640px){.sheet{align-items:center}}
  .tk{background:var(--ink);border:1px solid var(--hair2);width:100%;max-width:440px;border-radius:20px 20px 0 0;overflow:hidden}
  @media(min-width:640px){.tk{border-radius:18px}}
  .tk .tk-cover{aspect-ratio:16/9;padding:18px;display:flex;flex-direction:column;justify-content:flex-end;position:relative;overflow:hidden}
  .tk .tk-cover::after{content:'';position:absolute;inset:0;background:linear-gradient(160deg,var(--a,#3D5AFE),var(--b,#101012));opacity:.92;z-index:0}
  .tk .tk-cover > *{position:relative;z-index:1}
  .tk .tk-cover .x{position:absolute;top:14px;right:14px;z-index:2;background:rgba(10,10,11,.5);border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer}
  .tk .tk-cover .tt{font-family:var(--stamp);font-size:30px;line-height:.95;color:#fff}
  .tk .tk-body{padding:22px}
  .tk .tk-meta{font-family:var(--mono);font-size:12px;color:var(--mut2);letter-spacing:.03em;line-height:2}
  .tk .honest{border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);margin:18px 0;padding:16px 0;display:flex;justify-content:space-between;align-items:baseline}
  .tk .honest .l{color:var(--mut);font-family:var(--mono);font-size:12px}
  .tk .honest .p{font-family:var(--mono);font-size:24px;font-weight:500}
  .tk .nofee{font-family:var(--mono);font-size:10.5px;color:var(--mut);letter-spacing:.04em;text-align:center;margin-bottom:16px}
  .tk .nofee b{color:var(--bone);font-weight:500}
  .tk .tk-pay{width:100%;background:var(--blue);color:var(--bone);border:none;font-family:var(--mono);font-size:13px;font-weight:500;letter-spacing:.12em;padding:16px;border-radius:12px;cursor:pointer;transition:background .2s}
  .tk .tk-pay:hover{background:var(--bone);color:var(--black)}
  .tk .methods{display:flex;justify-content:center;gap:14px;margin-top:14px;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;color:var(--mut);flex-wrap:wrap}

  .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bone);color:var(--black);font-family:var(--mono);font-size:12px;letter-spacing:.08em;padding:13px 24px;border-radius:99px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:99;text-align:center;max-width:90vw}
  .toast.show{opacity:1}

  /* ── featured card ── */
  .featured{padding:24px 0 4px}
  .feat-card{display:grid;grid-template-columns:1.05fr 1fr;border:1px solid var(--hair2);border-radius:20px;overflow:hidden;background:var(--ink);cursor:pointer;transition:border-color .2s,transform .2s}
  .feat-card:hover{border-color:var(--blue);transform:translateY(-2px)}
  @media(max-width:760px){.feat-card{grid-template-columns:1fr}}
  .feat-media{position:relative;min-height:240px;overflow:hidden;background:linear-gradient(150deg,var(--a,#1E4FD8),#0A0A0B)}
  .feat-media::before{content:'';position:absolute;inset:0;background:radial-gradient(70% 80% at 82% 8%,rgba(255,255,255,.16),transparent 60%)}
  .feat-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .5s}
  .feat-media img.loaded{opacity:1}
  .feat-body{padding:32px 34px;display:flex;flex-direction:column;justify-content:center}
  .feat-badge{align-self:flex-start;font-family:var(--mono);font-size:10px;letter-spacing:.16em;background:var(--orange);color:#0A0A0B;padding:6px 12px;border-radius:99px;margin-bottom:16px;display:inline-flex;align-items:center;gap:7px}
  .feat-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:#0A0A0B}
  .feat-title{font-family:var(--stamp);font-size:clamp(30px,5vw,54px);line-height:.92;letter-spacing:.01em}
  .feat-art{font-family:var(--mono);font-size:12px;color:var(--mut2);letter-spacing:.04em;margin-top:10px}
  .feat-meta{font-family:var(--mono);font-size:12px;color:var(--mut);letter-spacing:.04em;margin-top:14px}
  .feat-row{display:flex;align-items:center;gap:16px;margin-top:24px;flex-wrap:wrap}
  .feat-price{font-family:var(--mono);font-size:14px;color:var(--bone)}
  .feat-get{font-family:var(--mono);font-size:11px;letter-spacing:.1em;background:var(--blue);color:var(--bone);padding:12px 22px;border-radius:99px}

  /* chat widget */
  .zbot{position:fixed;right:22px;bottom:22px;z-index:80;font-family:var(--sans)}
  .zbot-fab{display:flex;align-items:center;gap:9px;background:var(--blue);color:var(--bone);border:none;border-radius:99px;padding:14px 20px;font-family:var(--mono);font-size:12px;letter-spacing:.08em;cursor:pointer;box-shadow:0 10px 30px rgba(61,90,254,.35);transition:transform .2s}
  .zbot-fab:hover{transform:translateY(-2px)}
  .zbot-fab svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2}
  .zbot-fab.hide{display:none}
  .zbot-panel{position:absolute;right:0;bottom:0;width:340px;max-width:calc(100vw - 44px);height:480px;max-height:calc(100vh - 44px);background:var(--ink);border:1px solid var(--hair2);border-radius:18px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  .zbot-panel.on{display:flex}
  .zbot-head{display:flex;align-items:center;gap:11px;padding:16px;border-bottom:1px solid var(--hair);background:var(--ink2)}
  .zbot-avatar{width:34px;height:34px;border-radius:50%;background:var(--blue);color:var(--bone);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:15px}
  .zbot-name{font-weight:500;font-size:14px}
  .zbot-status{font-family:var(--mono);font-size:10px;color:var(--mut);letter-spacing:.04em;display:flex;align-items:center;gap:6px;margin-top:2px}
  .zbot-status .d{width:6px;height:6px;border-radius:50%;background:var(--guest,#2FA9A0)}
  .zbot-x{margin-left:auto;background:none;border:none;color:var(--mut);font-size:22px;cursor:pointer;line-height:1}
  .zbot-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
  .zmsg{max-width:82%;padding:11px 14px;border-radius:14px;font-size:13.5px;line-height:1.5}
  .zmsg.bot{background:var(--ink2);border:1px solid var(--hair);align-self:flex-start;border-bottom-left-radius:4px}
  .zmsg.me{background:var(--blue);color:var(--bone);align-self:flex-end;border-bottom-right-radius:4px}
  .zbot-quick{display:flex;flex-wrap:wrap;gap:7px;padding:0 16px 12px}
  .zq{font-family:var(--mono);font-size:11px;letter-spacing:.03em;background:var(--ink2);border:1px solid var(--hair2);color:var(--mut2);padding:8px 12px;border-radius:99px;cursor:pointer}
  .zq:hover{border-color:var(--blue);color:var(--bone)}
  .zbot-input{display:flex;gap:8px;padding:12px;border-top:1px solid var(--hair)}
  .zbot-input input{flex:1;background:var(--black);border:1px solid var(--hair2);border-radius:10px;color:var(--bone);font-size:13.5px;padding:11px 13px;outline:none}
  .zbot-input input:focus{border-color:var(--blue)}
  .zbot-input button{background:var(--blue);border:none;border-radius:10px;width:42px;color:var(--bone);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .zbot-input button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2}
`;

export default function DiscoverPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Anton&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <DiscoverApp />
    </>
  );
}
