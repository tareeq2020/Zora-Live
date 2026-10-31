/* PR-BS137 — release-QA guards (boot-free, static).

   1. Every /dashboard/<section> whose page renders its own Control-Room <CrShell>
      is listed in the dashboard layout's OWN_CHROME, or the legacy
      <DashboardShell> wraps it too and the page shows two sidebars
      (found by /qa on /dashboard/analytics, 2026-10-31).
   2. The root layout loads the ZoraPass faces with a <link>. fonts.css's
      @import is bundled after other rules, where browsers ignore it, so without
      the link Bungee / Bricolage / Plex Mono never load on React routes.

   Run: node apps/web/test/shell-and-fonts.test.mjs */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../app');
const dash = path.join(app, '(app)/dashboard');

const fails = [];
let pass = 0;
const ok = (l) => { pass++; console.log(`✓ ${l}`); };
const bad = (l, d) => fails.push(`✗ ${l}${d ? `\n    ${d}` : ''}`);

// ── 1. CrShell pages are excluded from the legacy DashboardShell ──
const layout = readFileSync(path.join(dash, 'layout.tsx'), 'utf8');
const ownChrome = [...layout.slice(layout.indexOf('OWN_CHROME'), layout.indexOf('];', layout.indexOf('OWN_CHROME'))).matchAll(/'([^']+)'/g)].map((m) => m[1]);

const filesUnder = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? filesUnder(p) : /\.tsx$/.test(f) ? [p] : [];
});

for (const section of readdirSync(dash)) {
  const dir = path.join(dash, section);
  if (!statSync(dir).isDirectory() || !existsSync(path.join(dir, 'page.tsx'))) continue;
  const usesCrShell = filesUnder(dir).some((f) => /<CrShell\b/.test(readFileSync(f, 'utf8')));
  if (!usesCrShell) continue;
  const route = `/dashboard/${section}`;
  if (ownChrome.some((p) => route.startsWith(p))) ok(`${route} renders its own CrShell and is in OWN_CHROME`);
  else bad(`${route} renders <CrShell> but is not in OWN_CHROME`, 'add it to apps/web/app/(app)/dashboard/layout.tsx or it gets two sidebars');
}

// ── 2. Root layout links the ZoraPass faces ──
const root = readFileSync(path.join(app, 'layout.tsx'), 'utf8');
const link = root.match(/rel="stylesheet"\s+href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/);
if (!link) bad('root layout <link>s the Google Fonts stylesheet');
else {
  for (const fam of ['Bungee', 'Bricolage+Grotesque', 'IBM+Plex+Mono']) {
    if (link[1].includes(`family=${fam}`)) ok(`root layout loads ${fam.replace(/\+/g, ' ')}`);
    else bad(`root layout loads ${fam.replace(/\+/g, ' ')}`, link[1]);
  }
}

if (fails.length) {
  console.error(`\n${fails.join('\n')}\n\n${pass} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed`);
