/* Single source of truth for the session/KYC secrets — env only (the API is
   disk-free; there is no .session-secret file anymore).

   SESSION_SECRET signs the stateless session cookie. KYC_SECRET derives the KYC
   AES key, so it MUST equal the value that encrypted existing .enc docs (the old
   data/.session-secret contents) or those documents won't decrypt. Both are
   trimmed defensively. */
export function resolveSessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || !s.trim()) throw new Error('SESSION_SECRET is required (set it in the environment)');
  return s.trim();
}

export function resolveKycSecret(): string {
  const s = process.env.KYC_SECRET;
  if (!s || !s.trim()) throw new Error('KYC_SECRET is required (set it in the environment)');
  return s.trim();
}
