import * as fs from 'fs';
import * as path from 'path';

/* Single source of truth for the session/KYC secret.
   Production: set SESSION_SECRET env. Dev: falls back to the local
   data/.session-secret file (untracked). The KYC AES key derives from this
   value, so to keep existing encrypted docs readable the env value MUST equal
   whatever encrypted them — i.e. the contents of data/.session-secret.

   The file is read untrimmed (that's how the existing .enc were keyed); only the
   env value is trimmed, defensively. */
export function resolveSessionSecret(dataDir: string): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return fs.readFileSync(path.join(dataDir, '.session-secret'), 'utf8');
}

/* KYC encryption key material — SEPARATE from the session-signing secret.
   KYC_SECRET env in prod (set it to the value that encrypted existing .enc docs),
   else the local data/.session-secret file (dev). Read untrimmed from the file so
   existing docs stay decryptable; env value trimmed defensively. */
export function resolveKycSecret(dataDir: string): string {
  const fromEnv = process.env.KYC_SECRET;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return fs.readFileSync(path.join(dataDir, '.session-secret'), 'utf8');
}
