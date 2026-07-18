import type { ReactNode } from 'react';
import type { Metadata } from 'next';
// Global design tokens — the same stylesheet the static pages load via
// <link href="/zora-tokens.css">, now bundled into the React tree so every
// converted route inherits the token system. The file still serves statically
// from public/ for the not-yet-converted *.html pages; importing it here does
// not change that.
import '../public/zora-tokens.css';
import { ThemeProvider } from './components/theme-provider';

// Favicon: replicates zora-theme.js, which stripped page <link rel="icon"> tags
// and injected the real ZORA icon site-wide. Next emits the equivalent
// <link rel="icon" type="image/png" href="/assets/zora-icon.png"> for React routes.
export const metadata: Metadata = {
  title: 'ZORA',
  icons: { icon: { url: '/assets/zora-icon.png', type: 'image/png' } },
};

// No-flash theme boot — runs at <head> parse, before first paint, mirroring the
// top of zora-theme.js: read localStorage['zora-theme'] (default 'dark') and set
// data-theme on <html> so the correct palette is present before React hydrates.
// ThemeProvider adopts this value on mount; <html suppressHydrationWarning>
// tolerates the SSR('dark')→client attribute difference for light-theme users.
const NO_FLASH_THEME = `(function(){try{var t=localStorage.getItem('zora-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
