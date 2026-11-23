import type { Metadata } from 'next';
import { DiscoverApp } from './discover-app';
import { DISCOVER_CSS } from './discover-shared';

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

export default function DiscoverPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DISCOVER_CSS }} />
      <div className="zd">
        <DiscoverApp />
      </div>
    </>
  );
}
