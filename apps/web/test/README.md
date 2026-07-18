# apps/web verification harness

Node-only (no Playwright/browser), used by every frontend conversion PR (Phase F).
It implements the guardrails in `FRONTEND-PLAN.md` §7.1.

| File | Role |
|------|------|
| `verify.mjs` | Existing Phase-2 gate: byte-parity of the still-static pages vs the legacy oracle + the `/api/*` proxy contract. Retire a page's byte case here as it converts; **keep the `/api/*` cases** (still a valid contract). |
| `lib/snapshot.mjs` | Structural-DOM snapshot: parse HTML → normalize (lowercase tags, **sort attributes**, collapse whitespace) → strip Next hydration artifacts (comments incl. `<!--$-->` suspense markers, `data-reactroot`/`data-reactid`, the `#__next` wrapper, `/_next/*` script+preload noise) → **mask volatile nodes** by a selector allowlist → serialize → diff vs a golden. |
| `lib/deterministic.mjs` | Freeze `Date.now()` + seed `Math.random()` (mulberry32) so countdown/sparkline/claim-code pages render reproducibly. Exposes `install`/`restore`/`withDeterminism` and the canonical `FIXED_NOW`/`FIXED_SEED` constants. |
| `snapshot.mjs` | Runner for the structural snapshots + the committed end-to-end example (the static homepage). |
| `behavior-smoke.mjs` | Boots-against / polls web+api and asserts a route actually renders + behaves (scaffold; one working assertion today). |
| `golden/` | Committed golden snapshots (`*.snapshot.txt`). |

## Running

```bash
# structural snapshots vs goldens (self-contained; reads public/*.html today)
node apps/web/test/snapshot.mjs
node apps/web/test/snapshot.mjs --update           # (re)generate goldens after an intended change
WEB=http://localhost:3000 node apps/web/test/snapshot.mjs --from-web   # snapshot the live route (post-convert)

# behavior smoke (needs web+api running, mirrors verify.mjs)
WEB=http://localhost:3000 API=http://localhost:4101 node apps/web/test/behavior-smoke.mjs

# legacy byte-parity + /api proxy (needs web+api+oracle)
WEB=... ORACLE=... node apps/web/test/verify.mjs
```

## How a conversion PR uses it

The structural snapshot is a **regression guard between React PRs**, not the
conversion oracle (§7.1: the conversion oracle is visual + behavioral). Per the
plan, with 0 live users the static page is the **design reference to port from**,
so a converting PR:

1. **Before converting** — the golden for the page already exists (the static
   HTML's snapshot; the homepage's `golden/index.snapshot.txt` is the shipped
   example). Add a case to `CASES` in `snapshot.mjs` (`file`, `route`, `golden`,
   and a `mask` allowlist of the page's volatile nodes) if one isn't there.
2. **Convert the page to React**, delete its `public/*.html` twin, repoint links
   (§7.2 clean cutover).
3. **Flip the case to the live route**: run with `--from-web` so the snapshot
   comes from the running React route instead of the static file. The Next
   hydration stripper + attribute sort + volatile masking absorb the
   React-vs-static noise; a real structural change fails the diff.
4. **If the change is intentional** (an IA change like the home reorder in F4),
   regenerate the golden with `--update` and get it reviewed in the diff — the
   golden is the reviewed artifact.
5. **Add behavior assertions** to `behavior-smoke.mjs` for the page's dynamic
   behavior (countdown ticks, discover renders N cards, QR SVG 200s, the F6
   organizer-gate redirect matrix), seeded via pg-parity's throwaway Postgres.
6. **Determinism**: wrap render/assert in `withDeterminism()` and forward
   `FIXED_NOW`/`FIXED_SEED` to the app so its own `Date.now()`/`Math.random()`
   (countdowns, sparklines) are frozen at snapshot time.

### Notes / limits
- Selector allowlist supports **compound-simple** selectors only
  (`tag`, `.class`, `#id`, `[attr]`, `[attr=val]`, comma-lists) — no descendant
  combinators; mask by the volatile node's own id/class/attr.
- The snapshot serializer keeps `<script>`/`<style>` text verbatim (only
  whitespace-collapsed); mask them if a page inlines volatile script data.
