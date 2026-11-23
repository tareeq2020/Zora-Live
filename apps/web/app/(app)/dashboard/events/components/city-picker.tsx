'use client';

/* BS168: the event-city field. A type-to-search list of the cities ZoraPass
   runs in (GET /api/org/cities). Typing "dsm" finds Dar es Salaam through its
   other spellings, so every event still lands on exactly one city id.

   A city that isn't listed: the last option asks for it (POST
   /api/org/cities/request). The organizer keeps working; the event can be
   published, and it joins the city's page once an admin approves the city.

   ARIA combobox pattern: arrow keys move, Enter picks, Escape closes. */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cityKey as key } from '@zora/core/city-key';

export type OrgCity = { id: string; name: string; country: string; currency: string; aliases: string[]; status: string };

const MAX_SHOWN = 8;

type Option = { kind: 'city'; city: OrgCity } | { kind: 'request'; name: string };

export function CityPicker({
  value,
  cities,
  onChange,
  onRequest,
  inputId,
}: {
  value: string;
  cities: OrgCity[];
  onChange: (id: string) => void;
  onRequest: (name: string) => Promise<{ city: OrgCity; matched: boolean }>;
  /** The input's id, for the field's <label htmlFor>. */
  inputId?: string;
}) {
  const listId = useId();
  const selected = cities.find((c) => c.id === value);
  const [text, setText] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = useRef(false);

  // Follow the value when it changes from outside (load, prefill).
  useEffect(() => {
    if (!editing.current) setText(selected?.name ?? (value ? value : ''));
  }, [value, selected?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = key(text);
  const options: Option[] = useMemo(() => {
    const showingSelected = selected && q === key(selected.name);
    const matches = !q || showingSelected
      ? cities
      : cities.filter((c) => [c.name, c.id, c.country, ...c.aliases].some((v) => key(v).includes(q)));
    // Names that start with the query first, then the rest, A–Z.
    const sorted = [...matches].sort((a, b) => {
      const as = key(a.name).startsWith(q) ? 0 : 1;
      const bs = key(b.name).startsWith(q) ? 0 : 1;
      return as - bs || a.name.localeCompare(b.name);
    });
    const out: Option[] = sorted.slice(0, MAX_SHOWN).map((city) => ({ kind: 'city', city }));
    const exact = cities.some((c) => key(c.name) === q || c.aliases.some((a) => key(a) === q));
    if (q.length >= 2 && !exact && !showingSelected) out.push({ kind: 'request', name: text.replace(/\s+/g, ' ').trim() });
    return out;
  }, [cities, q, text, selected]);

  useEffect(() => {
    if (active >= options.length) setActive(Math.max(0, options.length - 1));
  }, [options.length, active]);

  const pickCity = (c: OrgCity) => {
    editing.current = false;
    onChange(c.id);
    setText(c.name);
    setOpen(false);
    setNote(c.status === 'requested' ? { tone: 'info', text: `${c.name} is waiting for approval. You can still publish; the event joins the ${c.name} page once it's approved.` } : null);
  };

  const ask = async (name: string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { city, matched } = await onRequest(name);
      editing.current = false;
      onChange(city.id);
      setText(city.name);
      setOpen(false);
      setNote(
        matched && city.status === 'active'
          ? { tone: 'info', text: `${city.name} is already on the list, so we picked it.` }
          : { tone: 'info', text: `Asked for ${city.name}. You can still publish; the event joins the ${city.name} page once ZoraPass approves it.` },
      );
    } catch (e) {
      setNote({ tone: 'error', text: (e as Error)?.message || "Couldn't send the request. Try again." });
    } finally {
      setBusy(false);
      inputRef.current?.focus(); // keep keyboard focus on the field after the request
    }
  };

  const choose = (o: Option | undefined) => {
    if (!o) return;
    if (o.kind === 'city') pickCity(o.city);
    else void ask(o.name);
  };

  const restore = () => {
    editing.current = false;
    setText(selected?.name ?? value ?? ''); // a city not in the list (old or hidden) keeps showing its value
    setOpen(false);
  };

  const optId = (i: number) => `${listId}-o${i}`;

  return (
    <div className="zcp">
      <input
        ref={inputRef}
        id={inputId}
        className="in"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? optId(active) : undefined}
        aria-busy={busy || undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Type a city, e.g. Dar es Salaam"
        value={text}
        readOnly={busy}
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          editing.current = true;
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(options.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            if (open && options[active]) {
              e.preventDefault();
              choose(options[active]);
            }
          } else if (e.key === 'Escape') {
            restore();
          }
        }}
        onBlur={() => {
          // Let a click on an option land first.
          setTimeout(() => {
            if (document.activeElement !== inputRef.current) restore();
          }, 120);
        }}
      />
      {open && options.length ? (
        <ul className="zcp-list" id={listId} role="listbox" aria-label="Cities">
          {options.map((o, i) => (
            <li
              key={o.kind === 'city' ? o.city.id : 'request'}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              className={'zcp-opt' + (i === active ? ' on' : '') + (o.kind === 'request' ? ' req' : '')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              {o.kind === 'city' ? (
                <>
                  <span>{o.city.name}</span>
                  <span className={'zcp-meta' + (o.city.status === 'requested' ? ' pend' : '')}>{o.city.status === 'requested' ? 'Waiting for approval' : o.city.country}</span>
                </>
              ) : (
                <>
                  <span>Not listed? Ask for “{o.name}”</span>
                  <span className="zcp-meta">ZoraPass approves new cities</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {busy ? <p className="tier-note" role="status" style={{ marginTop: 6 }}>Sending…</p> : null}
      {note ? (
        <p className="tier-note" role={note.tone === 'error' ? 'alert' : 'status'} style={{ marginTop: 6, color: note.tone === 'error' ? 'var(--orange)' : undefined }}>
          {note.text}
        </p>
      ) : null}
      <style>{`
.zcp{position:relative}
.zcp-list{position:absolute;z-index:20;left:0;right:0;top:calc(100% + 4px);list-style:none;margin:0;padding:6px;background:var(--cr-card);border:1px solid var(--hair);border-radius:10px;max-height:320px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.zcp-opt{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:44px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:15px;color:var(--cr-ink)}
.zcp-opt.on{background:var(--cr-card2)}
.zcp-opt.req{border-top:1px solid var(--hair);margin-top:4px;padding-top:10px;font-weight:600}
.zcp-meta{font-family:var(--mono);font-size:12px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50%}
@media(max-width:480px){.zcp-meta{display:none}.zcp-meta.pend{display:inline}}
`}</style>
    </div>
  );
}
