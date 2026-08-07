/* Consumer-identity phone normalization (TZ). Produces the canonical MSISDN
   `255XXXXXXXXX` (digits, no '+') — the SAME shape checkout keys customers by, so
   a buyer signing in via OTP and paying at checkout resolve to ONE customer row.

   Handles the forms the +255-prefixed UI and shared links produce:
     0712345678     -> 255712345678   (local, leading 0)
     712345678      -> 255712345678   (bare 9-digit — what the +255 field submits)
     255712345678   -> 255712345678
     +255 712 345…  -> 255712345678

   NOTE: this is DISTINCT from @zora/core's normalizeMsisdn, which returns a
   leading '+' and is the format the PAYMENT GATEWAY wants — use that only for the
   payer phone handed to initiatePayment, never for customer identity. */
export function normalizeTzPhone(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('255')) return d;
  if (d.startsWith('0')) return '255' + d.slice(1);
  if (d.length === 9) return '255' + d;
  return d;
}

/** A well-formed TZ mobile MSISDN: 255 + 9 digits. */
export function isValidTzMsisdn(p: string): boolean {
  return /^255\d{9}$/.test(p);
}
