/* Control-Room v2 shared component library (Lane A · BS69).
   The reusable primitives both the organizer and admin consoles consume.
   Import from '@/app/components/cr' (or a relative path). The CR token
   stylesheet is pulled in by CrShell; standalone users of a single primitive
   should also `import '.../components/cr/cr-tokens.css'` (or render inside a
   <CrShell>) so the `--cr-*` vars + `.cr-*` classes resolve. */

export { CrShell } from './CrShell';
export type { CrShellProps, CrNavItem } from './CrShell';

export { CrNavIcon } from './CrNavIcon';

export { CrDrawer } from './CrDrawer';
export type { CrDrawerProps } from './CrDrawer';

export { CrPromptBar } from './CrPromptBar';

export { CrThemeProvider, useCrTheme, CR_THEME_KEY, CR_THEME_ATTR, CR_THEME_BOOT } from './theme';
export type { CrTheme } from './theme';
export { CrThemeToggle } from './ThemeToggle';

export { KPITile, KPIRow } from './KpiTile';
export type { KpiTileProps, KpiTint } from './KpiTile';

export { HeroChart } from './HeroChart';
export type { HeroChartProps, ChartPoint, ChartRange } from './HeroChart';

export { DataTable } from './DataTable';
export type { DataTableProps, Column } from './DataTable';

export { StatusPill, toneForStatus } from './StatusPill';
export type { PillTone } from './StatusPill';
