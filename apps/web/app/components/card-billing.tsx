'use client';

/* BS166: the billing address a card payment needs.

   x-bridge's card provider asks for the card holder's address on every TZS
   card payment (GET /v1/payments/methods → billing_address_required). The
   checkout shows these fields only when the API says so
   (/api/payment-methods → card.billingRequired). Name and phone come from the
   fields the buyer already filled in; the server splits the name.

   We send the address to x-bridge and do not store it.

   Each checkout has its own look, so the host passes its own field classes.
   Fields use the host's <label><span>LABEL</span><input/></label> pattern. */

export interface BillingValue {
  address1: string;
  address2: string;
  city: string;
  stateOrRegion: string;
  postcodeOrPobox: string;
  country: string;
}

export const EMPTY_BILLING: BillingValue = {
  address1: '', address2: '', city: '', stateOrRegion: '', postcodeOrPobox: '', country: 'TZ',
};

/** Countries a card holder is likely to be billed in, Tanzania first. */
const COUNTRIES: ReadonlyArray<[string, string]> = [
  ['TZ', 'Tanzania'], ['KE', 'Kenya'], ['UG', 'Uganda'], ['RW', 'Rwanda'], ['BI', 'Burundi'],
  ['CD', 'DR Congo'], ['ZM', 'Zambia'], ['MW', 'Malawi'], ['MZ', 'Mozambique'], ['ZA', 'South Africa'],
  ['ET', 'Ethiopia'], ['NG', 'Nigeria'], ['GH', 'Ghana'], ['AE', 'United Arab Emirates'], ['OM', 'Oman'],
  ['SA', 'Saudi Arabia'], ['QA', 'Qatar'], ['IN', 'India'], ['CN', 'China'], ['GB', 'United Kingdom'],
  ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['BE', 'Belgium'],
  ['IT', 'Italy'], ['ES', 'Spain'], ['CH', 'Switzerland'], ['SE', 'Sweden'], ['NO', 'Norway'],
  ['DK', 'Denmark'], ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'],
];

const TZ_REGIONS = [
  'Dar es Salaam', 'Arusha', 'Dodoma', 'Mwanza', 'Kilimanjaro', 'Zanzibar', 'Pwani', 'Morogoro', 'Tanga',
  'Mbeya', 'Iringa', 'Kagera', 'Mara', 'Shinyanga', 'Tabora', 'Kigoma', 'Mtwara', 'Lindi', 'Ruvuma',
  'Singida', 'Manyara', 'Njombe', 'Geita', 'Simiyu', 'Katavi', 'Rukwa', 'Songwe', 'Pemba',
];

const LABELS: Record<string, string> = {
  address1: 'street address', city: 'city', stateOrRegion: 'region', postcodeOrPobox: 'postcode or P.O. box',
  country: 'country', firstname: 'first name', lastname: 'last name', phone: 'phone', email: 'email',
};

/** What is still missing, as a sentence, or null when complete. */
export function billingProblem(b: BillingValue): string | null {
  const missing = (['address1', 'city', 'stateOrRegion', 'postcodeOrPobox', 'country'] as const)
    .filter((k) => !b[k].trim());
  if (!missing.length) return null;
  return `Fill in your ${missing.map((k) => LABELS[k]).join(', ')} to pay by card.`;
}

/** The body the pay endpoint takes. address2 only when given. */
export function billingBody(b: BillingValue): Record<string, string> {
  return {
    address1: b.address1.trim(),
    ...(b.address2.trim() ? { address2: b.address2.trim() } : {}),
    city: b.city.trim(),
    stateOrRegion: b.stateOrRegion.trim(),
    postcodeOrPobox: b.postcodeOrPobox.trim(),
    country: b.country,
  };
}

/** Buyer-facing text for a refused card payment (POST /pay non-200), or null
    when the error is not a card one. */
export function cardPayError(d: { error?: string; message?: string; fields?: string[] } | null | undefined): string | null {
  switch (d?.error) {
    case 'card_unavailable':
      return 'Card payments are not available right now. Pay with mobile money instead.';
    case 'card_not_supported':
      return 'Card is not available for pay-in-parts yet. Pay with mobile money instead.';
    case 'email_required':
      return 'Enter your email to pay by card.';
    case 'billing_incomplete':
      return d.fields?.length
        ? `Fill in your ${d.fields.map((f) => LABELS[f] ?? f).join(', ')} to pay by card.`
        : d.message || 'Check your billing address and try again.';
    case 'card_gateway_down':
      return 'The card service is not answering. Try again in a minute, or pay with mobile money.';
    case 'card_refused':
      return d.message ? `The card payment could not start: ${d.message}` : 'The card payment could not start. Try again, or pay with mobile money.';
    default:
      return null;
  }
}

export function CardBillingFields({
  value, onChange, fieldClass, wideClass = '', idPrefix = 'cb',
}: {
  value: BillingValue;
  onChange: (next: BillingValue) => void;
  /** The host's field class (a label wrapping a span and an input). */
  fieldClass: string;
  /** Added to the fields that should span the full row. */
  wideClass?: string;
  idPrefix?: string;
}) {
  const set = (k: keyof BillingValue) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const wide = `${fieldClass} ${wideClass}`.trim();
  return (
    <>
      <label className={wide}>
        <span>STREET ADDRESS</span>
        <input autoComplete="address-line1" placeholder="e.g. Plot 12, Samora Avenue" value={value.address1} onChange={set('address1')} />
      </label>
      <label className={wide}>
        <span>APARTMENT, FLOOR (OPTIONAL)</span>
        <input autoComplete="address-line2" value={value.address2} onChange={set('address2')} />
      </label>
      <label className={fieldClass}>
        <span>CITY</span>
        <input autoComplete="address-level2" placeholder="e.g. Dar es Salaam" value={value.city} onChange={set('city')} />
      </label>
      <label className={fieldClass}>
        <span>REGION</span>
        <input
          autoComplete="address-level1"
          list={value.country === 'TZ' ? `${idPrefix}-regions` : undefined}
          placeholder={value.country === 'TZ' ? 'e.g. Dar es Salaam' : 'State or region'}
          value={value.stateOrRegion}
          onChange={set('stateOrRegion')}
        />
        {value.country === 'TZ' ? (
          <datalist id={`${idPrefix}-regions`}>
            {TZ_REGIONS.map((r) => <option key={r} value={r} />)}
          </datalist>
        ) : null}
      </label>
      <label className={fieldClass}>
        <span>POSTCODE OR P.O. BOX</span>
        <input autoComplete="postal-code" placeholder="e.g. 11101 or P.O. Box 123" value={value.postcodeOrPobox} onChange={set('postcodeOrPobox')} />
      </label>
      <label className={fieldClass}>
        <span>COUNTRY</span>
        <select autoComplete="country" value={value.country} onChange={set('country')}>
          {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
    </>
  );
}
