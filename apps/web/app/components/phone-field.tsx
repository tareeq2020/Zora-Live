'use client';

/* BS161 — the one phone input every buyer screen uses: a country selector
   (Tanzania only today, the default) plus the national number. Accepts typed
   or pasted `0712 345 678`, `712345678`, `+255 712…`, `255712…`; keeps the 9
   national digits and shows them grouped. Hosts hold `national` and send
   `toE164(national)` (`+255712345678`), which the server normalizes the same
   way it did the old forms.

   Handoff 03_COMPONENTS §7: label above in mono, 48px field, 2px border,
   16px text, black border + 3px outline on focus, error in words. Primitive
   --zp-color-* tokens only (the semantic ones flip on dark-theme pages); a
   dark host restyles it through the --zph-* variables. */

import { useId } from 'react';
import { COUNTRIES, countryOf, groupNational, networkFromNumber, phoneValue, type PhoneValue } from './phone';

export { toE164, networkFromNumber, type PhoneValue } from './phone';

export type PhoneFieldProps = {
  /** National digits, e.g. `712345678`. */
  value: string;
  onChange: (v: PhoneValue) => void;
  country?: string;
  onCountryChange?: (iso: string) => void;
  label?: string;
  hint?: string;
  error?: string | null;
  /** Show "Vodacom — from your number." under the field. */
  showNetwork?: boolean;
  autoFocus?: boolean;
  id?: string;
  className?: string;
};

export default function PhoneField({
  value,
  onChange,
  country = COUNTRIES[0].iso,
  onCountryChange,
  label = 'Phone',
  hint,
  error,
  showNetwork,
  autoFocus,
  id,
  className,
}: PhoneFieldProps) {
  const auto = useId();
  const inputId = id || `zph-${auto}`;
  const c = countryOf(country);
  const net = showNetwork ? networkFromNumber(value) : null;
  const note = error || (net ? `${net.name} — from your number.` : hint);
  const noteId = note ? `${inputId}-note` : undefined;

  return (
    <div className={'zph' + (error ? ' bad' : '') + (className ? ' ' + className : '')}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <label className="zph-lab" htmlFor={inputId}>
        {label}
      </label>
      <div className="zph-row">
        <select
          className="zph-cc"
          aria-label="Country"
          value={c.iso}
          onChange={(e) => {
            const next = countryOf(e.target.value);
            onCountryChange?.(next.iso);
            onChange(phoneValue(value, next));
          }}
        >
          {COUNTRIES.map((x) => (
            <option key={x.iso} value={x.iso}>
              {x.iso} +{x.dial}
            </option>
          ))}
        </select>
        <input
          id={inputId}
          className="zph-in"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          autoFocus={autoFocus}
          placeholder={c.example}
          value={groupNational(value, c)}
          aria-invalid={error ? true : undefined}
          aria-describedby={noteId}
          onChange={(e) => onChange(phoneValue(e.target.value, c))}
        />
      </div>
      {note ? (
        <p className={'zph-note' + (error ? ' err' : '')} id={noteId}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

const CSS = `
:where(.zph),:where(.zph) *{box-sizing:border-box}
.zph{--zph-bg:var(--zp-color-white);--zph-ink:var(--zp-color-board-black);--zph-mut:var(--zp-color-ink-500);--zph-line:var(--zp-color-line-light);
  --zph-focus:var(--zp-color-board-black);--zph-ring:var(--zp-color-signal-yellow);--zph-err:var(--zp-color-alert-red);
  display:block;margin-top:16px;min-width:0}
.zph .zph-lab{display:block;font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--zph-mut);margin:0 0 8px;padding:0}
.zph .zph-row{display:flex;gap:8px;margin:0;padding:0}
.zph .zph-cc,.zph .zph-in{height:48px;min-height:48px;margin:0;border:2px solid var(--zph-line);border-radius:12px;background:var(--zph-bg);color:var(--zph-ink);font-size:16px}
.zph .zph-cc{flex:0 0 auto;padding:0 10px;font-family:var(--zp-font-family-mono);cursor:pointer}
.zph .zph-in{flex:1 1 auto;min-width:0;width:100%;padding:0 14px;font-family:var(--zp-font-family-mono);letter-spacing:.02em}
.zph .zph-in::placeholder{color:var(--zph-mut);opacity:1}
.zph .zph-cc:focus-visible,.zph .zph-in:focus{border-color:var(--zph-focus);outline:3px solid var(--zph-ring);outline-offset:2px}
.zph.bad .zph-in{border-color:var(--zph-err)}
.zph .zph-note{font-family:var(--zp-font-family-sans);font-size:14px;line-height:1.4;color:var(--zph-mut);margin:6px 0 0;padding:0;letter-spacing:0;text-transform:none}
.zph .zph-note.err{color:var(--zph-err)}
`;
