// theme.ts — Zora design tokens with dark + light palettes and a persisted mode.
// Migration-safe: the static `z` export stays = DARK, so any screen not yet
// switched to useZ() keeps working. Screens that call `const z = useZ()` react
// to the toggle.
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const brand = { from: '#C738C6', mid: '#E94E8E', to: '#FF8A4C', magenta: '#E1449E', orange: '#FF8A4C' };
const shared = {
  brand,
  green: '#17B368', red: '#FF3B30', amber: '#E9A83B',
  r: 16, rSm: 10, rLg: 24,
  disp: 'Anton_400Regular', brandFont: 'Michroma_400Regular', mono: 'SpaceMono_400Regular', monoBold: 'SpaceMono_700Bold',
};

export const DARK = {
  ...shared,
  bg: '#0A0A0B', panel: '#141417', panel2: '#1B1B20',
  line: 'rgba(244,241,234,0.10)', line2: 'rgba(244,241,234,0.055)',
  bone: '#F4F1EA', mut: 'rgba(244,241,234,0.56)', mut2: 'rgba(244,241,234,0.34)',
  silver: '#C9CCD4', halo: 'rgba(244,241,234,0.14)',
  ultra: '#3D5AFE', ultraSoft: '#93a6ff', orange: '#FF5A1F', orangeSoft: '#ffab86',
};

export const LIGHT = {
  ...shared,
  bg: '#F4F6FC', panel: '#FFFFFF', panel2: '#EEF1FA',
  line: 'rgba(40,50,90,0.12)', line2: 'rgba(40,50,90,0.07)',
  bone: '#0C1020', mut: 'rgba(12,16,32,0.60)', mut2: 'rgba(12,16,32,0.40)',
  silver: '#4E5675', halo: 'rgba(12,16,32,0.08)',
  ultra: '#3A54E8', ultraSoft: '#3A54E8', orange: '#FF5A1F', orangeSoft: '#C2531F',
};

export type ZTheme = typeof DARK;

// Static default (dark). Used by module-level styles + not-yet-migrated screens.
export const z: ZTheme = DARK;
export const BRAND_GRADIENT = [brand.from, brand.mid, brand.to] as const;

// ── theme mode store (persisted, mirrors the website's 'zora-theme' key) ──
type Mode = 'dark' | 'light';
interface ThemeState { mode: Mode; setMode: (m: Mode) => void; toggle: () => void; hydrate: () => void; }

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'dark',
  setMode: (mode) => { set({ mode }); AsyncStorage.setItem('zora-theme', mode).catch(() => {}); },
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
  hydrate: () => { AsyncStorage.getItem('zora-theme').then((m) => { if (m === 'light' || m === 'dark') set({ mode: m }); }); },
}));

/** Current palette — call inside a component so it re-renders on toggle. */
export const useZ = (): ZTheme => (useThemeStore((s) => s.mode) === 'light' ? LIGHT : DARK);
