/* Regression: BS154 — the Control-Room (admin + organizer dashboards) follows
   the ZoraPass design handoff. Fails if the off-palette CR extras come back:
   the pink aura gradient, cyan/amber/blue washes, blurred drop shadows, or
   KPI/status tints outside bone · black · yellow · green · red.
     node --test apps/web/test/cr-tokens-handoff.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(web, p), 'utf8');
const css = read('app/components/cr/cr-tokens.css');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
// Every file that renders inside the control room.
const crFiles = [
  ...walk(join(web, 'app/components/cr')),
  ...walk(join(web, 'app/(app)/admin/console')),
  ...walk(join(web, 'app/(app)/dashboard')),
].filter((p) => /\.(tsx?|css)$/.test(p));
const rel = (p) => p.slice(web.length + 1);

test('no off-palette CR tokens are defined or used', () => {
  const banned = /--cr-(aura|cyan|amber|wash-[a-z]+|on-wash-[a-z]+)\b/;
  const hits = crFiles.filter((p) => banned.test(readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(hits, [], 'remove --cr-aura / --cr-cyan / --cr-amber / --cr-wash-* from: ' + hits.join(', '));
});

test('no blurred drop shadow token (--cr-shadow) and no shadow on CR chrome', () => {
  assert.ok(!/--cr-shadow\s*:/.test(css), '--cr-shadow is back in cr-tokens.css');
  const uses = crFiles.filter((p) => /var\(--cr-shadow\)/.test(readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(uses, [], 'var(--cr-shadow) used in: ' + uses.join(', '));
  // any box-shadow in the CR stylesheet must be blur-free (an inset bar is fine)
  for (const m of css.matchAll(/box-shadow:\s*([^;]+);/g)) {
    const v = m[1].trim();
    if (v === 'none') continue;
    const lengths = v.replace(/rgba?\([^)]*\)|#[0-9a-f]+|var\([^)]*\)|inset/gi, '').trim().split(/\s+/);
    assert.ok(!(lengths[2] && parseFloat(lengths[2]) > 0), 'blurred box-shadow in cr-tokens.css: ' + v);
  }
});

test('no blue washes (the pre-handoff #3D5AFE accent) in the dashboards', () => {
  // the floor-plan zone swatches are saved seat-map data (seat maps are not
  // settled in the handoff), so only that palette line is exempt
  const strip = (s) => s.replace(/const COLORS = \[[^\]]*\];/, '');
  const hits = crFiles.filter((p) => /rgba\(\s*61\s*,\s*90\s*,\s*254|#3D5AFE/i.test(strip(readFileSync(p, 'utf8')))).map(rel);
  assert.deepEqual(hits, [], 'blue wash found in: ' + hits.join(', '));
});

test('no gradients in the CR stylesheet except the select chevron', () => {
  const grads = [...css.matchAll(/(?:linear|radial|conic)-gradient\([^;]*/g)].map((m) => m[0]);
  const ok = grads.filter((g) => !/transparent 50%/.test(g));
  assert.deepEqual(ok, [], 'decorative gradient in cr-tokens.css: ' + ok.join(' | '));
});

test('CR colours are handoff values only', () => {
  // the hex values that may appear in cr-tokens.css (tokens.json color.*)
  const allowed = new Set(['#ffd21f', '#111111', '#f7f5ee', '#1c1c1c', '#0f7b3f', '#b42318', '#ffffff', '#262626', '#3a3a3a', '#4a4a4a', '#bdbdbd', '#d9d6cc', '#333333', '#e6bd1b', '#efede4', '#000000']);
  const hexes = [...new Set([...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];
  const off = hexes.filter((h) => !allowed.has(h));
  assert.deepEqual(off, [], 'off-palette hex in cr-tokens.css: ' + off.join(', '));
});

test('accent ink is not yellow on bone (light theme) and focus ring is 3px', () => {
  const light = css.slice(css.indexOf(":root[data-cr-theme='light']"), css.indexOf(":root[data-cr-theme='dark']"));
  assert.match(light, /--cr-accent:\s*#111111/, 'light --cr-accent must be ink (yellow text on bone is 1.3:1)');
  assert.match(light, /--cr-primary-bg:\s*#111111/);
  assert.match(light, /--cr-primary-fg:\s*#FFD21F/i);
  assert.match(css, /:focus-visible\s*\{\s*outline:\s*3px solid var\(--cr-focus\)/);
});

test('KPI tiles are flat (no per-tile tint rules) and chips have no dot', () => {
  assert.ok(!/\.cr-kpi-label\[data-tint=/.test(css), 'KPI label tint rules are back');
  assert.ok(!/\.cr-pill::before/.test(css), 'status chips got their dot back');
});
