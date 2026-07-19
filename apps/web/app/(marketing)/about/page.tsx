import type { Metadata } from 'next';
import { Wordmark } from '../../components/wordmark';
import { RevealImg } from '../../components/reveal-img';
import { Placements } from '../../components/placements';
import { AboutCarousel } from './carousel';

/* /about — React port of public/about.html. The page keeps its own <nav>/<footer>
   (divergent from the shared SiteNav/SiteFooter — see marketing-chrome.tsx), its
   own inline <style>, and the per-page Google Fonts <link>. Internal links are
   repointed to clean routes; asset paths are made absolute (/assets/…) so they
   resolve from the /about route. zora-theme.js's wordmark/favicon/theme-toggle
   behaviour is provided by <Wordmark>, the root layout, and the marketing
   layout's <ThemeToggle>; placements.js becomes <Placements/>. */

export const metadata: Metadata = {
  title: 'ZORA — About',
  description:
    'Zora is a global ticketing and live-experience brand built in Africa. Every event worth being at, one honest price, no junk fees.',
};

const CSS = `
  :root{
    --black:#0A0A0B; --ink:#101012; --ink2:#16161A; --hair:#26262B; --hair2:#33333A;
    --bone:#F4F1EA; --mut:#8A877E; --mut2:#B4B1A8;
    --blue:#3D5AFE; --orange:#FF5A1F; --green:#2FA9A0;
    --sans:'Archivo',system-ui,sans-serif; --mono:'IBM Plex Mono',monospace; --stamp:'Anton',sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--black);color:var(--bone);font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  ::selection{background:var(--blue);color:var(--bone)}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px}
  .mono{font-family:var(--mono)}

  nav{position:sticky;top:0;z-index:50;background:var(--c-nav);backdrop-filter:blur(14px);border-bottom:1px solid var(--hair)}
  .nav-in{display:flex;align-items:center;gap:22px;height:64px;max-width:1080px;margin:0 auto;padding:0 24px}
  .wordmark{font-weight:600;font-size:22px;letter-spacing:-.02em}
  .wordmark .o{color:var(--blue)}
  .nav-links{display:flex;gap:24px;font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:lowercase}
  .nav-links a{color:var(--mut);transition:color .2s}
  .nav-links a:hover,.nav-links a.on{color:var(--bone)}
  .nav-cta{margin-left:auto;font-family:var(--mono);font-size:12px;letter-spacing:.08em;background:var(--bone);color:var(--black);padding:9px 16px;border-radius:99px}
  .nav-cta:hover{background:var(--blue);color:var(--bone)}
  @media(max-width:720px){.nav-links{display:none}}

  /* media placeholder (auto-reveals real assets in /assets) */
  .ph{position:relative;overflow:hidden;background:linear-gradient(150deg,var(--a,#26262B),var(--b,#0A0A0B))}
  .ph::before{content:'';position:absolute;inset:0;background:radial-gradient(70% 60% at 75% 12%,rgba(255,255,255,.13),transparent 60%);z-index:1}
  .ph::after{content:attr(data-label);position:absolute;left:14px;bottom:12px;font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:rgba(244,241,234,.72);z-index:1}
  .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;opacity:0;transition:opacity .5s}
  .ph img.loaded{opacity:1}

  /* hero with video */
  .hero{position:relative;height:82vh;min-height:520px;display:flex;align-items:flex-end;overflow:hidden;border-bottom:1px solid var(--hair)}
  .hero .media{position:absolute;inset:0;z-index:0}
  .hero .media.ph{--a:#1a2350;--b:#0A0A0B}
  .hero .media::after{content:'';left:0;bottom:0}
  .hero video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2}
  .hero .scrim{position:absolute;inset:0;z-index:3;background:linear-gradient(180deg,rgba(10,10,11,.3),rgba(10,10,11,.15) 40%,rgba(10,10,11,.9))}
  .hero .kenburns{animation:kb 18s ease-in-out infinite alternate}
  @keyframes kb{from{transform:scale(1)}to{transform:scale(1.1)}}
  .hero .inner{position:relative;z-index:4;padding-bottom:60px}
  .hero .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.24em;color:var(--bone);opacity:.8;margin-bottom:18px}
  .hero h1{font-family:var(--stamp);font-size:clamp(44px,9vw,110px);line-height:.9;letter-spacing:.01em;max-width:16ch}
  .hero h1 .g{color:var(--blue)}
  .hero .sub{color:var(--mut2);font-size:clamp(15px,2vw,19px);margin-top:20px;max-width:46ch}

  section{padding:80px 0;border-bottom:1px solid var(--hair)}
  .kicker{font-family:var(--mono);font-size:12px;letter-spacing:.24em;color:var(--blue);margin-bottom:18px}
  h2{font-size:clamp(26px,4vw,42px);font-weight:600;letter-spacing:-.02em;line-height:1.1;max-width:22ch}
  .story p{color:var(--mut2);font-size:clamp(16px,2vw,19px);max-width:60ch;margin-top:20px;line-height:1.7}
  .story p b{color:var(--bone);font-weight:500}

  /* stats */
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--hair);border:1px solid var(--hair);margin-top:8px}
  .stat{background:var(--black);padding:30px 24px}
  .stat .v{font-family:var(--stamp);font-size:clamp(34px,5vw,54px);color:var(--bone);line-height:1}
  .stat .v .u{color:var(--blue)}
  .stat .l{font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--mut);margin-top:10px}

  /* carousel */
  .car-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap}
  .car-nav{display:flex;gap:8px}
  .car-nav button{width:42px;height:42px;border-radius:50%;border:1px solid var(--hair2);background:var(--ink);color:var(--bone);cursor:pointer;font-size:18px;transition:all .2s}
  .car-nav button:hover{border-color:var(--blue);background:var(--blue)}
  .carousel{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding-bottom:4px;-webkit-overflow-scrolling:touch}
  .carousel::-webkit-scrollbar{display:none}
  .slide{flex:0 0 auto;width:min(340px,78vw);scroll-snap-align:start}
  .slide .ph{border-radius:16px;aspect-ratio:4/5}
  .slide .cap{font-family:var(--mono);font-size:11.5px;color:var(--mut2);letter-spacing:.03em;margin-top:12px}
  .slide .cap b{color:var(--bone);font-weight:500}

  /* values */
  .vals{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-top:8px}
  .val{background:var(--ink);border:1px solid var(--hair);border-radius:14px;padding:24px}
  .val .n{font-family:var(--mono);font-size:11px;color:var(--blue);letter-spacing:.15em}
  .val h3{font-size:17px;font-weight:600;margin:12px 0 8px}
  .val p{color:var(--mut2);font-size:14px}

  .cta{text-align:center;border-bottom:none}
  .cta h2{margin:0 auto}
  .big-btn{display:inline-block;margin-top:28px;background:var(--bone);color:var(--black);font-family:var(--mono);font-size:13px;font-weight:500;letter-spacing:.1em;padding:18px 38px;border-radius:99px;transition:all .2s}
  .big-btn:hover{background:var(--blue);color:var(--bone);transform:translateY(-2px)}

  footer{padding:40px 0}
  .foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.06em}
  .foot a:hover{color:var(--bone)}
`;

