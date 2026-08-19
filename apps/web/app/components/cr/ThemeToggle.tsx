'use client';

/* CrThemeToggle — the control-room top-bar theme switch (Lane A · BS69).
   aria-pressed reflects "is dark active" (Pass 6); icon shows the CURRENT theme
   (sun in light, moon in dark). Flips + persists via useCrTheme. */

import { useCrTheme } from './theme';

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </svg>
  );
}

export function CrThemeToggle() {
  const { theme, toggle } = useCrTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="cr-theme-toggle"
      aria-label="Toggle light or dark mode"
      aria-pressed={isDark}
      title={isDark ? 'Switch to light' : 'Switch to dark'}
      onClick={toggle}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
