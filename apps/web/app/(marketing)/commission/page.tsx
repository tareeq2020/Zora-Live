import type { Metadata } from 'next';
import { Wordmark } from '../../components/wordmark';
import { ZBot } from '../../components/zbot';
import { Calc } from './calc';

/* /commission — React port of public/commission.html (the "pricing" route). Keeps
   its own nav/footer, inline <style> and per-page fonts. The calculator is <Calc>
   and the support widget is <ZBot> (both client). Links to still-static pages
   (signup) keep their .html target; converted pages get clean routes. */

export const metadata: Metadata = {
  title: 'ZORA — Pricing & commission',
  description:
    "Zora's ticketing commission, in plain sight. Tanzania launch rate: a flat 5%. No junk fees passed to your buyers, ever.",
};

const CSS = `
  :root{
    --black:#0A0A0B; --ink:#101012; --ink2:#16161A; --hair:#26262B; --hair2:#33333A;
    --bone:#F4F1EA; --mut:#8A877E; --mut2:#B4B1A8;
    --blue:#3D5AFE; --bluewash:#161B3A; --orange:#FF5A1F; --green:#2FA9A0;
    --sans:'Archivo',system-ui,sans-serif; --mono:'IBM Plex Mono',monospace; --stamp:'Anton',sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--black);color:var(--bone);font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  ::selection{background:var(--blue);color:var(--bone)}
  .wrap{max-width:1000px;margin:0 auto;padding:0 24px}
  .mono{font-family:var(--mono)}

  nav{position:sticky;top:0;z-index:50;background:var(--c-nav);backdrop-filter:blur(14px);border-bottom:1px solid var(--hair)}
  .nav-in{display:flex;align-items:center;gap:22px;height:64px}
  .wordmark{font-weight:600;font-size:22px;letter-spacing:-.02em}
  .wordmark .o{color:var(--blue)}
  .nav-links{display:flex;gap:24px;font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:lowercase}
  .nav-links a{color:var(--mut);transition:color .2s}
  .nav-links a:hover,.nav-links a.on{color:var(--bone)}
  .nav-cta{margin-left:auto;font-family:var(--mono);font-size:12px;letter-spacing:.08em;background:var(--bone);color:var(--black);padding:9px 16px;border-radius:99px;transition:background .2s}
  .nav-cta:hover{background:var(--blue);color:var(--bone)}
  @media(max-width:720px){.nav-links{display:none}}

  section{padding:70px 0;border-bottom:1px solid var(--hair)}
  .kicker{font-family:var(--mono);font-size:12px;letter-spacing:.24em;color:var(--blue);margin-bottom:18px}
  h1{font-weight:600;font-size:clamp(34px,6vw,64px);letter-spacing:-.03em;line-height:1.02;max-width:16ch}
  h1 .g{color:var(--blue)}
  .lede{color:var(--mut2);font-size:clamp(15px,2vw,18px);margin-top:22px;max-width:52ch}

  /* headline rate */
  .rate-card{margin-top:44px;border:1px solid var(--hair2);border-radius:20px;background:linear-gradient(150deg,var(--ink2),var(--black));padding:44px;display:grid;grid-template-columns:auto 1fr;gap:40px;align-items:center}
  @media(max-width:680px){.rate-card{grid-template-columns:1fr;gap:24px;padding:32px 26px}}
  .rate-big{font-family:var(--stamp);font-size:clamp(84px,16vw,150px);line-height:.82;color:var(--blue)}
  .rate-big small{display:block;font-family:var(--mono);font-size:12px;letter-spacing:.2em;color:var(--mut);margin-top:14px}
  .rate-txt .flag{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--green);border:1px solid var(--green);border-radius:99px;padding:6px 13px;margin-bottom:16px}
  .rate-txt h2{font-size:24px;font-weight:600;letter-spacing:-.01em}
  .rate-txt p{color:var(--mut2);margin-top:12px;max-width:40ch}

  h2.sec{font-size:clamp(24px,3.5vw,36px);font-weight:600;letter-spacing:-.02em;line-height:1.1}

  /* breakdown */
  .flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:14px;align-items:stretch;margin-top:44px}
  @media(max-width:720px){.flow{grid-template-columns:1fr;gap:10px}.flow .arrow{transform:rotate(90deg);justify-self:center}}
  .flow .node{background:var(--ink);border:1px solid var(--hair);border-radius:14px;padding:22px}
  .flow .node.net{border-color:var(--blue)}
  .flow .node .nl{font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--mut)}
  .flow .node .nv{font-family:var(--mono);font-size:22px;font-weight:500;margin-top:8px}
  .flow .node.net .nv{color:var(--blue)}
  .flow .node .nd{font-size:12.5px;color:var(--mut2);margin-top:8px}
  .flow .arrow{display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:20px}

  /* calculator */
  .calc{margin-top:40px;background:var(--ink);border:1px solid var(--hair);border-radius:16px;padding:28px}
  .calc-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  @media(max-width:560px){.calc-grid{grid-template-columns:1fr}}
  label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--mut);margin-bottom:9px}
  .calc input{width:100%;background:var(--black);border:1px solid var(--hair2);border-radius:10px;color:var(--bone);font-family:var(--mono);font-size:16px;padding:14px 15px;outline:none}
  .calc input:focus{border-color:var(--blue)}
  .calc-out{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px;padding-top:24px;border-top:1px solid var(--hair)}
  @media(max-width:560px){.calc-out{grid-template-columns:1fr}}
  .co{background:var(--black);border-radius:10px;padding:16px}
  .co .col{font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--mut)}
  .co .cov{font-family:var(--mono);font-size:20px;font-weight:500;margin-top:8px}
  .co.zora .cov{color:var(--orange)}
  .co.net .cov{color:var(--blue)}

  /* includes / promise */
  .incl{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:40px}
  .inc{background:var(--ink);border:1px solid var(--hair);border-radius:14px;padding:22px}
  .inc .ic{width:36px;height:36px;border-radius:9px;background:var(--bluewash);color:var(--blue);display:flex;align-items:center;justify-content:center;margin-bottom:14px;font-size:17px}
  .inc h3{font-size:15.5px;font-weight:600}
  .inc p{color:var(--mut2);font-size:13.5px;margin-top:7px}

  .promise{display:flex;gap:16px;align-items:flex-start;background:linear-gradient(150deg,var(--ink2),var(--black));border:1px solid var(--hair2);border-radius:16px;padding:28px;margin-top:40px}
  .promise .pi{width:44px;height:44px;border-radius:11px;background:var(--bluewash);color:var(--blue);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px}
  .promise h3{font-size:19px;font-weight:600}
  .promise p{color:var(--mut2);margin-top:8px;max-width:56ch}

  .cta{text-align:center;border-bottom:none}
  .cta h2{font-size:clamp(26px,4vw,42px);font-weight:600;letter-spacing:-.02em}
  .cta p{color:var(--mut2);margin-top:16px}
  .big-btn{display:inline-block;margin-top:28px;background:var(--bone);color:var(--black);font-family:var(--mono);font-size:13px;font-weight:500;letter-spacing:.1em;padding:18px 38px;border-radius:99px;transition:all .2s}
  .big-btn:hover{background:var(--blue);color:var(--bone);transform:translateY(-2px)}

  footer{padding:40px 0}
  .foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.06em}
  .foot a{color:var(--mut)} .foot a:hover{color:var(--bone)}

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
  .zbot-status .d{width:6px;height:6px;border-radius:50%;background:var(--green)}
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

export default function CommissionPage() {
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
        <div className="wrap nav-in">
          <Wordmark href="/" />
          <div className="nav-links">
            <a href="/discover">events</a>
            <a href="/about">about</a>
            <a href="/commission" className="on">pricing</a>
            <a href="/help">help</a>
          </div>
          <a href="/dashboard/onboarding" className="nav-cta">START SELLING</a>
        </div>
      </nav>

      <section>
        <div className="wrap">
          <p className="kicker">PRICING &amp; COMMISSION</p>
          <h1>Fair pricing, in <span className="g">plain sight</span>.</h1>
          <p className="lede">One flat commission on tickets sold. No listing fees, no monthly fees, and — the part your crowd will love — nothing added at their checkout.</p>

          <div className="rate-card">
            <div className="rate-big">5%<small>PER TICKET SOLD</small></div>
            <div className="rate-txt">
              <span className="flag"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 21V4l7 2 7-2v11l-7 2-7-2" /></svg>TANZANIA LAUNCH RATE</span>
              <h2>5% flat, for our Tanzania starters.</h2>
              <p>For the initial rollout in Tanzania, platform commission is a competitive <b style={{ color: 'var(--bone)' }}>5%</b> of face value — well below the 10–15%+ (plus buyer fees) charged by the global platforms. Lock it in early.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="kicker">HOW IT WORKS</p>
          <h2 className="sec">Where every shilling goes.</h2>
          <div className="flow">
            <div className="node">
              <p className="nl">BUYER PAYS</p><p className="nv">50,000</p>
              <p className="nd">The face price you set. That&apos;s the exact number at checkout.</p>
            </div>
            <div className="arrow">&rarr;</div>
            <div className="node">
              <p className="nl">ZORA — 5%</p><p className="nv" style={{ color: 'var(--orange)' }}>2,500</p>
              <p className="nd">One flat line. Payments, dashboard, marketing — all in.</p>
            </div>
            <div className="arrow">&rarr;</div>
            <div className="node net">
              <p className="nl">YOU KEEP</p><p className="nv">47,500</p>
              <p className="nd">Settled to mobile money or bank on your schedule.</p>
            </div>
          </div>

          <Calc />
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="kicker">WHAT THE 5% INCLUDES</p>
          <h2 className="sec">Everything, actually.</h2>
          <div className="incl">
            <div className="inc"><div className="ic">&#9679;</div><h3>Payments &amp; payouts</h3><p>Card and mobile money in, fast settlement out. No separate processor bill.</p></div>
            <div className="inc"><div className="ic">&#9636;</div><h3>Your storefront</h3><p>A branded page at yourname.zora.com, live in minutes.</p></div>
            <div className="inc"><div className="ic">&#9650;</div><h3>Dashboard &amp; CRM</h3><p>Real-time sales, entry scans, and a customer database that&apos;s yours.</p></div>
            <div className="inc"><div className="ic">&#9993;</div><h3>Built-in marketing</h3><p>Native email to your audience. No Mailchimp, no add-on.</p></div>
          </div>

          <div className="promise">
            <div className="pi"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg></div>
            <div>
              <h3>Zero fees at checkout — the buyer promise.</h3>
              <p>The 5% comes out of your side, not theirs. Buyers see one honest number and pay exactly that. No service fee, no facility fee, no surprise on the last screen. It&apos;s the reason they trust the checkout.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="wrap">
          <h2>Lock in 5% while it lasts.</h2>
          <p>Open your dashboard, claim your address, and start selling today.</p>
          <a className="big-btn" href="/dashboard/onboarding">START SELLING ON ZORA</a>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <span>© 2026 ZORA · PRICING SHOWN IS THE TANZANIA LAUNCH RATE</span>
          <span><a href="/help">help centre</a> &middot; <a href="/about">about</a> &middot; <a href="/">home</a></span>
        </div>
      </footer>

      <ZBot />
    </>
  );
}
