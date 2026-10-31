import type { Metadata } from 'next';
import { DiscoverApp } from './discover-app';

/* /discover — the marketplace. The whole body is interactive (city menu, chips,
   search, /api/events, pass sheet, ZBot, placements) so it lives in
   <DiscoverApp> (client); this server shell carries the metadata and the scoped
   <style> block.

   BS119: on the ZoraPass design system (docs/ZoraPass-Design-System-Handoff;
   DESIGN.md). Everything is scoped under the `.zd` root class (this repo uses NO
   Tailwind; every page owns a self-contained style block). The page is
   FIXED-LIGHT — bone ground, board-black ink, one yellow accent — so it uses
   the primitive --zp-color-* tokens rather than the theme-flipping semantic
   ones. Fonts load globally (app/layout.tsx). Its nav diverges from the shared
   SiteNav, so the marketing layout omits SiteNav for /discover (see
   marketing-chrome.tsx). */

export const metadata: Metadata = {
  title: "ZoraPass — What's on",
  description: 'Concerts, festivals, nights out and new experiences.',
};

const CSS = `
/* ══ /discover — ZoraPass consumer (bone · black · yellow, flat) ═══════════ */
.zd{
  --bg:var(--zp-color-bone); --raised:var(--zp-color-white); --sunken:#EFEDE4;
  --ink:var(--zp-color-board-black); --ink2:var(--zp-color-ink-600); --mut:var(--zp-color-ink-500);
  --line:var(--zp-color-line-light); --yellow:var(--zp-color-signal-yellow);
  --sans:var(--zp-font-family-sans); --display:var(--zp-font-family-display); --mono:var(--zp-font-family-mono);
  position:relative; min-height:100vh; background:var(--bg); color:var(--ink);
  font-family:var(--sans); font-size:16px; line-height:1.35; -webkit-font-smoothing:antialiased;
}
.zd *{margin:0;padding:0;box-sizing:border-box}
.zd a{color:inherit;text-decoration:none}
/* NOTE: no background/border reset here — a ".zd button" rule outranks the
   single-class component rules below. Each button sets its own background+border. */
.zd button,.zd input{font:inherit;color:inherit}
.zd ::selection{background:var(--yellow);color:var(--ink)}
.zd :focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.zd-wrap{width:100%;max-width:1200px;margin:0 auto;padding:0 16px}
@media(min-width:768px){.zd-wrap{padding:0 32px}}

/* ── header (64px, bone, 1px rule) ── */
.zd-nav{position:sticky;top:0;z-index:60;background:var(--bg);border-bottom:1px solid var(--line)}
.zd-nav-in{display:flex;align-items:center;gap:12px;min-height:64px}
@media(min-width:768px){.zd-nav-in{gap:24px}}
.zd-brand{display:inline-flex;align-items:center;min-height:44px;flex-shrink:0}

.zd-loc{position:relative;flex-shrink:1;min-width:0}
.zd-loc-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:999px;background:transparent;border:2px solid var(--ink);cursor:pointer;font-family:var(--mono);font-size:13px;letter-spacing:.08em;text-transform:uppercase;max-width:100%}
.zd-loc-btn:hover{background:var(--sunken)}
.zd-city{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zd-detecting{white-space:nowrap;color:var(--mut)}
.zd-chev{font-size:12px}
.zd-loc-menu{position:absolute;top:52px;left:0;min-width:260px;background:var(--raised);border:2px solid var(--ink);border-radius:16px;padding:8px;display:none;z-index:70}
.zd-loc-menu.on{display:block}
.zd-lm-h{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut);padding:8px 12px}
.zd-loc-opt{display:flex;width:100%;align-items:center;justify-content:space-between;gap:16px;min-height:44px;padding:0 12px;border:none;background:transparent;border-radius:12px;cursor:pointer;font-size:16px;text-align:left}
.zd-loc-opt:hover{background:var(--sunken)}
.zd-co{font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--mut)}
.zd-loc-opt.on{font-weight:700;background:var(--sunken)}

.zd-navsearch{display:none;position:relative;flex:1;max-width:400px}
@media(min-width:940px){.zd-navsearch{display:block}}
.zd-navsearch input{width:100%;height:44px;background:var(--raised);border:2px solid var(--line);border-radius:12px;font-size:16px;padding:0 16px 0 42px;outline:none}
.zd-navsearch input:focus{border-color:var(--ink)}
.zd-navsearch input::placeholder{color:var(--mut)}
.zd-mag{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:16px;height:16px;stroke:var(--mut);fill:none;stroke-width:2;pointer-events:none}
.zd-nav-right{display:flex;align-items:center;gap:24px;margin-left:auto}
.zd-link{display:none}
@media(min-width:940px){.zd-link{display:inline-flex;align-items:center;min-height:44px;font-size:16px;font-weight:500}.zd-link:hover{text-decoration:underline}}
.zd-ghost-btn{display:none}
@media(min-width:640px){.zd-ghost-btn{display:inline-flex;align-items:center;min-height:44px;font-size:16px;font-weight:700;white-space:nowrap}.zd-ghost-btn:hover{text-decoration:underline}}

/* ── hero: bone ground, WHAT'S ON? in Bungee, the ZORAPASS stamp at −10° ── */
.zd-hero{position:relative}
.zd-hero-in{position:relative;padding:40px 16px 32px}
@media(min-width:768px){.zd-hero-in{padding:64px 32px 48px}}
.zd-stamp{position:absolute;right:16px;top:24px;width:96px;height:96px;transform:rotate(-10deg)}
@media(min-width:768px){.zd-stamp{right:32px;top:48px;width:128px;height:128px}}
.zd-now{display:inline-block;font-family:var(--mono);font-size:13px;letter-spacing:.08em;color:var(--mut)}
.zd-now b{color:var(--ink);font-weight:600}
.zd-h1{font-family:var(--display);font-weight:400;font-size:clamp(40px,8vw,56px);line-height:.95;letter-spacing:0;margin-top:16px;max-width:calc(100% - 112px)}
.zd-subline{font-size:18px;line-height:1.35;margin-top:16px;max-width:52ch;color:var(--ink2)}
.zd-herosearch{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px;max-width:620px}
.zd-box{position:relative;flex:1;min-width:210px}
.zd-box input{width:100%;height:56px;background:var(--raised);border:2px solid var(--line);border-radius:12px;font-size:16px;padding:0 48px 0 46px;outline:none}
.zd-box input:focus{border-color:var(--ink)}
.zd-box input::placeholder{color:var(--mut)}
.zd-box .zd-mag{left:16px;width:18px;height:18px}
.zd-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:44px;height:44px;border:none;background:transparent;border-radius:12px;color:var(--mut);font-size:24px;line-height:1;cursor:pointer}
.zd-clear:hover{color:var(--ink)}
.zd-go{height:56px;padding:0 24px;border-radius:16px;background:transparent;border:2px solid var(--ink);color:var(--ink);font-family:var(--sans);font-weight:700;font-size:16px;cursor:pointer}
.zd-go:hover:not(:disabled){background:var(--sunken)}
@media(max-width:520px){.zd-go{width:100%}}
.zd-go:disabled{background:var(--zp-color-ink-300);border-color:var(--zp-color-ink-300);color:var(--mut);cursor:not-allowed}

/* ── featured ── */
.zd-featured{padding:8px 0 4px}
.zd-feat{display:grid;grid-template-columns:1fr;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--raised);transition:border-color 180ms}
.zd-feat:hover{border-color:var(--ink)}
@media(min-width:860px){.zd-feat{grid-template-columns:1fr 1fr}}
.zd-feat-media{position:relative;aspect-ratio:16/9;overflow:hidden;background:var(--ink)}
.zd-feat-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 240ms}
.zd-feat-media img.loaded{opacity:1}
.zd-feat-body{padding:24px 20px;display:flex;flex-direction:column;justify-content:center;gap:8px}
@media(min-width:768px){.zd-feat-body{padding:32px}}
.zd-feat-badge{align-self:flex-start;font-family:var(--mono);font-weight:500;font-size:12px;letter-spacing:.12em;padding:6px 12px;border-radius:999px;margin-bottom:8px}
.zd-feat-title{font-weight:800;font-size:clamp(28px,4.4vw,40px);line-height:1.05;letter-spacing:-.02em}
.zd-feat-art{font-size:16px;color:var(--mut)}
.zd-feat-meta{font-family:var(--mono);font-size:13px;letter-spacing:.08em}
.zd-feat-row{display:flex;align-items:center;gap:16px;margin-top:16px;flex-wrap:wrap}
.zd-feat-price{font-family:var(--mono);font-size:16px;font-weight:600}
.zd-feat-get{display:inline-flex;align-items:center;justify-content:space-between;gap:12px;height:48px;padding:0 20px;border-radius:16px;background:var(--ink);color:var(--yellow);font-family:var(--display);font-size:20px}
.zd-feat:hover .zd-feat-get{background:var(--ink2)}

/* ── filters: 40px pills, 2px border, selected = black fill, yellow label ── */
.zd-filters{position:sticky;top:64px;z-index:50;background:var(--bg);border-bottom:1px solid var(--line);margin-top:24px}
.zd-filters-in{display:flex;gap:12px;padding-top:12px;padding-bottom:12px;overflow-x:auto;scrollbar-width:none}
.zd-filters-in::-webkit-scrollbar{display:none}
.zd-chip{display:inline-flex;align-items:center;white-space:nowrap;min-height:44px;padding:0 16px;border-radius:999px;background:transparent;border:2px solid var(--ink);color:var(--ink);font-family:var(--sans);font-weight:700;font-size:14px;cursor:pointer}
.zd-chip:hover:not(:disabled){background:var(--sunken)}
.zd-chip.on,.zd-chip.on:hover{background:var(--ink);color:var(--yellow)}
.zd-chip:disabled{opacity:.4;cursor:not-allowed}

/* ── sections + grid ── */
.zd-sec{padding:32px 0}
@media(min-width:768px){.zd-sec{padding:48px 0}}
.zd-sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}
.zd-sec-head h2{font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1.08}
.zd-sec-head-2{margin-top:48px}
.zd-count{font-family:var(--mono);font-size:13px;letter-spacing:.08em;color:var(--mut)}
.zd-grid{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:680px){.zd-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}}
@media(min-width:1040px){.zd-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}

/* event card: the shared <EventCard> (app/components/event-card.module.css) */

/* loading skeletons — shaped like the card, no spinner */
.zd-skel{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--raised)}
.zd-skel-cover{aspect-ratio:4/5;background:var(--sunken)}
.zd-skel-body{display:flex;flex-direction:column;gap:12px;padding:16px 20px 20px}
.zd-skel-line{display:block;height:12px;border-radius:6px;background:var(--sunken)}
.zd-skel-w80{width:80%}.zd-skel-w65{width:65%}.zd-skel-w50{width:50%}.zd-skel-w40{width:40%}

/* empty / error states */
.zd-state{grid-column:1/-1;text-align:center;padding:48px 24px;border:2px dashed var(--line);border-radius:16px;background:var(--raised)}
.zd-state-h{font-size:24px;font-weight:700;letter-spacing:-.02em}
.zd-state-h.zd-display{font-family:var(--display);font-weight:400;letter-spacing:0;font-size:24px}
.zd-state-p{margin:12px auto 0;max-width:52ch;font-size:16px;color:var(--mut)}
.zd-state-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;margin-top:20px;padding:0 24px;border-radius:16px;background:var(--ink);border:2px solid var(--ink);color:var(--yellow);font-family:var(--display);font-size:20px;cursor:pointer}
.zd-state-btn:hover{background:var(--ink2)}
.zd-state-cities{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:20px}
.zd-state-cities .zd-state-btn{margin-top:0}
.zd-state-btn.zd-ghost{background:transparent;color:var(--ink);font-family:var(--sans);font-weight:700;font-size:16px;min-height:44px;border-radius:999px;padding:0 16px}
.zd-state-btn.zd-ghost:hover{background:var(--sunken)}
.zd-state-err{border-style:solid;border-color:var(--zp-color-alert-red)}

/* ── KULTUR (flagged off; kept flat in case it returns) ── */
.zd-kultur{position:relative;margin:32px 0 0;border-radius:16px;overflow:hidden;background:var(--ink);color:var(--zp-color-bone)}
.zd-kultur-bg{display:none}
.zd-kultur-in{display:grid;grid-template-columns:1fr;gap:24px;padding:32px 24px}
@media(min-width:860px){.zd-kultur-in{grid-template-columns:1.5fr auto;align-items:center;padding:48px}}
.zd-tagpre,.zd-div,.zd-qlabel{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--yellow)}
.zd-big{font-family:var(--display);font-size:clamp(40px,8vw,56px);line-height:.95}
.zd-div{display:block;margin-top:16px}
.zd-flag{font-size:18px;margin-top:16px;max-width:36ch}
.zd-cta-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}
.zd-k-btn{display:inline-flex;align-items:center;min-height:48px;padding:0 20px;border-radius:16px;border:2px solid var(--zp-color-bone);background:transparent;color:var(--zp-color-bone);font-weight:700;font-size:16px;cursor:pointer}
.zd-qr-card{display:block;width:184px;padding:16px;border-radius:16px;background:var(--zp-color-white);text-align:center}
.zd-qr{width:130px;height:130px;margin:0 auto}
.zd-qlabel{color:var(--ink);margin-top:12px}

/* ── organizer band: black ground, the yellow flipped primary ── */
.zd-organize{border-radius:16px;background:var(--ink);color:var(--zp-color-bone);padding:40px 24px;text-align:center}
@media(min-width:768px){.zd-organize{padding:64px 48px}}
.zd-pre{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:#BDBDBD;margin-bottom:16px}
.zd-organize h2{font-family:var(--display);font-weight:400;font-size:clamp(28px,4.6vw,40px);line-height:.95;max-width:20ch;margin:0 auto}
.zd-org-p{margin:16px auto 0;max-width:52ch;font-size:18px;color:#BDBDBD}
.zd-aura-btn{display:inline-flex;align-items:center;justify-content:space-between;gap:16px;height:56px;margin-top:24px;padding:0 24px;border-radius:16px;background:var(--yellow);color:var(--ink);font-family:var(--display);font-size:20px;transition:background-color 120ms}
.zd-aura-btn:hover{background:var(--zp-color-yellow-press)}
.zd-aura-btn:active{transform:translateY(2px)}
.zd-organize :focus-visible{outline-color:var(--yellow)}

/* ── footer band ── */
.zd-footer{background:var(--ink);color:var(--zp-color-bone);padding:40px 0}
.zd-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}
.zd-foot-line{font-family:var(--display);font-size:clamp(24px,3.4vw,32px);line-height:1}
.zd-cols{display:flex;flex-wrap:wrap;gap:24px;font-size:16px;font-weight:500}
.zd-cols a{display:inline-flex;align-items:center;min-height:44px}
.zd-cols a:hover{text-decoration:underline}
.zd-legal{font-family:var(--mono);font-size:13px;letter-spacing:.08em;color:#BDBDBD}
.zd-footer :focus-visible{outline-color:var(--yellow)}

/* ── pass sheet ── */
.zd-sheet{position:fixed;inset:0;z-index:90;display:none;align-items:flex-end;justify-content:center;background:var(--zp-overlay,rgba(17,17,17,.6))}
.zd-sheet.on{display:flex}
@media(min-width:640px){.zd-sheet{align-items:center;padding:24px}}
.zd-tk{width:100%;max-width:440px;max-height:92vh;overflow-y:auto;background:var(--raised);border:2px solid var(--ink);border-radius:16px 16px 0 0}
@media(min-width:640px){.zd-tk{border-radius:16px}}
.zd-tk-cover{position:relative;aspect-ratio:16/9;display:flex;align-items:flex-end;padding:16px;overflow:hidden;background:var(--ink)}
.zd-tk-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.zd-tt{position:relative;background:var(--ink);padding:4px 8px;border-radius:8px;font-weight:800;font-size:clamp(24px,5.5vw,28px);line-height:1.05;letter-spacing:-.02em;color:var(--zp-color-bone)}
.zd-x{position:absolute;top:8px;right:8px;z-index:3;width:44px;height:44px;border-radius:12px;background:var(--raised);border:2px solid var(--ink);color:var(--ink);font-size:22px;line-height:1;cursor:pointer}
.zd-tk-body{padding:20px}
.zd-tk-meta{font-family:var(--mono);font-size:14px;letter-spacing:.04em;line-height:1.8}
.zd-tk-art{font-family:var(--sans);font-size:16px;font-weight:700;letter-spacing:-.01em}
.zd-tk-split{margin-top:12px;padding:12px;border-radius:12px;background:var(--sunken);font-size:14px}
.zd-honest{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:16px 0;padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.zd-l{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut)}
.zd-p{font-family:var(--mono);font-size:24px;font-weight:600}
.zd-tk-pay{display:flex;align-items:center;justify-content:space-between;width:100%;height:56px;padding:0 24px;border:none;border-radius:16px;background:var(--ink);color:var(--yellow);font-family:var(--display);font-size:20px;cursor:pointer;transition:background-color 120ms}
.zd-tk-pay:hover{background:var(--ink2)}
.zd-tk-pay:active{transform:translateY(2px)}
.zd-methods{margin-top:12px;font-size:14px;color:var(--mut);text-align:center}

/* ── toast: dark surface, bone text, bottom of the screen ── */
.zd-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99;max-width:92vw;min-height:48px;display:flex;align-items:center;padding:12px 20px;border-radius:12px;background:var(--ink);color:var(--zp-color-bone);font-size:16px;opacity:0;pointer-events:none;transition:opacity 240ms}
.zd-toast.show{opacity:1}

/* ── zbot (shared widget) ── */
.zd .zbot{position:fixed;right:16px;bottom:16px;z-index:80;font-family:var(--sans)}
.zd .zbot-fab{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 20px;border-radius:16px;background:var(--ink);border:2px solid var(--ink);color:var(--zp-color-bone);font-weight:700;font-size:16px;cursor:pointer}
.zd .zbot-fab:hover{background:var(--ink2)}
.zd .zbot-fab svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2}
.zd .zbot-fab.hide{display:none}

@media(prefers-reduced-motion:reduce){
  .zd-feat,.zd-aura-btn,.zd-tk-pay,.zd-toast,.zd-feat-media img{transition:opacity 120ms}
}
`;

export default function DiscoverPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zd">
        <DiscoverApp />
      </div>
    </>
  );
}
