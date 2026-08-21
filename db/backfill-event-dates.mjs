#!/usr/bin/env node
/* BS101 — backfill a structured ISO `date` onto events that only have a free-text
   `dateLabel`. The marketplace "This Weekend" filter + chronological sort read the
   structured date; events created before BS101 (and the seeds) carry only a label
   like "Sun 30 Aug" or "Sat 12 – Mon 14 Sep", so they need a one-time parse.

   Best-effort: parses "<day> <month>" (with an optional year), inferring the year
   as the next future occurrence when none is written. The event's original
   dateLabel is left untouched (it stays the display string). Idempotent — skips
   events that already have a `date` unless --force. Reports anything it can't
   parse rather than guessing.

   Usage: DATABASE_URL=postgres://... node db/backfill-event-dates.mjs [--force] [--dry] */
import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, '..', 'apps', 'api', '.env') });
const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('backfill-event-dates: set DATABASE_URL'); process.exit(1); }
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parse a free-text date label to an ISO YYYY-MM-DD (the FIRST day it names), or
    null if it has no recognisable day+month. `today` fixes the year inference. */
export function parseLabelToIso(label, today = new Date()) {
  const s = String(label || '').toLowerCase().replace(/[–—]/g, '-');
  // month tokens with their position in the string
  const months = [];
  for (const mm of s.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/g)) {
    months.push({ idx: mm.index, month: MONTHS.indexOf(mm[1]) });
  }
  if (!months.length) return null;
  // first standalone 1-2 digit day number
  const dayM = /\b(\d{1,2})\b/.exec(s);
  if (!dayM) return null;
  const day = Number(dayM[1]);
  if (day < 1 || day > 31) return null;
  // month for that day: the first month token at/after the day, else the first month
  const dayIdx = dayM.index;
  const month = (months.find((mo) => mo.idx >= dayIdx) || months[0]).month;
  // explicit 4-digit year if present, else the next future occurrence
  const yearM = /\b(20\d{2})\b/.exec(s);
  let year = yearM ? Number(yearM[1]) : today.getFullYear();
  const mk = (y) => new Date(y, month, day);
  if (!yearM) {
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (mk(year).getTime() < midnight.getTime()) year += 1; // already past → next year
  }
  const d = mk(year);
  if (isNaN(d.getTime()) || d.getMonth() !== month) return null; // e.g. 31 Feb
  const iso = `${d.getFullYear()}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return iso;
}

async function main() {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = await sql`select data from collection_store where name = 'events'`;
    if (!rows.length) { console.log('backfill-event-dates: no events blob — nothing to do'); return; }
    const events = JSON.parse(rows[0].data);

    let changed = 0;
    const skipped = [];
    const unparsed = [];
    for (const e of events) {
      if (!e) continue;
      if (e.date && !FORCE) { skipped.push(`${e.id} (has ${e.date})`); continue; }
      const iso = parseLabelToIso(e.dateLabel);
      if (!iso) { unparsed.push(`${e.id} ("${e.dateLabel ?? ''}")`); continue; }
      console.log(`  ${e.id}: "${e.dateLabel}" -> ${iso}`);
      e.date = iso;
      changed += 1;
    }

    if (skipped.length) console.log(`  · skipped (already dated): ${skipped.join(', ')}`);
    if (unparsed.length) console.log(`  ! could not parse: ${unparsed.join(', ')} — set these by editing the event`);
    if (changed === 0) { console.log('backfill-event-dates: no changes'); return; }
    if (DRY) { console.log(`backfill-event-dates: --dry, would update ${changed} event(s)`); return; }

    await sql`update collection_store set data = ${JSON.stringify(events)}, updated_at = now() where name = 'events'`;
    console.log(`backfill-event-dates: updated ${changed} event(s)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Run only when invoked directly (so the parser can be imported + unit-tested).
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
