/* Regression: BS147 — defects found by /qa on the live site (2026-10-31).
     node apps/web/test/live-qa.test.mjs   (run from apps/web or repo root) */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(web, p), 'utf8');
let failed = 0;
const check = (name, ok, hint) => { if (ok) console.log('✓ ' + name); else { failed++; console.log('✗ ' + name + '\n    ' + hint); } };

// ISSUE 2: the home page ("/" renders Discover) got the legacy SiteNav/SiteFooter.
const chrome = read('app/(marketing)/marketing-chrome.tsx');
check("'/' opts out of the legacy marketing chrome", /OWN_CHROME = new Set\(\[[^\]]*'\/'[,\]]/.test(chrome), "add '/' to OWN_CHROME in marketing-chrome.tsx");

// ISSUE 3: no global body margin reset → 8px frame round every page.
check('global html/body margin reset', /html,\s*body\s*\{[^}]*margin:\s*0/.test(read('public/zora-tokens.css')), 'add html,body{margin:0} to public/zora-tokens.css');

// Button-colour bug: `.scope a{color:inherit}` outranks `.btn{color:…}` → label = parent colour.
const files = [
  'app/(marketing)/discover/page.tsx',
  'app/(app)/storefront/[handle]/storefront-client.tsx',
  'app/(app)/pay/[orderId]/pay-client.tsx',
  'app/components/checkout-flow-v2.tsx',
];
for (const f of files) {
  const bad = read(f).match(/(^|[\s},])\.[a-z][\w-]* (a|button|input)\s*[,{][^}]*color:\s*inherit/m);
  check(`${f}: link/button colour reset is zero-specificity`, !bad, `wrap it as :where(.scope) a{color:inherit} (found "${bad && bad[0].trim()}")`);
}

// BS149: the same specificity trap anywhere in apps/web, and undefined --zp-* tokens.
import { readdirSync, statSync } from 'node:fs';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const src = walk(join(web, 'app')).filter((p) => /\.(tsx?|css)$/.test(p));
const trap = src.filter((p) => /^\s*\.[a-zA-Z][\w-]* (a|button|input)\s*[,{][^}]*color:\s*inherit/m.test(readFileSync(p, 'utf8')));
check('no scope-level link/button colour reset outranks button classes (whole app)', trap.length === 0, 'use :where(.scope) in: ' + trap.map((p) => p.slice(web.length + 1)).join(', '));
const defined = new Set([...read('public/brand/design-tokens/zorapass.css').matchAll(/(--zp-[a-z0-9-]+)\s*:/g), ...read('public/zora-tokens.css').matchAll(/(--zp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const used = new Set(src.flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/var\((--zp-[a-z0-9-]+)/g)].map((m) => m[1])));
const undef = [...used].filter((v) => !defined.has(v));
check('every var(--zp-*) used in apps/web is defined', undef.length === 0, 'undefined: ' + undef.join(', '));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
