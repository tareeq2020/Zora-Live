'use client';

/* ThemeToggle — the floating top-right switch the legacy public/zora-theme.js
   appended to <body> at runtime (id/class/aria/title all preserved so the
   .zora-theme-toggle rule in zora-tokens.css styles it identically). The icon
   shows the CURRENT theme exactly as the legacy icon(mode) did: moon for dark,
   sun for light. Clicking flips + persists via useTheme. */

import { useTheme } from './theme-provider';

function MoonIcon() {
  // legacy icon('dark')
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  );
}

function SunIcon() {
  // legacy icon('light')
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      id="zora-theme-toggle"
      className="zora-theme-toggle"
      type="button"
      aria-label="Toggle dark or light mode"
      title="Toggle theme"
      onClick={toggle}
    >
      {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
