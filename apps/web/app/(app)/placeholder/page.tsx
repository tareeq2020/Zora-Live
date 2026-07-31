import type { Metadata } from 'next';
import Link from 'next/link';

// BS24: the apex home is a deliberate PLACEHOLDER while the marketplace home is
// still being built. middleware rewrites '/' here (was → /discover). Discovery is
// still reachable directly at /discover, so restoring it as home is a one-line
// revert in middleware.ts. Fixed Zora consumer dark canvas + Space Grotesk/Inter.

export const metadata: Metadata = {
  title: 'Zora — coming soon',
  description: 'Zora is the home for live events and passes. Something great is on the way.',
};

export default function PlaceholderPage() {
  return (
    <main className="zora-soon">
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="wrap">
        <span className="mark">
          z<span className="o">o</span>ra
        </span>
        <p className="eyebrow">LIVE EVENTS · PASSES · TANZANIA</p>
        <h1>Something great is on the way.</h1>
        <p className="lede">
          We&apos;re putting the finishing touches on the new Zora home. In the meantime, you can still explore live
          events and grab your passes.
        </p>
        <div className="actions">
          <Link className="cta" href="/discover">
            Explore live events →
          </Link>
          <Link className="ghost" href="/dashboard">
            Organizer sign in
          </Link>
        </div>
      </div>
      <p className="foot">runs on zora — no fees at checkout, ever</p>
    </main>
  );
}

const STYLE = `
.zora-soon{--paper:#0A0B10;--ink:#EDEFF7;--mut:#9BA3C4;--hair:rgba(255,255,255,.12);--accent:#4C6FFF;--display:'Space Grotesk',system-ui,sans-serif;--body:'Inter',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;background:var(--paper);color:var(--ink);font-family:var(--body);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 24px;-webkit-font-smoothing:antialiased}
.zora-soon *{margin:0;padding:0;box-sizing:border-box}
.zora-soon a{color:inherit;text-decoration:none}
.zora-soon .wrap{max-width:560px;display:flex;flex-direction:column;align-items:center;gap:22px}
.zora-soon .mark{font-family:var(--display);font-weight:600;font-size:34px;letter-spacing:-.02em}
.zora-soon .mark .o{color:var(--accent)}
.zora-soon .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.28em;color:var(--mut)}
.zora-soon h1{font-family:var(--display);font-weight:600;font-size:clamp(30px,6vw,52px);line-height:1.05;letter-spacing:-.02em}
.zora-soon .lede{font-size:16px;color:var(--mut);line-height:1.65;max-width:44ch}
.zora-soon .actions{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:6px}
.zora-soon .cta{background:var(--accent);color:#fff;font-weight:600;font-size:14px;padding:14px 24px;border-radius:12px;transition:opacity .2s}
.zora-soon .cta:hover{opacity:.9}
.zora-soon .ghost{border:1px solid var(--hair);color:var(--ink);font-family:var(--mono);font-size:12px;letter-spacing:.06em;padding:14px 20px;border-radius:12px;transition:border-color .2s}
.zora-soon .ghost:hover{border-color:var(--ink)}
.zora-soon .foot{position:fixed;bottom:22px;left:0;right:0;text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--mut)}
`;
