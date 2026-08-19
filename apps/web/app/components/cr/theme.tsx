'use client';

/* Control-Room theme — Lane A (BS69).

   The control-room runs its OWN theme, independent of the consumer plane's
   `data-theme` / `zora-theme` (which stays fixed-dark). We flip the html
   attribute `data-cr-theme` ("light" default · "dark" alternate), persist the
   choice in localStorage under `zora-cr-theme`, and respect
   `prefers-color-scheme` on first visit (DESIGN.md Pass 6).

   No-FOUC: the real pre-paint attribute set happens in the root <head> script
   (see app/layout.tsx → NO_FLASH_CR_THEME). This provider only mirrors that
   already-committed value into React state and owns writes from here on. */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export const CR_THEME_KEY = 'zora-cr-theme';
export const CR_THEME_ATTR = 'data-cr-theme';
export type CrTheme = 'light' | 'dark';

/** The inline <head> script body — the single source of no-FOUC boot logic.
 *  Exported so app/layout.tsx injects the exact same string. Light default;
 *  first visit honours prefers-color-scheme; any throw falls back to light. */
export const CR_THEME_BOOT = `(function(){try{var k='${CR_THEME_KEY}';var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.setAttribute('${CR_THEME_ATTR}',t);}catch(e){document.documentElement.setAttribute('${CR_THEME_ATTR}','light');}})();`;

type CrThemeContextValue = {
  theme: CrTheme;
  setTheme: (t: CrTheme) => void;
  toggle: () => void;
};

const CrThemeContext = createContext<CrThemeContextValue | null>(null);

function applyTheme(t: CrTheme) {
  document.documentElement.setAttribute(CR_THEME_ATTR, t);
}

function readTheme(): CrTheme {
  // Prefer what the no-flash boot committed to <html>; then localStorage;
  // then prefers-color-scheme; then the light default.
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute(CR_THEME_ATTR);
    if (attr === 'light' || attr === 'dark') return attr;
  }
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(CR_THEME_KEY) : null;
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable */
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function CrThemeProvider({ children }: { children: ReactNode }) {
  // SSR + first client render emit the light default so markup matches; the
  // real value is adopted in the effect. The <html> attribute is already correct
  // pre-paint thanks to the boot script.
  const [theme, setThemeState] = useState<CrTheme>('light');

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = useCallback((t: CrTheme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem(CR_THEME_KEY, t);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(readTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return <CrThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</CrThemeContext.Provider>;
}

export function useCrTheme(): CrThemeContextValue {
  const ctx = useContext(CrThemeContext);
  if (!ctx) throw new Error('useCrTheme must be used within <CrThemeProvider>');
  return ctx;
}
