import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_SETTINGS, DEFAULT_TIERS, DEFAULT_ORGANIZERS } from '../common/defaults';

/* First-run setup — mirrors server.js lines 34-77: admin account, session secret,
   seed settings/tiers/organizers, KYC private dir. Idempotent (skips existing
   files), so pointing at the legacy oracle's populated data dir is a no-op. */
export function seed(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const p = (n: string) => path.join(dataDir, n);
  const write = (n: string, d: unknown) => fs.writeFileSync(p(n), JSON.stringify(d, null, 2), 'utf8');

  if (!fs.existsSync(p('admin.json'))) {
    write('admin.json', { username: 'admin', passwordHash: bcrypt.hashSync('zora2026', 10) });
    console.log('First run: admin account created (admin / zora2026). Change it in Admin -> Access.');
  }

  // Only mint a local secret file when there's no SESSION_SECRET env (prod supplies
  // it). Avoids writing an unused random file when the env var is authoritative.
  const secretFile = p('.session-secret');
  if (!process.env.SESSION_SECRET && !fs.existsSync(secretFile)) {
    fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
  }

  if (!fs.existsSync(p('settings.json')))   write('settings.json', DEFAULT_SETTINGS);
  if (!fs.existsSync(p('tiers.json')))      write('tiers.json', DEFAULT_TIERS);
  if (!fs.existsSync(p('organizers.json'))) write('organizers.json', DEFAULT_ORGANIZERS);

  fs.mkdirSync(path.join(dataDir, 'kyc-private'), { recursive: true });
}
