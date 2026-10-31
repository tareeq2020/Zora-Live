// theme.ts — ZoraPass design tokens with dark + light palettes and a persisted mode.
// Migration-safe: the static `z` export stays = DARK, so any screen not yet
// switched to useZ() keeps working. Screens that call `const z = useZ()` react
// to the toggle.
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const brand = {
  signal: '#FFD21F',
  black: '#111111',
  bone: '#F7F5EE',
  green: '#0F7B3F',
  blue: '#1597D4',
  // Back-compat for screens still expecting the old gradient tuple.
  from: '#FFD21F',
  mid: '#FFD21F',
  to: '#FFD21F',
};
const shared = {
  brand,
  green: '#0F7B3F', red: '#B42318', amber: '#FFD21F',
  r: 16, rSm: 12, rLg: 24,
  // TODO(mobile brand PR): swap these to Bungee, Bricolage Grotesque, and
  // IBM Plex Mono once the Expo package-lock can be updated with npm.
  disp: 'Anton_400Regular',
  brandFont: 'Michroma_400Regular',
  bodyFont: undefined,
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
};

export const DARK = {
  ...shared,
  bg: '#111111', panel: '#1C1C1C', panel2: '#000000',
  line: '#333333', line2: 'rgba(247,245,238,0.10)',
  bone: '#F7F5EE', mut: '#BDBDBD', mut2: 'rgba(247,245,238,0.58)',
  silver: '#F7F5EE', halo: 'rgba(255,210,31,0.18)',
  ultra: '#FFD21F', ultraSoft: '#FFD21F', orange: '#FFD21F', orangeSoft: '#FFD21F',
};

export const LIGHT = {
  ...shared,
  bg: '#F7F5EE', panel: '#FFFFFF', panel2: '#EFEDE4',
  line: '#D9D6CC', line2: 'rgba(17,17,17,0.08)',
  bone: '#111111', mut: '#4A4A4A', mut2: 'rgba(17,17,17,0.56)',
  silver: '#3A3A3A', halo: 'rgba(255,210,31,0.24)',
  ultra: '#111111', ultraSoft: '#111111', orange: '#FFD21F', orangeSoft: '#BC9C1B',
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
