/* BS168: the one rule for matching city spellings ("Dar-es-Salaam" =
   "dar es salaam"). No imports, so the browser can use it too
   (@zora/core/city-key); the server's city cache uses the same functions. */

/** Lower-case, accents and punctuation dropped, spaces collapsed: "Dar-es-Salaam " → "dar es salaam". */
export function cityKey(v: unknown): string {
  return String(v ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A city id from a name: "Stone Town" → "stone-town". */
export function citySlug(name: string): string {
  return cityKey(name).replace(/ /g, '-').slice(0, 40).replace(/-+$/, '');
}
