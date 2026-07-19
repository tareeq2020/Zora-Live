import type { Metadata } from 'next';
import { Wordmark } from '../../components/wordmark';
import { HelpApp } from './help-app';

/* /help — React port of public/help.html. Keeps its own nav/footer, inline
   <style> and per-page fonts. The search/chips/FAQ and the ZBot chat live in
   <HelpApp> (client); internal links are repointed to clean routes. */

export const metadata: Metadata = {
  title: 'ZORA — Help Centre',
  description:
    'Zora Help Centre. Answers on tickets, payments, accounts, refunds and organizing — plus live chat support.',
};

const CSS = `
  :root{
    --black:#0A0A0B; --ink:#101012; --ink2:#16161A; --hair:#26262B; --hair2:#33333A;
    --bone:#F4F1EA; --mut:#8A877E; --mut2:#B4B1A8;
    --blue:#3D5AFE; --bluewash:#161B3A; --green:#2FA9A0;
    --sans:'Archivo',system-ui,sans-serif; --mono:'IBM Plex Mono',monospace;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--black);color:var(--bone);font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  ::selection{background:var(--blue);color:var(--bone)}
  .wrap{max-width:860px;margin:0 auto;padding:0 24px}
  .mono{font-family:var(--mono)}

  nav{position:sticky;top:0;z-index:50;background:var(--c-nav);backdrop-filter:blur(14px);border-bottom:1px solid var(--hair)}
  .nav-in{display:flex;align-items:center;gap:22px;height:64px;max-width:1000px;margin:0 auto;padding:0 24px}
  .wordmark{font-weight:600;font-size:22px;letter-spacing:-.02em}
  .wordmark .o{color:var(--blue)}
  .nav-links{display:flex;gap:24px;font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:lowercase}
  .nav-links a{color:var(--mut);transition:color .2s}
  .nav-links a:hover,.nav-links a.on{color:var(--bone)}
  .nav-cta{margin-left:auto;font-family:var(--mono);font-size:12px;letter-spacing:.08em;background:var(--bone);color:var(--black);padding:9px 16px;border-radius:99px}
  .nav-cta:hover{background:var(--blue);color:var(--bone)}
  @media(max-width:720px){.nav-links{display:none}}

  .hero{padding:64px 0 40px;text-align:center;border-bottom:1px solid var(--hair)}
  .hero .kicker{font-family:var(--mono);font-size:12px;letter-spacing:.24em;color:var(--blue);margin-bottom:16px}
  .hero h1{font-weight:600;font-size:clamp(30px,5vw,50px);letter-spacing:-.03em}
  .hero p{color:var(--mut2);margin-top:14px}
  .searchbox{position:relative;max-width:520px;margin:30px auto 0}
  .searchbox input{width:100%;background:var(--ink);border:1px solid var(--hair2);border-radius:14px;color:var(--bone);font-size:15px;padding:16px 16px 16px 48px;outline:none;transition:border-color .2s}
  .searchbox input:focus{border-color:var(--blue)}
  .searchbox svg{position:absolute;left:17px;top:50%;transform:translateY(-50%);width:18px;height:18px;stroke:var(--mut);fill:none;stroke-width:2}

  .chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:26px 0;position:sticky;top:64px;background:var(--c-nav);backdrop-filter:blur(12px);z-index:40;border-bottom:1px solid var(--hair)}
  .chip{font-family:var(--mono);font-size:11.5px;letter-spacing:.06em;background:var(--ink);border:1px solid var(--hair);color:var(--mut2);padding:9px 15px;border-radius:99px;cursor:pointer;transition:all .18s}
  .chip:hover{border-color:var(--hair2);color:var(--bone)}
  .chip.on{background:var(--bone);color:var(--black);border-color:var(--bone)}

  main{padding:32px 0 70px}
  .cat-h{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--mut);margin:30px 0 14px}
  .faq{border:1px solid var(--hair);border-radius:12px;background:var(--ink);margin-bottom:10px;overflow:hidden}
  .faq summary{list-style:none;cursor:pointer;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;font-weight:500;font-size:15px}
  .faq summary::-webkit-details-marker{display:none}
  .faq summary .plus{color:var(--mut);font-size:20px;transition:transform .2s;flex-shrink:0}
  .faq[open] summary .plus{transform:rotate(45deg);color:var(--blue)}
  .faq .a{padding:0 20px 20px;color:var(--mut2);font-size:14px;line-height:1.65}
  .no-res{text-align:center;color:var(--mut);font-family:var(--mono);font-size:13px;padding:50px 0;display:none}

  .contact{margin-top:44px;border:1px solid var(--hair2);border-radius:16px;background:linear-gradient(150deg,var(--ink2),var(--black));padding:30px;text-align:center}
  .contact h3{font-size:20px;font-weight:600}
  .contact p{color:var(--mut2);margin-top:8px}
  .contact .btns{display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap}
  .btn{font-family:var(--mono);font-size:12px;letter-spacing:.08em;padding:13px 24px;border-radius:99px;cursor:pointer;border:1px solid var(--hair2);color:var(--bone);background:none}
  .btn:hover{border-color:var(--bone)}
  .btn.pri{background:var(--blue);border-color:var(--blue)}
  .btn.pri:hover{background:var(--bone);color:var(--black);border-color:var(--bone)}

  footer{padding:40px 0;border-top:1px solid var(--hair)}
  .foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.06em;max-width:1000px;margin:0 auto;padding:0 24px}
  .foot a:hover{color:var(--bone)}

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

export default function HelpPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <nav>
        <div className="nav-in">
          <Wordmark href="/" />
          <div className="nav-links">
            <a href="/discover">events</a>
            <a href="/about">about</a>
            <a href="/commission">pricing</a>
            <a href="/help" className="on">help</a>
          </div>
          <a href="/discover" className="nav-cta">FIND EVENTS</a>
        </div>
      </nav>

      <HelpApp />

      <footer>
        <div className="foot">
          <span>© 2026 ZORA · HELP CENTRE</span>
          <span><a href="/commission">pricing</a> &middot; <a href="/about">about</a> &middot; <a href="/">home</a></span>
        </div>
      </footer>
    </>
  );
}
