'use client';

/* ThemeProvider / useTheme — the React home for the theme half of the legacy
   public/zora-theme.js. That script:
     • read localStorage['zora-theme'] (default 'dark')
     • write document.documentElement[data-theme]
     • persist the choice back to localStorage on toggle
   The no-flash boot script in app/layout.tsx already sets data-theme before
   paint (same key + default), so this provider only mirrors that value into
   React state and owns writes from here on. It renders no DOM of its own. */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export const THEME_KEY = 'zora-theme';
export type Theme = 'dark' | 'light';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
}

function readTheme(): Theme {
  // Prefer what the no-flash script already committed to the <html> element;
  // fall back to localStorage, then the legacy 'dark' default.
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
  }
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR + first client render must agree: emit the legacy default ('dark') so
  // markup matches. The real value is adopted in the effect below; the attribute
  // itself is already correct on <html> thanks to the no-flash boot script, and
  // <html suppressHydrationWarning> tolerates the transient state mismatch.
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(readTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
