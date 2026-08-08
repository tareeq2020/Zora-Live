# Lane 3 — organizer dashboard light→dark unify (plan-design-review, 2026-08-08)

Builds on the prior `/plan-design-review` pass (`docs/plans/design-review-spec.md`
§"#9 Admin port + dashboard unify"), which already flagged this exact migration
as the highest-risk item in that review and locked its guardrails. This doc
narrows that spec into an executable, sequenced plan.

## What already exists (design leverage — this is not a new design)

The target palette is not being invented here — it's already running in
production on `/admin/dashboard` (BS36). `apps/web/app/(app)/admin/dashboard/admin-style.ts`
is the reference implementation:

```
--black:#0A0A0B  --ink:#101012  --ink2:#16161A  --hair:#222226  --hair2:#2E2E34
--bone:#F4F1EA   --mut:#8A877E  --mut2:#615F59
--blue:#3D5AFE   --orange:#FF5A1F  --teal:#2FA9A0  --amber:#F0C674
--sans:'Archivo'  --mono:'IBM Plex Mono'
```

Every organizer-facing file below currently defines the OLD light "paper" set:

```
--paper:#F4F1EA  --card:#FBF9F4  --ink:#0A0A0B(*)  --hair:#DDD8CB
--mut:#8A877E    --blue:#3D5AFE  --bluewash:#E8EBFE
```

**(\*) Naming trap, flagged explicitly so it doesn't become a bug:** in the OLD
palette, `--ink` means *foreground text color*. In the NEW (admin) palette,
`--ink` means a *dark surface/card background*. Same variable name, opposite
role. A find-and-replace across the CSS block will silently invert text and
surface colors if this isn't caught — check every `--ink` usage by hand, not
by search-replace, when converting each file.

`--mut` (#8A877E) and `--blue` (#3D5AFE) are byte-identical between the two
palettes — no change needed for those two. `--bluewash` (#E8EBFE, a light-blue
pill background) has no direct dark equivalent; use a translucent version
(`rgba(61,90,254,.12)`, the pattern already used elsewhere in the dark control
room, e.g. the payments-section toggle) rather than inventing a new solid
color. `--hair` keeps its name but changes value (`#DDD8CB` → `#222226`) since
it's scoped under each file's own root class — no collision risk.

## Scope — 7 files still on the light palette

`/dashboard/login` and the just-redone `/dashboard/signup` (Lane 2, BS50) are
NOT in scope — login is already control-room dark; signup was deliberately
moved to the *Consumer* plane instead (a different, intentional divergence,
not a straggler).

| # | File | Role | Status-pill / money surfaces to re-theme |
|---|------|------|---|
| 3A | `dashboard/dashboard-client.tsx` | Main hub | KPI cards, net-earnings copy (BS33), pending-org verification banner |
| 3B | `dashboard/events/components/drop-editor.tsx` | Event editor | split/on-sale toggles, tier editor inputs, status pills (live/draft/archived), archive/delete/restore buttons, "hidden — no tickets on sale" warning |
| 3B | `dashboard/events/new/floor-plan/page.tsx` | Seat-map floor plan editor | canvas chrome, zone/seat controls |
| 3C | `dashboard/payouts/payouts-client.tsx` | Payout request + history | balance figure (mono, rule 4b), status pills (requested/approved/paid/rejected) |
| 3C | `dashboard/sales/sales-client.tsx` | Sales/earnings report | revenue figures (mono, rule 4b), commission breakdown |
| 3D | `dashboard/storefront/studio/page.tsx` | Storefront brand customizer | chrome only — the LIVE PREVIEW iframe stays whatever accent/colors the organizer sets for their own storefront; do not touch that |
| 3D | `dashboard/onboarding/page.tsx` | Org onboarding wizard | chrome only — the fake "Continue with Google" button (flagged separately this session, not in scope here) is untouched |

## Cross-cutting contract (DESIGN.md, carried from the prior review)

- **Six states** on every surface touched: default · loading (skeleton) ·
  empty · error · disabled · success. Where a state doesn't already exist in
  the current light version, port it as-is — this is a re-skin, not a
  redesign; do not add new states or remove existing ones as a side effect.
- **Responsive, unchanged behavior:** whatever breakpoints/behavior the file
  already has, preserve exactly — only the color/font tokens change.
- **Money/codes/timers** stay IBM Plex Mono, ≥ 11.5px, ≥ `--mut` contrast
  (rule 4b) — this already holds in the light version for the files that
  show money (payouts, sales); don't regress it while re-theming.
- **Aura gradient stays OFF this plane.** Control-room primary actions use
  the `.publish`-style ink→blue button (per DESIGN.md "Components"), not the
  Consumer plane's aura gradient. Do not import Consumer-plane treatment here
  by mistake — these two planes stay visually distinct per DESIGN.md rule
  ("pick by audience, never mix").

## Sequencing (confirmed: one PR at a time, not parallel)

3A → 3B → 3C → 3D, each its own branch → build → e2e → PR → merge → promote →
mirror, matching this session's established cadence. Per the prior review's
explicit guardrail: **QA each surface against its CURRENT (light) behavior
before considering it done** — a visual reskin that silently drops a state,
a KPI, or a button is a regression, not a nitpick, since these are
revenue-adjacent surfaces organizers use to run their business.

Verification per PR: `pnpm --filter @zora/web build` (compile-clean) +
browser screenshot comparison (old light vs new dark) confirming every
visible element from the "before" screenshot has a "after" counterpart,
not just that the page renders.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Design Review | `/plan-design-review` | UI/UX gaps, scope size | 1 | issues → folded | Narrowed the prior review's flagged item into a 7-file inventory + 4-PR sequence; caught the `--ink` naming-trap (same variable name means opposite roles in the two palettes) before implementation; confirmed studio's live preview iframe and onboarding's Google-button issue are explicitly OUT of scope for this pass. |

**Mockups:** skipped deliberately — the target is not a new design, it's an
existing, shipped, production palette (`/admin/dashboard`) being applied to
new surfaces. The real reference is a running page, not a synthetic mockup.
**Outside voices:** skipped — same reasoning; this is a mechanical token
migration of a locked, already-reviewed system, not a novel design decision
requiring independent critique.
**VERDICT:** DESIGN CLEARED to implement, sequenced 3A → 3B → 3C → 3D.

**UNRESOLVED DECISIONS:**
NO UNRESOLVED DECISIONS
