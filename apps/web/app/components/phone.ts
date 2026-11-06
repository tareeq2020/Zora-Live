/* BS161 — pure phone helpers behind <PhoneField>. No React here, so the unit
   test can load it directly.

   The server normalizes every phone it gets (normalizeTzPhone in the API,
   normalizeMsisdn in core), so `+255712345678` lands exactly where `0712…`
   or `712…` did before. Add a country by adding one line to COUNTRIES. */

export type Country = {
  iso: string; // ISO 3166 alpha-2, shown as the short code
  name: string;
  dial: string; // digits, no '+'
  length: number; // national number length
  lead: RegExp; // what a valid national number starts with
  groups: number[]; // display grouping, e.g. 712 345 678
  example: string;
};

export const COUNTRIES: Country[] = [
  { iso: 'TZ', name: 'Tanzania', dial: '255', length: 9, lead: /^[67]/, groups: [3, 3, 3], example: '712 345 678' },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

export function countryOf(iso?: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) || DEFAULT_COUNTRY;
}

/** National digits from anything typed or pasted: `0712 345 678`, `712345678`,
    `+255 712…` or `255712…` all give `712345678`. */
export function nationalDigits(raw: string, c: Country = DEFAULT_COUNTRY): string {
  const s = String(raw ?? '').trim();
  let d = s.replace(/\D/g, '');
  // Drop the dial code when it is clearly there: a leading '+', or more digits
  // than a national number can hold.
  if (d.startsWith(c.dial) && (s.startsWith('+') || d.length > c.length)) d = d.slice(c.dial.length);
  if (d.startsWith('0')) d = d.slice(1); // trunk prefix
  return d.slice(0, c.length);
}

export function isValidNational(national: string, c: Country = DEFAULT_COUNTRY): boolean {
  return national.length === c.length && /^\d+$/.test(national) && c.lead.test(national);
}

/** `+255712345678`, or '' when there are no digits yet. */
export function toE164(national: string, c: Country = DEFAULT_COUNTRY): string {
  return national ? `+${c.dial}${national}` : '';
}

/** `712 345 678` (partial input groups as far as it goes). */
export function groupNational(national: string, c: Country = DEFAULT_COUNTRY): string {
  const out: string[] = [];
  let i = 0;
  for (const g of c.groups) {
    if (i >= national.length) break;
    out.push(national.slice(i, i + g));
    i += g;
  }
  if (i < national.length) out.push(national.slice(i));
  return out.join(' ');
}

export type PhoneValue = { country: string; national: string; e164: string; valid: boolean };

export function phoneValue(raw: string, c: Country = DEFAULT_COUNTRY): PhoneValue {
  const national = nationalDigits(raw, c);
  return { country: c.iso, national, e164: toE164(national, c), valid: isValidNational(national, c) };
}

/* Mobile-money network from a Tanzanian number (the 9 digits after +255). Only
   a hint for the UI and the `mno` the pay call already takes (VODACOM / TIGO /
   AIRTEL / HALOTEL); x-bridge picks the network itself. Unknown prefix → null. */
const PREFIX_MNO: Record<string, { id: string; name: string }> = {
  '74': { id: 'VODACOM', name: 'Vodacom' },
  '75': { id: 'VODACOM', name: 'Vodacom' },
  '76': { id: 'VODACOM', name: 'Vodacom' },
  '65': { id: 'TIGO', name: 'Yas' },
  '67': { id: 'TIGO', name: 'Yas' },
  '71': { id: 'TIGO', name: 'Yas' },
  '77': { id: 'TIGO', name: 'Yas' },
  '68': { id: 'AIRTEL', name: 'Airtel' },
  '69': { id: 'AIRTEL', name: 'Airtel' },
  '78': { id: 'AIRTEL', name: 'Airtel' },
  '61': { id: 'HALOTEL', name: 'Halotel' },
  '62': { id: 'HALOTEL', name: 'Halotel' },
};
export function networkFromNumber(local9: string): { id: string; name: string } | null {
  return local9.length >= 2 ? PREFIX_MNO[local9.slice(0, 2)] || null : null;
}
