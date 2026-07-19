import type { Metadata } from 'next';
import { Wordmark } from '../../components/wordmark';
import { BrandNav } from './brand-nav';

/* /brand — React port of public/brand.html (the "Design system" showcase). Keeps
   its own scroll-reactive nav (<BrandNav>), inline design tokens + <style>, and
   per-page fonts. Every .wordmark on the page became the theme logo image at
   runtime (zora-theme.js), so we render <Wordmark>; the ticket-preview wordmark
   was a <span>, reproduced inline. Links are in-page hash anchors, left as-is. */

export const metadata: Metadata = {
  title: 'ZORA — Design system',
  description: 'ZORA rebrand — obsidian dark mode, sunrise aura, electric blue anchor.',
};

const CSS = `
  /* ══════════════════════════════════════════════════════
     ZORA · DESIGN TOKENS
     ══════════════════════════════════════════════════════ */
  :root{
    /* — obsidian neutrals — */
    --bg:#0A0B10;            /* page / obsidian */
    --bg-2:#0D0F17;          /* section band */
    --surface:#11131E;       /* card */
    --surface-2:#171A28;     /* raised / hover */
    --line:rgba(124,160,255,.12);   /* blue-tinted hairline */
    --line-2:rgba(124,160,255,.22);
    --glass:rgba(13,15,23,.62);

    /* — sunrise aura (logo O · CTAs · focal only) — */
    --aura-1:#D53AD8; --aura-2:#FF4D7D; --aura-3:#FF9145;
    --aura:linear-gradient(130deg,var(--aura-1) 0%,var(--aura-2) 48%,var(--aura-3) 100%);

    /* — electric blue anchor (structure · data · accents) — */
    --blue:#4C6FFF;          /* electric indigo */
    --ice:#7CA0FF;           /* ice blue */
    --cyan:#3FE0FF;          /* neon cyan highlight */
    --indigo:#151A3A;        /* deep indigo shadow */
    --blue-glow:rgba(76,111,255,.30);

    /* — text — */
    --text:#EDEFF7; --text-2:#9BA3C4; --text-3:#5C6488;

    /* — type — */
    --head:'Space Grotesk',system-ui,sans-serif;
    --body:'Inter',system-ui,sans-serif;
    --mono:'IBM Plex Mono',monospace;
    --radius:16px;
    color-scheme:dark;
  }
  :root[data-theme="light"]{
    --bg:#F4F6FC; --bg-2:#EBEEF8; --surface:#FFFFFF; --surface-2:#F3F5FC;
    --line:rgba(60,80,180,.14); --line-2:rgba(60,80,180,.26); --glass:rgba(255,255,255,.66);
    --blue:#3A54E8; --ice:#3A54E8; --cyan:#0E8FB8; --indigo:#DDE3FF; --blue-glow:rgba(58,84,232,.24);
    --text:#0C1020; --text-2:#4E5675; --text-3:#8B93B2;
    color-scheme:light;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--text);font-family:var(--body);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
  a{color:inherit;text-decoration:none}
  ::selection{background:var(--blue);color:#fff}
  .wrap{max-width:1180px;margin:0 auto;padding:0 24px}
  .mono{font-family:var(--mono)}

  body::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;background:
    radial-gradient(50% 40% at 82% -5%,rgba(255,90,80,.14),transparent 60%),
    radial-gradient(46% 40% at 8% 12%,rgba(76,111,255,.16),transparent 60%),
    var(--bg)}

  h1,h2,h3{font-family:var(--head);font-weight:600;letter-spacing:-.02em;line-height:1.05}

  /* ── logo ── */
  .wordmark{font-family:var(--head);font-weight:600;font-size:24px;letter-spacing:-.01em;display:inline-flex;align-items:center;color:var(--text)}
  .wordmark .o{width:.72em;height:.72em;border-radius:50%;background:var(--aura);display:inline-block;margin:0 .02em;box-shadow:0 0 18px rgba(255,77,125,.5)}
  .badge{width:var(--s,64px);height:var(--s,64px);border-radius:50%;background:var(--aura);display:flex;align-items:center;justify-content:center;font-family:var(--head);font-weight:700;color:#fff;letter-spacing:.04em;box-shadow:0 10px 40px rgba(255,77,125,.4),inset 0 2px 12px rgba(255,255,255,.25)}

  /* ── glass nav ── */
  nav{position:fixed;top:0;left:0;right:0;z-index:50;transition:background .3s,border-color .3s}
  nav.glass{background:var(--glass);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid var(--line)}
  .nav-in{display:flex;align-items:center;gap:30px;height:70px}
  .nav-links{display:flex;gap:26px;font-family:var(--body);font-size:14.5px;color:var(--text-2)}
  .nav-links a{transition:color .2s}
  .nav-links a:hover{color:var(--text)}
  .nav-right{margin-left:auto;display:flex;align-items:center;gap:14px}
  .btn{font-family:var(--body);font-weight:500;font-size:14px;border-radius:99px;padding:11px 22px;cursor:pointer;border:1px solid transparent;transition:transform .15s,box-shadow .2s,background .2s,border-color .2s;display:inline-flex;align-items:center;gap:8px}
  .btn-aura{background:var(--aura);color:#fff;box-shadow:0 6px 22px rgba(255,77,125,.34)}
  .btn-aura:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(255,77,125,.5)}
  .btn-blue{background:rgba(76,111,255,.12);color:var(--ice);border-color:var(--line-2)}
  .btn-blue:hover{background:rgba(76,111,255,.2);border-color:var(--blue)}
  .btn-ghost{color:var(--text-2)}
  .btn-ghost:hover{color:var(--text)}
  @media(max-width:820px){.nav-links{display:none}}

  /* ── hero ── */
  .hero{position:relative;padding:170px 0 90px}
  .hero .eyebrow{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono);font-size:11.5px;letter-spacing:.18em;color:var(--ice);border:1px solid var(--line-2);border-radius:99px;padding:8px 15px;margin-bottom:30px}
  .hero .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 10px var(--cyan)}
  .hero h1{font-size:clamp(46px,8vw,104px);font-weight:700;line-height:.98;letter-spacing:-.035em;max-width:15ch}
  .hero h1 .grad{background:var(--aura);-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero p.sub{font-size:clamp(16px,1.8vw,20px);color:var(--text-2);max-width:52ch;margin-top:26px;line-height:1.6}
  .hero .ctas{display:flex;gap:14px;margin-top:40px;flex-wrap:wrap}
  .hero .badge-float{position:absolute;right:6%;top:150px;--s:200px;animation:float 7s ease-in-out infinite;filter:drop-shadow(0 30px 80px rgba(255,77,125,.35))}
  @keyframes float{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-22px) rotate(-4deg)}}
  @media(max-width:920px){.hero .badge-float{display:none}}

  .stats{display:flex;border:1px solid var(--line);border-radius:var(--radius);margin-top:64px;overflow:hidden;background:var(--surface)}
  .stat{flex:1;padding:26px 28px;border-right:1px solid var(--line)}
  .stat:last-child{border-right:none}
  .stat .v{font-family:var(--head);font-size:30px;font-weight:600;letter-spacing:-.02em}
  .stat .v.aura{background:var(--aura);-webkit-background-clip:text;background-clip:text;color:transparent}
  .stat .v.blue{color:var(--ice)}
  .stat .k{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--text-3);margin-top:8px}
  @media(max-width:680px){.stats{flex-wrap:wrap}.stat{flex:1 1 50%;border-bottom:1px solid var(--line)}}

  section{padding:90px 0}
  .sec-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:38px;flex-wrap:wrap}
  .sec-head h2{font-size:clamp(28px,4vw,44px)}
  .sec-head .k{font-family:var(--mono);font-size:12px;letter-spacing:.2em;color:var(--ice);margin-bottom:14px}
  .sec-head p{color:var(--text-2);font-size:15px}

  /* ── event cards (blue anchor) ── */
  .events{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
  .ecard{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;transition:transform .2s,border-color .2s,box-shadow .2s;cursor:pointer}
  .ecard:hover{transform:translateY(-4px);border-color:var(--blue);box-shadow:0 18px 50px -20px var(--blue-glow)}
  .ecard.featured{border-color:var(--line-2)}
  .ecard .cover{aspect-ratio:16/10;position:relative;padding:16px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;background:linear-gradient(150deg,var(--indigo),#0A0B10)}
  .ecard.featured .cover{background:var(--aura)}
  .ecard.featured .cover::after{content:'';position:absolute;inset:0;background:radial-gradient(70% 60% at 80% 10%,rgba(255,255,255,.22),transparent 60%)}
  .ecard .cover > *{position:relative;z-index:1}
  .ecard .tag{align-self:flex-start;font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;background:rgba(10,11,16,.5);backdrop-filter:blur(6px);border:1px solid var(--line);color:var(--text);padding:5px 11px;border-radius:99px}
  .ecard.featured .tag{background:rgba(10,11,16,.28);border-color:rgba(255,255,255,.3);color:#fff}
  .ecard .cover .ct{font-family:var(--head);font-weight:700;font-size:clamp(22px,2.6vw,30px);line-height:.96;color:#fff;text-shadow:0 2px 18px rgba(0,0,0,.35)}
  .ecard .body{padding:17px 18px}
  .ecard .body h3{font-size:16.5px;font-weight:600}
  .ecard .body .meta{font-family:var(--mono);font-size:11.5px;color:var(--text-3);margin-top:9px;line-height:1.8}
  .ecard .foot{display:flex;align-items:center;justify-content:space-between;margin-top:16px;padding-top:15px;border-top:1px solid var(--line)}
  .ecard .price{font-family:var(--head);font-size:17px;font-weight:600}
  .ecard .price small{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;color:var(--text-3);display:block;font-weight:400}
  .ecard .get{font-family:var(--body);font-size:12.5px;font-weight:500;padding:9px 16px;border-radius:99px;background:rgba(76,111,255,.14);color:var(--ice);border:1px solid var(--line-2)}
  .ecard.featured .get{background:var(--aura);color:#fff;border:none;box-shadow:0 6px 18px rgba(255,77,125,.34)}

  /* ── ticket checkout preview ── */
  .checkout-sec{background:var(--bg-2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .co-grid{display:grid;grid-template-columns:1fr 400px;gap:44px;align-items:center}
  @media(max-width:880px){.co-grid{grid-template-columns:1fr}}
  .co-copy h2{font-size:clamp(28px,4vw,42px)}
  .co-copy p{color:var(--text-2);margin-top:18px;max-width:44ch}
  .co-copy .pts{margin-top:24px;display:grid;gap:12px}
  .co-copy .pt{display:flex;gap:12px;align-items:flex-start;font-size:14.5px;color:var(--text-2)}
  .co-copy .pt .ic{width:22px;height:22px;border-radius:7px;background:rgba(76,111,255,.14);color:var(--ice);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;border:1px solid var(--line-2)}
  .co-copy .pt b{color:var(--text);font-weight:500}

  .ticket{background:var(--surface);border:1px solid var(--line-2);border-radius:20px;overflow:hidden;box-shadow:0 30px 80px -30px rgba(0,0,0,.8)}
  .ticket .t-top{padding:20px 22px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
  .ticket .t-top .secure{font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--text-3)}
  .ticket .t-top .secure b{color:var(--ice)}
  .ticket .t-body{padding:22px}
  .ticket .ev{font-family:var(--head);font-weight:600;font-size:20px}
  .ticket .when{font-family:var(--mono);font-size:11.5px;color:var(--text-3);margin-top:6px;letter-spacing:.04em}
  .ticket .qty{display:flex;align-items:center;justify-content:space-between;margin:22px 0}
  .ticket .qty .ctrl{display:flex;align-items:center;gap:16px}
  .ticket .qty button{width:34px;height:34px;border-radius:50%;border:1px solid var(--line-2);background:none;color:var(--text);font-size:18px;cursor:pointer}
  .ticket .qty button:hover{border-color:var(--blue);color:var(--ice)}
  .ticket .qty .n{font-family:var(--head);font-size:18px;min-width:22px;text-align:center}
  .ticket .honest{border-top:1px solid var(--line);padding-top:16px}
  .ticket .row{display:flex;justify-content:space-between;font-family:var(--mono);font-size:13px;padding:5px 0;color:var(--text-2)}
  .ticket .row .free{color:var(--ice)}
  .ticket .total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--line);margin-top:10px;padding-top:15px}
  .ticket .total .l{font-family:var(--body);font-size:14px}
  .ticket .total .v{font-family:var(--head);font-size:26px;font-weight:600}
  .ticket .pay{width:100%;margin-top:18px;justify-content:center;padding:15px}
  .ticket .nofee{font-family:var(--mono);font-size:10px;color:var(--text-3);text-align:center;margin-top:12px;letter-spacing:.04em}
  .ticket .nofee b{color:var(--text-2)}

  footer{padding:60px 0 40px}
  .foot{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:34px}
  .foot .legal{font-family:var(--mono);font-size:11px;color:var(--text-3);letter-spacing:.06em}
  .foot .cols{display:flex;gap:26px;font-size:13.5px;color:var(--text-2)}
  .foot .cols a:hover{color:var(--text)}
`;

