/* PR-BS89 — admin console migration guard.

   A cheap, boot-free static check that the seven super-admin sections migrated
   off the legacy /admin/dashboard deep-links and now resolve to real
   /admin/console/{section} routes on the CR shell. It asserts:
     · the console nav no longer contains any /admin/dashboard#… hash link;
     · every migrated section has a page.tsx + a client that renders the
       AdminConsoleShell and reuses the shared admin-kit endpoints.

   Run: node apps/web/test/admin-console-routes.test.mjs */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(here, '../app/(app)/admin/console');

let pass = 0;
const fails = [];
const ok = (label) => {
  pass++;
  console.log(`✓ ${label}`);
};
const bad = (label, detail) => fails.push(`✗ ${label}${detail ? `\n    ${detail}` : ''}`);

const SECTIONS = [
  ['verification', 'verification-client.tsx'],
  ['payouts', 'payouts-client.tsx'],
  ['organizers', 'organizers-client.tsx'],
  ['payments', 'payments-client.tsx'],
  ['scanner', 'scanner-client.tsx'],
  ['media', 'media-client.tsx'],
  ['access', 'access-client.tsx'],
];

// 1. The nav is fully migrated — no legacy hash deep-links remain.
const shell = readFileSync(path.join(consoleDir, 'console-shell.tsx'), 'utf8');
const navBlock = shell.slice(shell.indexOf('const NAV'), shell.indexOf('];', shell.indexOf('const NAV')));
if (/href:\s*['"]\/admin\/dashboard#/.test(navBlock)) bad('console nav has no legacy #hash deep-links', 'found an /admin/dashboard#… href in NAV');
else ok('console nav has no legacy #hash deep-links');

// 2. Each migrated section is a real console route wired into the nav.
for (const [section, clientFile] of SECTIONS) {
  const dir = path.join(consoleDir, section);
  const page = path.join(dir, 'page.tsx');
  const client = path.join(dir, clientFile);

  if (!existsSync(page)) bad(`${section}: page.tsx exists`);
  else if (!existsSync(client)) bad(`${section}: ${clientFile} exists`);
  else {
    const src = readFileSync(client, 'utf8');
    const problems = [];
    if (!src.includes('AdminConsoleShell')) problems.push('does not render AdminConsoleShell');
    if (!src.includes("from '../../dashboard/admin-kit'")) problems.push('does not reuse the shared admin-kit endpoints');
    if (!navBlock.includes(`/admin/console/${section}`)) problems.push('nav does not link to the console route');
    if (problems.length) bad(`${section}: migrated to the CR console`, problems.join('; '));
    else ok(`${section}: migrated to the CR console`);
  }
}

if (fails.length) {
  console.error(`\n${fails.length} check(s) failed:\n` + fails.join('\n'));
  process.exit(1);
}
console.log(`\nAll ${pass} admin-console migration checks passed.`);
