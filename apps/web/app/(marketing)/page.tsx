import type { Metadata } from 'next';
import { HomeApp } from './home-app';

/* / (apex) — React port of public/index.html, the OFFSHORE-led home. This server
   shell carries the page metadata, per-page fonts and the inline <style> ported
   verbatim from index.html; the interactive body (countdown, gallery scroller,
   /api/events + /api/settings wiring, placements) lives in <HomeApp> (client).

   Unlike the F2 marketing pages, the home matches the shared chrome, so it does
   NOT render its own <nav>/<footer>: the marketing layout wraps it in the shared
   <SiteNav>/<SiteFooter> (see marketing-chrome.tsx). Those live outside this file
   but are styled by the nav/footer rules in the CSS below. */

export const metadata: Metadata = {
  title: 'ZORA — The ticket is the product',
  description:
    'Global ticketing infrastructure. Zero fees at checkout, drops not listings, native crew split, resale capped at face value. Built in Africa, engineered for the world.',
};

const CSS = `
  :root{
    --black:#0A0A0B; --ink:#101012; --hair:#222226;
    --bone:#F4F1EA; --mut:#8A877E;
    --blue:#3D5AFE;
    --sans:'Archivo',system-ui,sans-serif;
    --mono:'IBM Plex Mono',monospace;
    --stamp:'Anton',sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--black);color:var(--bone);font-family:var(--sans);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  ::selection{background:var(--blue);color:var(--bone)}

  .wrap{max-width:1200px;margin:0 auto;padding:0 24px}
  .mono{font-family:var(--mono)}

  /* ── nav ── */
  nav{position:fixed;top:0;left:0;right:0;z-index:50;background:var(--c-nav);backdrop-filter:blur(12px);border-bottom:1px solid var(--hair)}
  .nav-in{display:flex;align-items:center;justify-content:space-between;height:64px}
  .wordmark{font-weight:600;font-size:22px;letter-spacing:-.02em}
  .wordmark .o{color:var(--blue)}
  .nav-links{display:flex;gap:28px;align-items:center;font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:lowercase}
  .nav-links a{color:var(--mut);transition:color .2s}
  .nav-links a:hover{color:var(--bone)}
  .nav-links .kbtn{color:var(--blue);border:1px solid var(--blue);padding:7px 14px;transition:all .2s}
  .nav-links .kbtn:hover{background:var(--blue);color:var(--bone)}
  @media(max-width:720px){.nav-links a:not(.kbtn){display:none}}

  /* ── hero (full-width video) ── */
  .hero{position:relative;min-height:96vh;display:flex;align-items:center;overflow:hidden;border-bottom:1px solid var(--hair)}
  .hero .media{position:absolute;inset:0;z-index:0;background:linear-gradient(150deg,#1a2350,#0A0A0B)}
  .hero .media::after{content:'FESTIVAL FOOTAGE — ADD assets/hero-crowd.mp4';position:absolute;left:24px;bottom:18px;font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:rgba(244,241,234,.35);z-index:0}
  .hero .media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .6s;animation:kenburns 22s ease-in-out infinite alternate}
  .hero .media img.loaded{opacity:1}
  .hero video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}
  @keyframes kenburns{from{transform:scale(1)}to{transform:scale(1.12)}}
  .hero .sheen{position:absolute;inset:0;z-index:2;background:radial-gradient(120% 90% at 12% 8%,rgba(61,90,254,.26),transparent 55%),linear-gradient(180deg,rgba(10,10,11,.4),rgba(10,10,11,.12) 45%,rgba(10,10,11,.92))}
  .hero .wrap{position:relative;z-index:3;padding-top:64px}
  .hero h1{font-weight:600;letter-spacing:-.035em;line-height:.96;font-size:clamp(46px,9vw,120px);text-transform:lowercase;max-width:15ch}
  .hero h1 .dot{color:var(--blue)}
  .hero .sub{font-family:var(--mono);color:#B4B1A8;font-size:clamp(12px,1.4vw,15px);letter-spacing:.06em;margin-top:28px;max-width:60ch}
  .hero .ctas{display:flex;gap:14px;margin-top:44px;flex-wrap:wrap}
  .btn{display:inline-block;font-family:var(--mono);font-size:13px;letter-spacing:.1em;padding:15px 30px;border:1px solid var(--bone);transition:all .2s}
  .btn.solid{background:var(--bone);color:var(--black)}
  .btn.solid:hover{background:var(--blue);border-color:var(--blue);color:var(--bone)}
  .btn.ghost:hover{background:var(--bone);color:var(--black)}
  .btn.k{border-color:var(--blue);color:var(--blue)}
  .btn.k:hover{background:var(--blue);color:var(--bone)}

  /* ── marquee ── */
  .marquee{overflow:hidden;border-bottom:1px solid var(--hair);padding:14px 0;white-space:nowrap}
  .marquee-track{display:inline-block;animation:slide 28s linear infinite;font-family:var(--mono);font-size:12px;letter-spacing:.14em;color:var(--mut)}
  .marquee-track b{color:var(--bone);font-weight:500}
  @keyframes slide{from{transform:translateX(0)}to{transform:translateX(-50%)}}

  /* ── pillars ── */
  section{padding:110px 0;border-bottom:1px solid var(--hair)}
  .kicker{font-family:var(--mono);font-size:12px;letter-spacing:.2em;color:var(--blue);margin-bottom:18px}
  h2{font-weight:600;font-size:clamp(28px,4vw,48px);letter-spacing:-.02em;line-height:1.1;text-transform:lowercase;max-width:22ch}
  .pillars{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1px;background:var(--hair);border:1px solid var(--hair);margin-top:56px}
  .pillar{background:var(--black);padding:36px 28px;transition:background .25s}
  .pillar:hover{background:var(--ink)}
  .pillar .num{font-family:var(--mono);font-size:12px;color:var(--blue);letter-spacing:.15em}
  .pillar h3{font-size:19px;font-weight:600;margin:16px 0 10px;letter-spacing:-.01em;text-transform:lowercase}
  .pillar p{color:var(--mut);font-size:14.5px}

  /* ── festival gallery carousel ── */
  .gallery-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:34px;flex-wrap:wrap}
  .gcar-nav{display:flex;gap:8px}
  .gcar-nav button{width:44px;height:44px;border-radius:50%;border:1px solid var(--hair);background:var(--ink);color:var(--bone);cursor:pointer;font-size:18px;transition:all .2s}
  .gcar-nav button:hover{border-color:var(--blue);background:var(--blue)}
  .ph{position:relative;overflow:hidden;background:linear-gradient(150deg,var(--a,#26262B),var(--b,#0A0A0B))}
  .ph::before{content:'';position:absolute;inset:0;background:radial-gradient(70% 60% at 75% 12%,rgba(255,255,255,.13),transparent 60%);z-index:1}
  .ph::after{content:attr(data-label);position:absolute;left:14px;bottom:12px;font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:rgba(244,241,234,.72);z-index:1}
  .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;opacity:0;transition:opacity .5s}
  .ph img.loaded{opacity:1}
  .gallery{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding-bottom:4px}
  .gallery::-webkit-scrollbar{display:none}
  .gslide{flex:0 0 auto;width:min(320px,76vw);scroll-snap-align:start}
  .gslide .ph{border-radius:16px;aspect-ratio:3/4}
  .gslide .cap{font-family:var(--mono);font-size:11.5px;color:var(--mut);letter-spacing:.03em;margin-top:12px}
  .gslide .cap b{color:var(--bone);font-weight:500}

  /* ── drop strip ── */
  .drops{background:var(--black);position:relative}
  .k-card{border:2px solid var(--blue);padding:56px 40px;display:grid;grid-template-columns:1.2fr 1fr;gap:40px;align-items:center}
  @media(max-width:860px){.k-card{grid-template-columns:1fr}}
  .k-stamp{font-family:var(--stamp);color:var(--blue);font-size:clamp(38px,5.5vw,72px);line-height:.95;letter-spacing:.02em;transform:rotate(-2deg);display:inline-block}
  .k-stamp small{display:block;font-family:var(--mono);font-size:12px;letter-spacing:.3em;color:var(--bone);transform:none;margin-bottom:14px}
  .k-meta{font-family:var(--mono);font-size:12.5px;color:var(--mut);letter-spacing:.08em;margin-top:22px;line-height:2}
  .k-meta b{color:var(--bone);font-weight:500}
  .k-count{text-align:center}
  .k-count .label{font-family:var(--mono);font-size:11px;letter-spacing:.25em;color:var(--mut);margin-bottom:14px}
  .k-count .clock{font-family:var(--mono);font-size:clamp(30px,4.5vw,52px);font-weight:500;letter-spacing:.04em;color:var(--bone)}
  .k-count .clock.live{color:var(--blue)}
  .k-count .clock.sold{color:var(--bone)}
  .k-count .units{font-family:var(--mono);font-size:10px;letter-spacing:.35em;color:var(--mut);margin-top:8px}
  .k-count .btn{margin-top:30px}

  /* ── the O ── */
  .osec{display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center}
  @media(max-width:860px){.osec{grid-template-columns:1fr}}
  .the-o{width:min(300px,70vw);aspect-ratio:1;border-radius:50%;border:3px solid var(--blue);margin:0 auto;position:relative;display:flex;align-items:center;justify-content:center}
  .the-o::after{content:'';position:absolute;inset:26px;border-radius:50%;border:1px solid var(--hair)}
  .the-o span{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--mut)}
  .stores{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap}
  .stores .store{font-family:var(--mono);font-size:12px;letter-spacing:.08em;border:1px solid var(--hair);color:var(--mut);padding:13px 22px}
  .osec p.lead{color:var(--mut);margin-top:20px;max-width:46ch}

  /* ── manifesto ── */
  .manifesto p{font-size:clamp(22px,3vw,34px);font-weight:500;letter-spacing:-.015em;line-height:1.35;text-transform:lowercase;max-width:30ch}
  .manifesto p+p{margin-top:28px}
  .manifesto .hl{color:var(--blue)}

  /* ── footer ── */
  footer{padding:56px 0;border-bottom:none}
  .foot{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap}
  .foot .cols{display:flex;gap:48px;font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--mut)}
  .foot .cols a{display:block;margin-top:8px;color:var(--mut)}
  .foot .cols a:hover{color:var(--bone)}
  .foot .legal{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.08em}
  .foot .legal a{color:var(--mut)}
`;

export default function HomePage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Anton&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <HomeApp />
    </>
  );
}
