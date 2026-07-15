# legacy/ — archived reference (do not run)

Frozen snapshot of the pre-migration ZORA apps, kept for reference only. The live
stack is **`apps/web`** (Next.js) + **`apps/api`** (NestJS), reading **`/data`** at
the repo root.

- **`zora-site/`** — the original Express monolith. During Phase 1 it was the
  "oracle" the NestJS API was diffed against for byte-for-byte parity. Its JSON
  data store was moved to the repo-root `/data` during the Phase 3 cutover, so
  this server no longer runs as-is.
- **`zora-organizer-app/`** — the gate service, Supabase schemas, and early HTML
  prototypes of the organizer app.

Nothing here is imported by the live apps. It can be deleted once the new stack is
confirmed in production; git history preserves it regardless.
