import type { Metadata } from 'next';
import { DiscoverApp } from './discover-app';

/* /discover — the marketplace. The whole body is interactive (city menu, chips,
   search, /api/events, ticket sheet, ZBot, placements) so it lives in
   <DiscoverApp> (client); this server shell carries the metadata, the per-page
   fonts and the scoped <style> block.

   BS37: restyled onto the CONSUMER plane of DESIGN.md — the dark cinematic
   language of the apex home (BS27). Everything is scoped under the `.zd` root
   class (this repo uses NO Tailwind; every page owns a self-contained style
   block), and the page is FIXED-DARK like every other consumer surface, so it
   does not read the light/dark token theme. Its nav diverges from the shared
   SiteNav, so the marketing layout omits SiteNav for /discover (see
   marketing-chrome.tsx). */

export const metadata: Metadata = {
  title: 'ZORA — Find your night',
  description:
    'Every event worth being at, near you. Concerts, festivals, nightlife and daytime — one honest price, and Zora adds no booking fee.',
};

const CSS = `
/* ══ /discover — consumer dark (DESIGN.md Consumer plane) ══════════════════ */
.zd{
  --bg:#08080A; --bg2:#0A0B10; --surface:#11131E; --surface2:#171A28;
  --text:#EDEFF7; --text2:#9BA3C4; --text3:#5C6488;
  --hair:rgba(124,160,255,.12); --hair2:rgba(124,160,255,.22);
  --blue:#4C6FFF; --ice:#7CA0FF; --cyan:#3FE0FF;
  --aura:linear-gradient(130deg,#D53AD8,#FF4D7D,#FF9145);
  --display:'Space Grotesk',system-ui,sans-serif;
  --sans:'Inter',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,monospace;
  --stamp:'Anton',var(--display);
  position:relative; min-height:100vh; background:var(--bg); color:var(--text);
  font-family:var(--sans); font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
}
.zd *{margin:0;padding:0;box-sizing:border-box}
.zd a{color:inherit;text-decoration:none}
/* NOTE: no background/border reset here — a ".zd button" rule outranks the
   single-class component rules below and would strip their pills. Each button
   sets its own background+border explicitly instead. */
.zd button,.zd input{font:inherit;color:inherit}
.zd ::selection{background:rgba(236,63,126,.32);color:#fff}
.zd :focus-visible{outline:2px solid var(--ice);outline-offset:2px;border-radius:8px}
.zd-wrap{width:100%;max-width:1180px;margin:0 auto;padding:0 20px}
@media(min-width:768px){.zd-wrap{padding:0 28px}}

/* ── ambient layers (decorative, behind everything) ── */
.zd-bg{position:fixed;inset:0;z-index:0;background:var(--bg);pointer-events:none}
.zd-layer{position:fixed;inset:0;z-index:0;pointer-events:none}
.zd-layer-1{background:radial-gradient(circle at 18% 6%,rgba(236,63,126,.11),transparent 46%);animation:zdBreathe 9s ease-in-out infinite}
.zd-layer-2{background:radial-gradient(circle at 84% 24%,rgba(168,85,247,.09),transparent 44%)}
.zd-layer-3{background:radial-gradient(circle at 48% 96%,rgba(247,146,47,.06),transparent 46%)}
.zd-canvas{position:fixed;inset:0;z-index:0;width:100%;height:100%;pointer-events:none}
.zd-cursor{position:fixed;left:0;top:0;z-index:1;pointer-events:none}
.zd-cursor-in{width:560px;height:560px;transform:translate(-50%,-50%);border-radius:50%;opacity:.5;filter:blur(120px);background:radial-gradient(circle,rgba(236,63,126,.18),rgba(168,85,247,.10) 42%,transparent 70%)}
.zd-grain{position:fixed;inset:0;z-index:2;opacity:.035;mix-blend-mode:soft-light;pointer-events:none}
.zd-vignette{position:fixed;inset:0;z-index:2;pointer-events:none;background:radial-gradient(circle at 50% 42%,transparent 46%,rgba(0,0,0,.72))}

/* ── nav ── */
.zd-nav{position:sticky;top:0;z-index:60;background:rgba(8,8,10,.78);backdrop-filter:blur(14px);border-bottom:1px solid var(--hair)}
.zd-nav-in{display:flex;align-items:center;gap:10px;min-height:64px}
@media(min-width:768px){.zd-nav-in{gap:16px}}
.zd-brand{display:inline-flex;align-items:center;gap:9px;min-height:44px;flex-shrink:0}
.zd-orb{border-radius:50%;display:block;flex-shrink:0}
.zd-brand-t{font-family:var(--display);font-weight:700;font-size:16px;letter-spacing:.2em}

.zd-loc{position:relative;flex-shrink:1;min-width:0}
.zd-loc-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border-radius:99px;background:rgba(23,26,40,.72);border:1px solid var(--hair);cursor:pointer;font-size:13.5px;max-width:100%;transition:border-color .2s}
.zd-loc-btn:hover{border-color:var(--hair2)}
.zd-pin{width:7px;height:7px;border-radius:50%;background:var(--ice);box-shadow:0 0 10px rgba(124,160,255,.9);flex-shrink:0}
.zd-city{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zd-detecting{font-family:var(--mono);font-size:12px;color:var(--text2);white-space:nowrap}
.zd-chev{color:var(--text3);font-size:11px}
.zd-loc-menu{position:absolute;top:52px;left:0;min-width:240px;background:rgba(17,19,30,.97);backdrop-filter:blur(14px);border:1px solid var(--hair2);border-radius:16px;padding:8px;display:none;box-shadow:0 24px 60px rgba(0,0,0,.6);z-index:70}
.zd-loc-menu.on{display:block}
.zd-lm-h{font-family:var(--mono);font-size:11.5px;letter-spacing:.18em;color:var(--text2);padding:8px 12px 8px}
.zd-loc-opt{display:flex;width:100%;align-items:center;justify-content:space-between;gap:14px;min-height:44px;padding:0 12px;border:none;background:transparent;border-radius:10px;cursor:pointer;font-size:14px;text-align:left}
.zd-loc-opt:hover{background:rgba(124,160,255,.08)}
.zd-co{font-family:var(--mono);font-size:11.5px;color:var(--text2)}
.zd-loc-opt.on{color:var(--ice)}
.zd-loc-opt.on .zd-co{color:var(--ice)}

.zd-navsearch{display:none;position:relative;flex:1;max-width:400px}
@media(min-width:940px){.zd-navsearch{display:block}}
.zd-navsearch input{width:100%;min-height:44px;background:rgba(23,26,40,.6);border:1px solid var(--hair);border-radius:99px;font-size:14px;padding:0 16px 0 42px;outline:none;transition:border-color .2s}
.zd-navsearch input:focus{border-color:var(--blue)}
.zd-navsearch input::placeholder{color:var(--text3)}
.zd-mag{position:absolute;left:16px;top:50%;transform:translateY(-50%);width:15px;height:15px;stroke:var(--text3);fill:none;stroke-width:2;pointer-events:none}
/* the shared floating <ThemeToggle> is fixed at top-right (40px + 16px gutter);
   keep the nav's own controls clear of it until the page gutters are wide enough */
.zd-nav-right{display:flex;align-items:center;gap:16px;margin-left:auto}
@media(min-width:640px) and (max-width:1300px){.zd-nav-right{margin-right:48px}}
.zd-link{display:none}
@media(min-width:940px){.zd-link{display:inline-flex;align-items:center;min-height:44px;font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--text2);transition:color .2s}.zd-link:hover{color:var(--text)}}
.zd-ghost-btn{display:none}
@media(min-width:640px){.zd-ghost-btn{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:99px;border:1px solid var(--hair2);font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;color:var(--text);white-space:nowrap;transition:border-color .2s,background .2s}.zd-ghost-btn:hover{border-color:var(--ice);background:rgba(124,160,255,.08)}}

/* ── hero ── */
.zd-hero{position:relative;z-index:10}
.zd-hero-in{padding:44px 20px 34px}
@media(min-width:768px){.zd-hero-in{padding:86px 28px 58px}}
.zd-now{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;color:var(--text2);background:rgba(23,26,40,.6);border:1px solid var(--hair);border-radius:99px;padding:9px 15px}
.zd-now b{color:var(--text);font-weight:500}
.zd-live-dot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 10px rgba(63,224,255,.8);animation:zdPulse 1.8s ease-in-out infinite}
.zd-h1{font-family:var(--display);font-weight:700;font-size:clamp(42px,9vw,84px);line-height:.98;letter-spacing:-.03em;text-transform:lowercase;margin-top:22px}
.zd-subline{color:var(--text2);font-size:15px;line-height:1.62;margin-top:18px;max-width:58ch}
.zd-subline b{color:var(--text);font-weight:600}
.zd-herosearch{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px;max-width:620px}
.zd-box{position:relative;flex:1;min-width:210px}
.zd-box input{width:100%;min-height:54px;background:rgba(23,26,40,.66);border:1px solid var(--hair2);border-radius:14px;font-size:15px;padding:0 44px 0 46px;outline:none;transition:border-color .2s,box-shadow .2s}
.zd-box input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(76,111,255,.18)}
.zd-box input::placeholder{color:var(--text3)}
.zd-box .zd-mag{left:17px;width:18px;height:18px}
.zd-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:44px;height:44px;border:none;background:transparent;border-radius:50%;color:var(--text2);font-size:22px;line-height:1;cursor:pointer}
.zd-clear:hover{color:var(--text)}
.zd-go{min-height:54px;padding:0 26px;border-radius:14px;background:rgba(76,111,255,.16);border:1px solid rgba(76,111,255,.5);color:#C9D6FF;font-family:var(--mono);font-size:12px;letter-spacing:.12em;cursor:pointer;transition:background .2s,color .2s}
.zd-go:hover:not(:disabled){background:var(--blue);color:#fff}
@media(max-width:520px){.zd-go{width:100%}}
.zd-go:disabled{color:var(--text3);border-color:var(--hair2);border-style:dashed;background:transparent;cursor:not-allowed}

/* ── featured ── */
.zd-featured{position:relative;z-index:10;padding:8px 0 4px}
.zd-feat{display:grid;grid-template-columns:1fr;border:1px solid var(--hair);border-radius:20px;overflow:hidden;background:rgba(13,15,23,.62);backdrop-filter:blur(10px);transition:border-color .2s,transform .2s}
.zd-feat:hover{border-color:var(--hair2);transform:translateY(-2px)}
@media(min-width:860px){.zd-feat{grid-template-columns:1.05fr 1fr}}
.zd-feat-media{position:relative;min-height:210px;overflow:hidden;background:linear-gradient(150deg,var(--a,#123067),#0A0B10)}
.zd-feat-media::before{content:'';position:absolute;inset:0;z-index:2;background:linear-gradient(180deg,rgba(8,8,10,0) 45%,rgba(8,8,10,.55))}
.zd-feat-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .5s}
.zd-feat-media img.loaded{opacity:1}
.zd-feat-body{padding:26px 22px 28px;display:flex;flex-direction:column;justify-content:center}
@media(min-width:768px){.zd-feat-body{padding:34px}}
.zd-feat-badge{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:#BFD0FF;background:rgba(76,111,255,.14);border:1px solid rgba(76,111,255,.45);padding:6px 12px;border-radius:99px;margin-bottom:16px}
.zd-feat-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--cyan)}
.zd-feat-title{font-family:var(--display);font-weight:700;font-size:clamp(26px,4.6vw,46px);line-height:1.02;letter-spacing:-.025em}
.zd-feat-art{font-size:14px;color:var(--text2);margin-top:10px}
.zd-feat-meta{font-family:var(--mono);font-size:12px;letter-spacing:.04em;color:var(--text2);margin-top:12px}
.zd-feat-row{display:flex;align-items:center;gap:14px;margin-top:22px;flex-wrap:wrap}
.zd-feat-price{font-family:var(--mono);font-size:14px;color:var(--text)}
.zd-feat-get{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:99px;background:rgba(76,111,255,.16);border:1px solid rgba(76,111,255,.5);color:#C9D6FF;font-family:var(--mono);font-size:11.5px;letter-spacing:.1em}
.zd-feat:hover .zd-feat-get{background:var(--blue);color:#fff}

/* ── filters ── */
.zd-filters{position:sticky;top:64px;z-index:50;background:rgba(8,8,10,.8);backdrop-filter:blur(12px);border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);margin-top:22px}
.zd-filters-in{display:flex;gap:8px;padding-top:10px;padding-bottom:10px;overflow-x:auto;scrollbar-width:none}
.zd-filters-in::-webkit-scrollbar{display:none}
.zd-chip{display:inline-flex;align-items:center;white-space:nowrap;min-height:44px;padding:0 18px;border-radius:99px;background:rgba(23,26,40,.6);border:1px solid var(--hair);color:var(--text2);font-family:var(--mono);font-size:12px;letter-spacing:.06em;cursor:pointer;transition:color .18s,border-color .18s,background .18s}
.zd-chip:hover:not(:disabled){color:var(--text);border-color:var(--hair2)}
.zd-chip.on{background:rgba(124,160,255,.14);border-color:var(--ice);color:#DCE5FF}
.zd-chip:disabled{opacity:.45;cursor:not-allowed}

/* ── sections + grid ── */
.zd-sec{position:relative;z-index:10;padding:38px 0}
@media(min-width:768px){.zd-sec{padding:52px 0}}
.zd-sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:22px}
.zd-sec-head h2{font-family:var(--display);font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-.015em}
.zd-sec-head-2{margin-top:44px}
.zd-count{font-family:var(--mono);font-size:12px;letter-spacing:.1em;color:var(--text2)}
.zd-grid{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:600px){.zd-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1000px){.zd-grid{grid-template-columns:repeat(3,1fr);gap:20px}}

/* card — cover-forward */
.zd-card{display:flex;flex-direction:column;border:1px solid var(--hair);border-radius:18px;overflow:hidden;background:rgba(13,15,23,.62);backdrop-filter:blur(10px);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.zd-card:hover,.zd-card:focus-visible{transform:translateY(-3px);border-color:var(--hair2);box-shadow:0 18px 40px rgba(0,0,0,.45)}
.zd-cover{position:relative;aspect-ratio:16/10;overflow:hidden;display:flex;align-items:flex-end;padding:13px;background:linear-gradient(155deg,var(--a),var(--b))}
.zd-cover::after{content:'';position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(8,8,10,0) 38%,rgba(8,8,10,.8))}
.zd-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
/* no cover art: the name IS the poster — set big and soft so it reads as
   artwork behind the card's own title line, not as a duplicated label */
.zd-cover-word{position:relative;z-index:2;font-family:var(--display);font-weight:700;font-size:clamp(26px,5vw,34px);line-height:1;letter-spacing:-.035em;color:rgba(237,239,247,.62);max-width:94%;text-transform:uppercase}
.zd-cat{position:absolute;top:12px;left:12px;z-index:2;font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;color:#D9DEF2;background:rgba(8,8,10,.55);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,.1);padding:5px 10px;border-radius:99px}
.zd-badges{position:absolute;top:12px;right:12px;z-index:2;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.zd-badge{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;padding:5px 10px;border-radius:99px;white-space:nowrap;backdrop-filter:blur(6px)}
.zd-badge-wknd{background:rgba(76,111,255,.92);color:#fff}
.zd-badge-split{background:rgba(6,32,40,.82);border:1px solid rgba(63,224,255,.6);color:#8FEFFF}
.zd-card-body{display:flex;flex-direction:column;flex:1;gap:7px;padding:14px 15px 15px}
.zd-card-t{font-family:var(--display);font-size:17px;font-weight:600;line-height:1.22;letter-spacing:-.012em}
.zd-card-art{font-size:13px;color:var(--text2);line-height:1.45}
.zd-card-meta{display:flex;flex-direction:column;gap:3px;font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;margin-top:2px}
.zd-when{color:var(--text2)}
.zd-where{color:#8B93B4}
.zd-card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:13px;border-top:1px solid var(--hair)}
.zd-price{display:flex;flex-direction:column;gap:2px;font-family:var(--mono)}
.zd-price small{font-size:11.5px;letter-spacing:.16em;color:var(--text2)}
.zd-price b{font-size:15px;font-weight:500;color:var(--text)}
.zd-get{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:99px;background:rgba(76,111,255,.16);border:1px solid rgba(76,111,255,.5);color:#C9D6FF;font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;white-space:nowrap;transition:background .2s,color .2s}
.zd-card:hover .zd-get{background:var(--blue);color:#fff}

/* loading skeletons */
.zd-skel{border:1px solid var(--hair);border-radius:18px;overflow:hidden;background:rgba(13,15,23,.5)}
.zd-skel-cover{aspect-ratio:16/10}
.zd-skel-body{display:flex;flex-direction:column;gap:11px;padding:16px 15px 20px}
.zd-skel-line{display:block;height:11px;border-radius:6px}
.zd-skel-cover,.zd-skel-line{background:linear-gradient(90deg,rgba(124,160,255,.05),rgba(124,160,255,.16),rgba(124,160,255,.05));background-size:220% 100%;animation:zdShimmer 1.5s linear infinite}
.zd-skel-w80{width:80%}.zd-skel-w65{width:65%}.zd-skel-w50{width:50%}.zd-skel-w40{width:40%}

/* empty / error states */
.zd-state{grid-column:1/-1;text-align:center;padding:52px 22px;border:1px dashed var(--hair2);border-radius:20px;background:rgba(13,15,23,.5)}
.zd-state-h{font-family:var(--display);font-size:clamp(19px,2.6vw,24px);font-weight:600;letter-spacing:-.015em}
.zd-state-p{margin:10px auto 0;max-width:52ch;font-size:14px;color:var(--text2)}
.zd-state-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:20px;padding:0 20px;border-radius:99px;background:rgba(76,111,255,.16);border:1px solid rgba(76,111,255,.5);color:#C9D6FF;font-family:var(--mono);font-size:12px;letter-spacing:.12em;cursor:pointer;transition:background .2s,color .2s}
.zd-state-btn:hover{background:var(--blue);color:#fff}
.zd-state-cities{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:18px}
.zd-state-cities .zd-state-btn{margin-top:0}
.zd-state-btn.zd-ghost{background:transparent;border-color:var(--hair2);color:var(--text2)}
.zd-state-btn.zd-ghost:hover{border-color:var(--ice);color:var(--text);background:rgba(124,160,255,.08)}
.zd-state-err{border-style:solid;border-color:rgba(255,120,120,.34);background:rgba(40,14,16,.34)}
.zd-state-err .zd-state-h{color:#FFB9B9}

/* ── KULTUR ── */
.zd-kultur{position:relative;margin:34px 0 0;border-radius:22px;overflow:hidden;border:1px solid rgba(247,146,47,.22)}
.zd-kultur-bg{position:absolute;inset:0;z-index:0;background:radial-gradient(90% 120% at 12% 6%,rgba(247,146,47,.18),transparent 58%),linear-gradient(140deg,#150C07,#0A0B10 64%)}
.zd-kultur-in{position:relative;z-index:2;display:grid;grid-template-columns:1fr;gap:28px;padding:34px 22px}
@media(min-width:860px){.zd-kultur-in{grid-template-columns:1.5fr auto;align-items:center;padding:52px 44px}}
.zd-tagpre{font-family:var(--mono);font-size:11.5px;letter-spacing:.26em;color:#F7A45B;margin-bottom:16px}
.zd-big{font-family:var(--stamp);font-size:clamp(44px,8vw,96px);line-height:.88;letter-spacing:.01em}
.zd-div{display:block;font-family:var(--mono);font-size:clamp(12px,1.5vw,15px);letter-spacing:.22em;color:#F7A45B;margin-top:16px;line-height:1.5}
.zd-flag{font-size:clamp(16px,2vw,20px);color:var(--text2);margin-top:20px;max-width:36ch;line-height:1.5}
.zd-flag b{color:var(--text);font-weight:600}
.zd-cta-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
.zd-k-btn{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:99px;border:1px solid rgba(247,146,47,.55);background:rgba(247,146,47,.14);color:#FFC489;font-family:var(--mono);font-size:12px;letter-spacing:.1em;cursor:pointer;transition:background .2s,color .2s}
.zd-k-btn:hover{background:rgba(247,146,47,.9);color:#0A0B10}
.zd-k-btn.zd-ghost{background:transparent}
.zd-qr-card{display:block;justify-self:start;width:184px;padding:18px;border-radius:16px;border:1px solid rgba(247,146,47,.22);background:rgba(8,8,10,.55);text-align:center}
@media(min-width:860px){.zd-qr-card{justify-self:end}}
.zd-qr{width:130px;height:130px;margin:0 auto;background:#fff;border-radius:10px;padding:8px}
.zd-qlabel{font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:#F7A45B;margin-top:14px;line-height:1.6}

/* ── organizer CTA (the page's PRIMARY action — the one aura button) ── */
.zd-organize{position:relative;overflow:hidden;border:1px solid var(--hair);border-radius:24px;background:linear-gradient(160deg,rgba(23,26,40,.75),rgba(10,11,16,.8));backdrop-filter:blur(10px);padding:44px 22px;text-align:center}
@media(min-width:768px){.zd-organize{padding:66px 44px}}
.zd-organize::before{content:'';position:absolute;left:50%;top:-160px;width:520px;height:320px;transform:translateX(-50%);pointer-events:none;background:radial-gradient(closest-side,rgba(236,63,126,.14),transparent)}
.zd-pre{position:relative;font-family:var(--mono);font-size:11.5px;letter-spacing:.24em;color:var(--ice);margin-bottom:18px}
.zd-organize h2{position:relative;font-family:var(--display);font-size:clamp(27px,4.6vw,46px);font-weight:700;letter-spacing:-.03em;line-height:1.05;max-width:20ch;margin:0 auto}
.zd-org-p{position:relative;margin:18px auto 0;max-width:52ch;font-size:15px;color:var(--text2);line-height:1.6}
.zd-aura-btn{position:relative;display:inline-flex;align-items:center;gap:12px;min-height:56px;margin-top:28px;padding:0 26px;border-radius:99px;background:var(--aura);color:#120409;font-weight:600;font-size:15px;box-shadow:0 14px 40px rgba(213,58,216,.26);transition:transform .2s,box-shadow .2s}
.zd-aura-btn:hover{transform:translateY(-2px);box-shadow:0 18px 50px rgba(213,58,216,.36)}
.zd-gwrap{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#fff;flex-shrink:0}
.zd-gwrap svg{width:16px;height:16px}
.zd-fine{position:relative;font-family:var(--mono);font-size:11.5px;letter-spacing:.06em;color:var(--text2);margin-top:18px}

/* ── footer ── */
.zd-footer{position:relative;z-index:10;border-top:1px solid var(--hair);padding:30px 0 40px}
.zd-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}
.zd-cols{display:flex;flex-wrap:wrap;gap:20px;font-family:var(--mono);font-size:12px;color:var(--text2)}
.zd-cols a{display:inline-flex;align-items:center;min-height:44px;transition:color .2s}
.zd-cols a:hover{color:var(--text)}
.zd-legal{font-family:var(--mono);font-size:11.5px;letter-spacing:.06em;color:var(--text2)}

/* ── ticket sheet ── */
.zd-sheet{position:fixed;inset:0;z-index:90;display:none;align-items:flex-end;justify-content:center;background:rgba(4,4,6,.68);backdrop-filter:blur(6px)}
.zd-sheet.on{display:flex}
@media(min-width:640px){.zd-sheet{align-items:center;padding:20px}}
.zd-tk{width:100%;max-width:440px;max-height:92vh;overflow-y:auto;background:rgba(17,19,30,.97);border:1px solid var(--hair2);border-radius:22px 22px 0 0}
@media(min-width:640px){.zd-tk{border-radius:20px}}
.zd-tk-cover{position:relative;aspect-ratio:16/9;display:flex;align-items:flex-end;padding:16px;overflow:hidden;background:linear-gradient(155deg,var(--a),var(--b))}
.zd-tk-cover::after{content:'';position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(8,8,10,0) 40%,rgba(8,8,10,.82))}
.zd-tk-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.zd-tt{position:relative;z-index:2;font-family:var(--display);font-weight:700;font-size:clamp(22px,5.5vw,28px);line-height:1.05;letter-spacing:-.02em;color:#fff}
.zd-x{position:absolute;top:10px;right:10px;z-index:3;width:44px;height:44px;border-radius:50%;background:rgba(8,8,10,.6);border:1px solid var(--hair2);color:#fff;font-size:20px;cursor:pointer}
.zd-tk-body{padding:20px}
.zd-tk-meta{font-family:var(--mono);font-size:12px;letter-spacing:.03em;color:var(--text2);line-height:1.95}
.zd-tk-split{margin-top:12px;padding:9px 12px;border-radius:10px;border:1px solid rgba(63,224,255,.4);background:rgba(63,224,255,.08);color:#8FEFFF;font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;text-align:center}
.zd-honest{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:16px 0;padding:14px 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.zd-l{font-family:var(--mono);font-size:12px;color:var(--text2)}
.zd-p{font-family:var(--mono);font-size:24px;font-weight:500;color:var(--text)}
.zd-nofee{font-size:12px;line-height:1.6;color:var(--text2);text-align:center;margin-bottom:16px}
.zd-nofee b{color:var(--text);font-weight:600}
.zd-tk-pay{display:block;width:100%;min-height:54px;border:none;border-radius:14px;background:var(--aura);color:#120409;font-family:var(--mono);font-size:13px;font-weight:500;letter-spacing:.1em;cursor:pointer;box-shadow:0 12px 34px rgba(213,58,216,.24)}
.zd-methods{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;margin-top:14px;font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--text2)}

/* ── toast ── */
.zd-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99;max-width:92vw;text-align:center;padding:12px 20px;border-radius:99px;background:rgba(17,19,30,.94);border:1px solid var(--hair2);backdrop-filter:blur(10px);color:var(--text);font-family:var(--mono);font-size:12px;letter-spacing:.06em;opacity:0;pointer-events:none;transition:opacity .25s}
.zd-toast.show{opacity:1}

/* ── zbot (shared widget, consumer-dark skin) ── */
.zd .zbot{position:fixed;right:18px;bottom:18px;z-index:80;font-family:var(--sans)}
.zd .zbot-fab{display:flex;align-items:center;gap:9px;min-height:48px;padding:0 20px;border-radius:99px;background:rgba(23,26,40,.9);border:1px solid var(--hair2);backdrop-filter:blur(10px);color:var(--text);font-family:var(--mono);font-size:12px;letter-spacing:.08em;cursor:pointer;box-shadow:0 12px 32px rgba(0,0,0,.5);transition:transform .2s,border-color .2s}
.zd .zbot-fab:hover{transform:translateY(-2px);border-color:var(--ice)}
.zd .zbot-fab svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2}
.zd .zbot-fab.hide{display:none}
.zd .zbot-panel{position:absolute;right:0;bottom:0;width:340px;max-width:calc(100vw - 36px);height:480px;max-height:calc(100vh - 44px);background:rgba(17,19,30,.97);border:1px solid var(--hair2);border-radius:18px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.zd .zbot-panel.on{display:flex}
.zd .zbot-head{display:flex;align-items:center;gap:11px;padding:14px;border-bottom:1px solid var(--hair);background:rgba(23,26,40,.7)}
/* blue, not aura: the aura gradient is reserved for primary actions + the logo */
.zd .zbot-avatar{width:34px;height:34px;border-radius:50%;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px}
.zd .zbot-name{font-weight:600;font-size:14px}
.zd .zbot-status{display:flex;align-items:center;gap:6px;margin-top:2px;font-family:var(--mono);font-size:11px;color:var(--text2)}
.zd .zbot-status .d{width:6px;height:6px;border-radius:50%;background:var(--cyan)}
.zd .zbot-x{margin-left:auto;width:44px;height:44px;border:none;background:transparent;color:var(--text2);font-size:22px;line-height:1;cursor:pointer}
.zd .zbot-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.zd .zmsg{max-width:82%;padding:11px 14px;border-radius:14px;font-size:13.5px;line-height:1.5}
.zd .zmsg.bot{background:rgba(23,26,40,.9);border:1px solid var(--hair);align-self:flex-start;border-bottom-left-radius:4px}
.zd .zmsg.me{background:var(--blue);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
.zd .zbot-quick{display:flex;flex-wrap:wrap;gap:7px;padding:0 16px 12px}
.zd .zq{min-height:40px;padding:0 12px;border-radius:99px;background:rgba(23,26,40,.9);border:1px solid var(--hair2);color:var(--text2);font-family:var(--mono);font-size:11.5px;cursor:pointer}
.zd .zq:hover{border-color:var(--ice);color:var(--text)}
.zd .zbot-input{display:flex;gap:8px;padding:12px;border-top:1px solid var(--hair)}
.zd .zbot-input input{flex:1;min-height:44px;background:rgba(10,11,16,.9);border:1px solid var(--hair2);border-radius:10px;font-size:13.5px;padding:0 13px;outline:none}
.zd .zbot-input input:focus{border-color:var(--blue)}
.zd .zbot-input button{width:44px;min-height:44px;border:none;border-radius:10px;background:var(--blue);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}
.zd .zbot-input button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2}

/* ── motion ── */
@keyframes zdBreathe{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.12)}}
@keyframes zdPulse{0%,100%{opacity:1}50%{opacity:.28}}
@keyframes zdShimmer{to{background-position:-220% 0}}
@keyframes zoraShimmer{to{background-position:200% center}}
@keyframes zoraAura{0%,100%{filter:drop-shadow(0 0 6px rgba(236,63,126,.5)) drop-shadow(0 0 18px rgba(247,146,47,.3))}50%{filter:drop-shadow(0 0 14px rgba(236,63,126,.85)) drop-shadow(0 0 34px rgba(196,30,224,.5))}}
.zd .zora-aura{animation:zoraAura 3.6s ease-in-out infinite}
.zd .shimmer-text{background:linear-gradient(90deg,#f7922f,#ec3f7e,#c41ee0,#ec3f7e,#f7922f);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:zoraShimmer 4.5s linear infinite}

@media(prefers-reduced-motion:reduce){
  .zd .zora-aura,.zd .shimmer-text,.zd-layer-1,.zd-live-dot,.zd-skel-cover,.zd-skel-line{animation:none}
  .zd-skel-cover,.zd-skel-line{background:rgba(124,160,255,.1)}
  .zd-card,.zd-feat,.zd-aura-btn{transition:none}
  .zd-card:hover,.zd-feat:hover,.zd-aura-btn:hover{transform:none}
}
`;

export default function DiscoverPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Anton&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zd">
        <DiscoverApp />
      </div>
    </>
  );
}
