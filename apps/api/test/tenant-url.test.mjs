/* Regression: BS147 — live home page linked every event card to dead
   http://<handle>.zorapass.com subdomains (no wildcard DNS) once the API saw a
   zorapass.com Host. Found by /qa on 2026-10-31 (live site).
     node --test apps/api/test/tenant-url.test.mjs   (after `pnpm --filter ./apps/api build`) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TenantService } = require('../dist/tenant/tenant.module.js');

const svc = new TenantService(null);
const req = (host) => ({ headers: { host }, protocol: 'http' });

test('event URL is the /@handle path on the live domain', () => {
  delete process.env.TENANT_SUBDOMAINS;
  assert.equal(svc.tenantEventUrl('autiinc', 'aut-underground', req('www.zorapass.com')), '/@autiinc/events/aut-underground');
  assert.equal(svc.tenantEventUrl('autiinc', 'aut underground', req('zorapass.com')), '/@autiinc/events/aut%20underground');
});

test('subdomains only when explicitly enabled, and always https', () => {
  process.env.TENANT_SUBDOMAINS = '1';
  assert.match(svc.tenantEventUrl('autiinc', 'x', req('www.zorapass.com')), /^https:\/\/autiinc\./);
  delete process.env.TENANT_SUBDOMAINS;
});