export default function BrandPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <BrandNav />

      <header className="hero" id="top">
        <div className="wrap">
          <span className="eyebrow"><span className="dot"></span>NOW LIVE IN DAR ES SALAAM · NAIROBI · LAGOS</span>
          <h1>The night is <span className="grad">yours</span>.</h1>
          <p className="sub">A premium ticketing and live-experience platform. One honest price, a pass that lives in your pocket, and nothing added at checkout.</p>
          <div className="ctas">
            <a className="btn btn-aura" style={{ padding: '15px 28px', fontSize: 15 }}>Find events near you</a>
            <a className="btn btn-blue" style={{ padding: '15px 28px', fontSize: 15 }}>For organizers</a>
          </div>
          <div className="stats">
            <div className="stat"><p className="v aura">100k+</p><p className="k">TICKETS IN POCKETS</p></div>
            <div className="stat"><p className="v blue">40+</p><p className="k">EVENTS POWERED</p></div>
            <div className="stat"><p className="v blue">5</p><p className="k">CITIES LIVE</p></div>
            <div className="stat"><p className="v blue">0%</p><p className="k">JUNK FEES</p></div>
          </div>
        </div>
        <div className="badge-float badge">ZORA</div>
      </header>

      <section id="events">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <p className="k">TONIGHT · NEAR YOU</p>
              <h2>Every event worth being at.</h2>
            </div>
            <p>Aura marks the flagship. Blue holds the grid.</p>
          </div>
          <div className="events">
            <div className="ecard featured">
              <div className="cover"><span className="tag">MEGA EVENT</span><span className="ct">OFFSHORE</span></div>
              <div className="body">
                <h3>The Offshore — daytime yacht groove</h3>
                <p className="meta">SAT 25 JUL · 14:00<br />SLIPWAY → THE COAST</p>
                <div className="foot"><span className="price">65,000 TZS<small>FROM</small></span><span className="get">Get ticket</span></div>
              </div>
            </div>
            <div className="ecard">
              <div className="cover"><span className="tag">NIGHTLIFE</span><span className="ct">BASEMENT 001</span></div>
              <div className="body">
                <h3>Basement 001</h3>
                <p className="meta">FRI 14 AUG · 23:00<br />SLOW LEOPARD, DAR</p>
                <div className="foot"><span className="price">25,000 TZS<small>FROM</small></span><span className="get">Get ticket</span></div>
              </div>
            </div>
            <div className="ecard">
              <div className="cover"><span className="tag">CONCERT</span><span className="ct">AMAPIANO<br />NIGHTS</span></div>
              <div className="body">
                <h3>Amapiano Nights</h3>
                <p className="meta">SAT 22 AUG · 20:00<br />NGONG RACECOURSE, NAIROBI</p>
                <div className="foot"><span className="price">3,500 KES<small>FROM</small></span><span className="get">Get ticket</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="checkout-sec" id="checkout">
        <div className="wrap co-grid">
          <div className="co-copy">
            <p className="k" style={{ fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '.2em', color: 'var(--ice)', marginBottom: 14 }}>THE CHECKOUT</p>
            <h2>Warm aura. Cool structure.</h2>
            <p>The sunrise gradient is reserved for the moments that matter — the logo, the one primary action. Electric blue anchors everything structural, so the interface feels balanced, not busy.</p>
            <div className="pts">
              <div className="pt"><span className="ic">&#9679;</span><span><b>Aura</b> — one CTA per view, the logo, focal stats. It stays rare, so it stays premium.</span></div>
              <div className="pt"><span className="ic">&#9679;</span><span><b>Blue</b> — borders, hover states, data, secondary actions, links.</span></div>
              <div className="pt"><span className="ic">&#9679;</span><span><b>Obsidian</b> — deep charcoal surfaces, never harsh black.</span></div>
            </div>
          </div>

          <div className="ticket">
            <div className="t-top">
              <span className="secure">SECURE CHECKOUT · <b>ZORA</b></span>
              <span className="wordmark" style={{ fontSize: 17 }}>
                <img className="zora-logo zora-logo-dark" src="/assets/zora-wordmark-white.png" alt="ZORA" draggable={false} />
                <img className="zora-logo zora-logo-light" src="/assets/zora-wordmark-black.png" alt="ZORA" draggable={false} />
              </span>
            </div>
            <div className="t-body">
              <p className="ev">The Offshore</p>
              <p className="when">SAT 25 JUL · SLIPWAY → THE COAST</p>
              <div className="qty"><span>Passes</span><div className="ctrl"><button>&minus;</button><span className="n">2</span><button>+</button></div></div>
              <div className="honest">
                <div className="row"><span>2 × 65,000 TZS</span><span>130,000 TZS</span></div>
                <div className="row"><span>Service fees</span><span className="free">0 TZS</span></div>
                <div className="total"><span className="l">Total</span><span className="v">130,000 TZS</span></div>
              </div>
              <button className="btn btn-aura pay">Lock in &amp; check out</button>
              <p className="nofee">The price is the price. <b>Nothing added on the next screen.</b></p>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <Wordmark href="#top" />
          <div className="cols"><a href="#events">Events</a><a href="#checkout">Tickets</a><a href="#">Organizers</a><a href="#">Help</a></div>
          <p className="legal">© 2026 ZORA · THE TICKET IS THE PRODUCT</p>
        </div>
      </footer>
    </>
  );
}