export default function AboutPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Anton&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <nav>
        <div className="nav-in">
          <Wordmark href="/" />
          <div className="nav-links">
            <a href="/discover">events</a>
            <a href="/about" className="on">about</a>
            <a href="/commission">pricing</a>
            <a href="/help">help</a>
          </div>
          <a href="/discover" className="nav-cta">FIND EVENTS</a>
        </div>
      </nav>

      <header className="hero">
        <div className="media ph kenburns" data-label="">
          <RevealImg src="/assets/event-02.jpg" data-slot="about-hero" alt="" />
        </div>
        <video autoPlay muted loop playsInline poster="/assets/event-02.jpg">
          <source src="/assets/hero-crowd.mp4" type="video/mp4" />
        </video>
        <div className="scrim"></div>
        <div className="wrap inner">
          <p className="eyebrow">BUILT IN AFRICA · MADE FOR THE WORLD</p>
          <h1>we open <span className="g">doors</span>.</h1>
          <p className="sub">Zora is a global ticketing and live-experience brand. We put the night in your pocket and the honesty back in the price.</p>
        </div>
      </header>

      <section className="story">
        <div className="wrap">
          <p className="kicker">WHO WE ARE</p>
          <h2>The city deserved a better front door.</h2>
          <p>Ticketing got ugly — spreadsheet listings, fees that appear at the last second, scalpers eating the good seats. So we built the opposite. <b>One honest price, a live pass in the app, and a resale market that makes scalping impossible.</b></p>
          <p>Founded in Dar es Salaam, Zora hands organizers a premium storefront, a real dashboard, and the tools to grow their own crowd — then connects those crowds across cities. <b>Their audience becomes a shared audience.</b> That&apos;s the flywheel.</p>
          <div className="stats">
            <div className="stat"><p className="v">40<span className="u">+</span></p><p className="l">EVENTS POWERED</p></div>
            <div className="stat"><p className="v">5</p><p className="l">CITIES LIVE</p></div>
            <div className="stat"><p className="v">100<span className="u">k</span></p><p className="l">TICKETS IN POCKETS</p></div>
            <div className="stat"><p className="v">0<span className="u">%</span></p><p className="l">JUNK FEES</p></div>
          </div>
        </div>
      </section>

      <AboutCarousel />

      <section>
        <div className="wrap">
          <p className="kicker">WHAT WE STAND ON</p>
          <h2>Three promises we don&apos;t break.</h2>
          <div className="vals">
            <div className="val"><p className="n">01</p><h3>One honest number</h3><p>What you see is what you pay. Fees never appear at checkout — not now, not ever.</p></div>
            <div className="val"><p className="n">02</p><h3>The pass is alive</h3><p>Your ticket is a live object in the app, not a screenshotable PDF. It moves when it&apos;s real.</p></div>
            <div className="val"><p className="n">03</p><h3>Scalping is impossible</h3><p>Resale is capped at face +10%, in-app only. Off-platform passes simply don&apos;t scan.</p></div>
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="wrap">
          <h2 style={{ textAlign: 'center' }}>Find your next night.</h2>
          <a className="big-btn" href="/discover">EXPLORE EVENTS</a>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <span>© 2026 ZORA · BUILT IN DAR ES SALAAM</span>
          <span><a href="/discover">events</a> &middot; <a href="/commission">pricing</a> &middot; <a href="/help">help</a></span>
        </div>
      </footer>

      <Placements />
    </>
  );
}
