# Dashboard redesign (Control-Room v2) + sitewide light/dark — build plan

**Date:** 2026-08-19 · **Design ref:** `DESIGN.md` → *Control-Room v2* · approved preview
`/tmp/zora-dashboard-preview.html`. Hardened by `/plan-design-review` (all 7 passes).
Classifier: **APP UI** (data-dense, task-focused) — App UI rules apply.

## Scope
Redesign the **organizer** + **admin** dashboards onto one Control-Room v2 shell +
token set; add a real **light/dark** system; surface **analytics** (#8); build the
**admin events-manager** (#6) + the **org-suspension cascade** (#6 backend); make it
**mobile responsive** (#8). Consumer + Door planes unchanged.

## What already exists (reuse, don't reinvent)
- `DESIGN.md` Control-Room v2 tokens + component vocab (KPI tiles, hero chart, tables→cards, status pills).
- Org dashboard shell `dashboard/DashboardShell.tsx` (nav rail) + inner pages (sales, payouts, storefront/studio, onboarding, events).
- Admin `admin/dashboard/admin-shell.tsx` + 11 section components (overview, organizers, events, orders, payouts, media, payments, scanner-users, verification, access, placeholders).
- Money/sales data: `org-sales.service`, `poolSnapshots`, `readOrderMoney`; admin orders read (0016) for the analytics funnel.
- Per-org light-mode token pattern already shipped on the storefront (BS-Weekender D1a) — reuse the `data-theme` approach.

---

## Pass 1 — Information Architecture  (5→9)
**Gap:** nav + per-screen hierarchy undefined for both consoles.

```
ORG CONSOLE                          ADMIN CONSOLE
┌ sidebar ─────────┐                 ┌ sidebar ─────────────┐
│ Home (overview)  │  ← default      │ Overview             │
│ Sales            │                 │ Organizers (+verify) │
│ Events           │                 │ Events-manager  ★NEW │
│ Payouts          │                 │ Orders & carts       │
│ Comps       ★NEW │                 │ Payouts              │
│ Storefront       │                 │ Scanner users        │
└──────────────────┘                 │ Broadcasts           │
top bar: store · theme toggle        │ Payments routing     │
                                     │ Media · Access       │
                                     └──────────────────────┘
```
**Per-screen hierarchy (constraint: if only 3 things — which 3?):**
- **Org Home:** ① KPI row (revenue first) → ② revenue chart → ③ recent orders + events.
- **Admin Overview:** ① platform GMV + take → ② organizers/events counts → ③ orders needing attention (pending/failed carts).
- **Admin Events-manager:** ① event list (name·owner·status·sold) → ② per-row enable/disable → ③ filters (org, status).

Wayfinding: current section highlighted (longest-prefix match, as today); admin adds breadcrumb on drill-in (Events › The 14th › tiers).

## Pass 2 — Interaction State Coverage  (3→9)
**Gap:** preview shows a healthy account only. Every surface ships all states.

| Feature | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL |
|---|---|---|---|---|---|
| KPI row | skeleton tiles (shimmer) | **new org:** tiles show `0` + "Your numbers appear after your first sale" | inline "couldn't load metrics · Retry" per tile, keep layout | live values + delta | some metrics null → `—`, not `0` |
| Revenue chart | skeleton bars + axis | "No revenue yet — share your storefront" + a COPY LINK CTA | "chart unavailable · Retry"; KPI row still renders | filled area + endpoint dot | date-range with no data → flat baseline + "no sales in this range" |
| Orders table | 6 skeleton rows | "No orders yet" + storefront link | banner "couldn't load orders" + cached rows if any | rows w/ status pills | infinite-scroll spinner at foot |
| Events panel | skeleton | "No events — + New drop" (primary) | "couldn't load events" | list w/ Live/Draft pills | — |
| Analytics (#8) | skeleton | "Not enough data yet" (needs ≥1 paid order) | "analytics unavailable" | funnel + chart | per-metric null → `—` |
| Admin events-manager | skeleton table | "No events on the platform" | error banner + Retry | list + toggles | row action pending → row disabled + spinner |
| Comps / bulk (later) | — | "No comps issued" + Issue CTA | — | list | — |

Empty states are features: warmth + one primary action + context. Never bare "No items found."

## Pass 3 — User Journey & Emotional Arc  (4→8)
```
STEP | USER DOES                    | FEELS            | PLAN SUPPORTS
1    | first login (0 sales)        | unsure it works  | zero-state KPIs + "share your storefront" CTA, not a wall of empty charts
2    | first sale lands             | relief / proof   | numbers animate up; a subtle toast "first sale — 229,500 TZS"
3    | daily check (healthy)        | in control       | revenue-first KPI row scannable in 3s; delta vs last week
4    | event day (door open)        | anxious, mobile  | Checked-in KPI leads; mobile-first; big legible mono; links to scanner
5    | after event (payout)         | wants their cash | Payouts surfaces available balance; export
```
Time-horizon: **5s** (revenue number reads instantly) · **5min** (find any order, export) · **5yr** (calm, trustworthy money instrument they run every event on).

## Pass 4 — AI Slop Risk  (6→9)  — App UI rule set
- **[FIX] KPI-tile colored left-border bar = AI-slop #8.** Replace the `border-left` tint with either (a) the tint on the **label chip** only, or (b) a small filled **dot** before the label. Keep the card border neutral. (Applied to the spec; the preview's left-bar is illustrative, not final.)
- No card mosaic — the layout IS structure (sidebar + regions), cards only where the card is the unit (an order row card on mobile, an event row). ✓ App-UI rule.
- One accent (blue); semantic color only for status. ✓
- Real typefaces (Archivo/IBM Plex Mono/Inter), no system-ui default. ✓
- Section headings state the area ("Recent orders", "Your events"), not mood. ✓
- No decorative gradients (aura reserved for primary action / logo-O only). ✓
- Litmus: brand unmistakable ✓ · one anchor (the revenue number) ✓ · scannable by headings ✓ · one job per section ✓ · cards necessary ✓ (after the border fix) · motion improves hierarchy (count-up, draw-in) ✓ · premium without shadows ✓.
- No hard-rejection patterns present.

## Pass 5 — Design-System Alignment  (7→10)
Maps 1:1 to `DESIGN.md` Control-Room v2: light/dark token set, KPI tiles (mono `tabular-nums`), hero area chart in blue anchor, tables→cards, status pills (paid=cyan · pending=amber · refund=red · live/draft), sidebar+topbar shell. New components introduced — all fit the vocabulary: **KPI stat-tile**, **hero metric chart**, **events-manager row**. Add each to the `DESIGN.md` Components list on build.

## Pass 6 — Responsive & Accessibility  (3→9)
**Breakpoints (intentional, not "stacked"):**
- **≥1120px:** sidebar (236px) + main; KPI row 5-up; orders table full; two-column (orders | events).
- **900–1120px:** KPI row 3-up; single column; table full.
- **640–900px:** sidebar → top **drawer** (hamburger); KPI 2-up; orders **table→cards** (each order a card: buyer + amount prominent, tier/method/status below).
- **<640px:** KPI 1-up (revenue first, others scroll); everything single-column; sticky top bar with the one primary action.

**Accessibility (App-UI, money surface — DESIGN.md rules 3, 4b):**
- Keyboard: full tab order; visible focus ring (blue anchor, ≥2px); sidebar + table are landmarks (`<nav>`, `<main>`, `role=table`); drawer traps focus + Esc closes.
- Contrast: **audit the pastel KPI tints on white** — tint carries the *label*, never the value/critical text; body ≥14px, never <4.5:1; mono labels 10px are decorative only (value carries meaning). Money/deltas at `--ink` ≥ AA.
- Charts: every chart ships a **data-table alternative** (`aria` + a "view as table" toggle) — a chart is not accessible alone.
- Touch: ≥44px targets incl. row actions, toggle, range pills.
- Motion: count-up + draw-in behind `prefers-reduced-motion: reduce` (instant values).
- Theme toggle: `aria-pressed`; persists per-user (localStorage `zora-cr-theme`); respects `prefers-color-scheme` on first visit.

## Pass 7 — Unresolved design decisions (need your call)
| # | Decision | If deferred |
|---|---|---|
| D-A | **Light vs dark default** for the control-room | engineers pick arbitrarily; inconsistent first impression |
| D-B | **Sitewide toggle reach** — control-room only, or also home/discover? | #7 scope ambiguous; could balloon into a consumer re-theme |
| D-C | **Migration order** of existing surfaces (drop-editor, sales, studio, onboarding) onto v2 tokens | half-migrated dashboards look broken during rollout |
| D-D | **Analytics v1 metric set** — thin funnel (checkout-started→paid, revenue, per-tier/event) vs fuller (page-views, demographics) | scope creep vs shipping something |
| D-E | **Admin events-manager depth** — list + enable/disable only, or full per-event edit | rebuilds the drop-editor twice |

**Resolved 2026-08-19:** D-A **light** default · D-B **control-room only** (consumer stays fixed-dark) · D-C shell+home first, **then migrate every surface** (sales→drop-editor→studio→onboarding) · D-D **thin funnel** analytics · D-E admin events-manager = **list + enable/disable** v1 (full edit via impersonation of the org drop-editor).

## NOT in scope (deferred, with rationale)
- **Public storefront rendering + theme mechanics — EXPLICITLY UNTOUCHED.** No change to the storefront/event/checkout pages, the `PUT /api/storefront-theme` save, the live-preview iframe/`postMessage` bridge, or the floor-plan/seat-map canvas engine. The redesign only re-skins the *control-room* chrome + adds studio controls that expose already-shipped theme fields (light/dark, bg/card). Engineers must not modify storefront render or theme API in this work.
- Consumer plane re-theme (home/discover stay fixed-dark — brand). — unless D-B says otherwise.
- Door/scanner PWA redesign (its own plane, works). 
- Fuller analytics (page-views/demographics) — after the thin funnel proves out.
- Comps / bulk / venue-reservation UIs — separate feature workstreams (A–D from the eng-review backlog).

## Implementation Tasks
Synthesized from the findings. P1 blocks ship; P2 same branch; P3 follow-up.

- [ ] **T1 (P1, human ~2d / CC ~2h)** — tokens — Build the light/dark `data-theme` token set + toggle (persist + `prefers-color-scheme`); apply to the org dashboard shell. Files: `apps/web/app/(app)/dashboard/*`, a shared theme provider. Verify: toggle flips all surfaces, no FOUC.
- [ ] **T2 (P1, human ~2d / CC ~2h)** — org-home — KPI row + hero revenue chart + recent-orders table + events panel, all states (Pass 2). Files: `dashboard/page.tsx`, new `components/kpi-tile.tsx`, `revenue-chart.tsx`. Verify: zero-state + healthy both render.
- [ ] **T3 (P1, human ~1d / CC ~45min)** — a11y — chart data-table alt, focus rings, drawer focus-trap, contrast audit of tints. Verify: keyboard-only pass + axe clean.
- [ ] **T4 (P1, human ~1d / CC ~45min)** — responsive — breakpoints + table→cards + sidebar→drawer. Verify: 375/768/1280 screenshots.
- [ ] **T5 (P2, human ~1.5d / CC ~1h)** — analytics — the funnel query (checkout-started→paid, revenue over time, per-tier/event) behind `/api/org/analytics`; wire to KPI row + chart. Verify: numbers match `order` table.
- [ ] **T6 (P2, human ~2d / CC ~1.5h)** — admin — events-manager section (list + per-event enable/disable) replacing `DropPanel`; reuse v2 table. Files: `admin/dashboard/sections/events-section.tsx`. Verify: archive hides from public.
- [ ] **T7 (P1, human ~2h / CC ~20min)** — admin/core — org-suspension **cascade**: public reads (`vendor/events.js` + tenant + storefront filters) exclude events whose org is `suspended`. Verify: suspend org → its events vanish from discover.
- [ ] **T8 (P2, human ~2d / CC ~2h)** — migration — port drop-editor, sales, storefront-studio, onboarding onto v2 tokens (D-C order). Verify: no light/dark leftovers.
- [ ] **T9 (P3)** — fix the KPI-tile left-border (Pass 4) at build (label-chip tint, not `border-left`).

## Per-surface spec — every organizer + super-admin surface (2026-08-19, C-scope)
Each surface: **hierarchy ①②③ · v2 components · critical states**. All inherit the
cross-cutting rules (light/dark toggle in top bar · sidebar→drawer + tables→cards
responsive · focus rings + 44px + contrast + chart data-table alt · every table ships
loading/empty/error).

### Organizer console
- **Home** — see Pass 1/2 above (KPI row → revenue chart → orders + events).
- **Sales** — ① net earnings (after point-in-time commission, big mono) ② orders table (filter event/tier/status, export) ③ **splits worklist** sub-tab (pending bill-share progress). States: empty "No sales yet — share your storefront"; skeleton; error banner keeps filters.
- **Payouts / Withdrawals** — ① **available balance** per currency (highest legibility, rule 4b) ② Request withdrawal (amount ≤ balance; disabled + reason when 0) ③ history w/ status pills (requested/paid/rejected + reference). States: empty "Nothing to withdraw yet"; balance-0 disabled CTA; error.
- **Events (list)** — ① event list (name·date·status·sold/cap) ② **+ New drop** (primary) ③ row → manage (edit · archive/unarchive). States: empty "Create your first drop"; skeleton.
- **New drop / drop-editor** — a numbered multi-step **form** (`.block-h`): ① identity (name·date·city select·venue·category·cover) ② **tiers** (the money — rows reuse the split toggle + seats) ③ publish (KYC gate). States: draft-save toast; per-field validation; KYC-blocked banner ("verify to publish") ; publish success. **[Decision E-2]** re-skin vs full redesign.
- **Floor-plan builder** — imperative **canvas**: ① canvas (draw zones) ② zone inspector (name·type·price·capacity) ③ publish. States: empty-canvas prompt; zone-selected; saved. Keep the interaction; apply v2 chrome + theme-aware canvas.
- **Storefront studio** — ① **live preview** (iframe) ② controls (accent · logo · banner · **bg/card + light/dark presets**) ③ publish. This is where per-org theming + **preset themes** live. States: preview loading; saved; reset-to-default.
- **Comps** ★NEW — ① issue form (name·phone/email·tier·qty) ② issued list ③ delivery status (email/SMS/WhatsApp). States: empty "No comps issued"; issuing spinner; delivered/failed pills. (str8up harvest.)
- **Onboarding** — first-run: ① progress steps ② current step (profile → KYC → first drop) ③ skip/continue. States: step incomplete/complete; KYC pending.
- **Signup / Login** — acquisition entry. **[Decision E-1]** plane choice (consumer-aura vs control-room). Login: handle+password; Signup: phone-OTP + handle picker (live availability) + "pending verification" state.

### Super-admin console (shares the shell; breadcrumb on drill-in)
- **Overview** — ① platform **GMV + take** ② orgs/events/tickets counts ③ **attention queue** (pending carts, verifications waiting). States: loading; fresh-platform empty; error.
- **Organizers** — ① list (name·status·events·revenue) ② row actions (suspend/unlock · commission · impersonate) ③ filters. States: empty; skeleton.
- **Verification** — KYC queue: ① pending (oldest-first) ② review pane (masked doc# · proven phone · source) ③ approve/reject (reason). States: empty "No pending"; reviewing; decided.
- **Events-manager** ★NEW (#6) — ① every event (name·owner·status·sold) ② per-event **enable/disable** (archive/unarchive) ③ filters (org·status). Replaces the single-drop `DropPanel`. States: empty; skeleton; row-action pending.
- **Orders & Carts** — ① filterable table ALL states (pending/paid/failed/expired) ② row → drawer (line items · buyer · payment attempt · credentials) ③ search phone/email/id. **[Decision E-3]** build now vs defer. States: loading; empty; error.
- **Payouts (admin)** — ① queue ② confirm-with-reference / reject ③ history. Money rule 4b.
- **Scanner users** — ① list (role·scope·active) ② add user + role ③ rotate/revoke code. States: empty; skeleton.
- **Broadcasts** — ① compose (audience picker w/ live count + est SMS cost · channel · SMS/email body) ② preview ③ history w/ per-recipient delivery. Backend shipped (BS45). **[Decision E-3]** build now vs defer.
- **Payments routing** — ① method toggles (mobile/billpay/card) ② FSP route map ③ per-FSP fee overrides. States: saved; error.
- **Media** — ① asset grid ② approve/flag status. States: empty; loading.
- **Access** — ① admin password change ② scanner/agent code provisioning. States: saved.

### New cross-cutting decisions (need your call — E-1…E-3)
| # | Decision | Rec | If deferred |
|---|---|---|---|
| E-1 | Plane for **signup + login + onboarding** | signup+login on **consumer-aura** (acquisition funnel, matches home); onboarding on **control-room light** (already "inside") | inconsistent entry; a data-tool login for a marketing moment |
| E-2 | **drop-editor + floor-plan builder** depth | **re-skin to v2 tokens + chrome now**, full redesign later | rebuilding the seat-builder mid-flight stalls the rollout |
| E-3 | Build the two **"soon" admin sections** (Orders & Carts, Broadcasts) in this redesign | **yes** — both are core control-room (support + org comms) and their backends exist | admin stays half-empty; support still blind to carts |

**Resolved 2026-08-19:** E-1 signup+login = **consumer-aura**, onboarding = **control-room light** · E-2 drop-editor + floor-plan = **re-skin to v2 now**, full redesign later · E-3 **build** Orders & Carts + Broadcasts in this redesign.

## Engineering review (2026-08-19) — architecture locked

**Scope challenge:** legitimately large (22 surfaces); NOT scope creep. Phased P1–P4. R1
de-risked (commission stamping built). **R2 = B (full React port of the organizer
console)** — all 11 imperative `dangerouslySetInnerHTML` org surfaces port to idiomatic
React (admin is already React), retiring the imperative-HTML debt in one pass.

**Data flow**
```
THEME     <html data-theme> ← inline <head> script(localStorage 'zora-cr-theme' || prefers-color-scheme)
          → global CSS custom properties → every surface (React consumes var(--…))
ANALYTICS /api/org/analytics → REUSE earnings.ts (net from stamped order.commission_rate)
          + poolSnapshots + count(order by status) + date-bucketed group-by → KPI row + area chart
SUSPEND   organizer.setStatus → refresh cached suspended-handle set → enrichEvent drops those events
          → /api/events, discover, storefront, tenant
```

**Architecture decisions (confidence 8–9, read from code):**
1. **Token system (keystone).** One `[data-theme]` on `<html>` + global CSS vars. **SSR no-FOUC:** set `data-theme` in a tiny inline `<head>` script before first paint (mirror the existing `zora-theme.js` consumer pattern), `try/catch`→default dark. Persist per-user in localStorage; toggle `aria-pressed`.
2. **Analytics reuses `earnings.ts`/`readOrderMoney`** (net from stamped `order.commission_rate`, migration 0010) — no new commission logic; the funnel adds only status counts + a date bucket. Read-only.
3. **Suspension cascade** extends the public read: `vendor/events.js:isPublicEvent` (today `status==null||'published'`) + `enrichEvent` also drop events whose `organizerHandle` ∈ a **cached suspended-handle set** (refreshed on `setStatus`), NOT a per-event DB join.
4. **DRY guard (code-quality):** build ONE shared **CR component lib** — `CrShell`/`Sidebar`/`TopBar`, `ThemeToggle`, `KpiTile`, `RevenueChart`, `DataTable`(→cards), `StatusPill` — consumed by BOTH consoles, so 22 surfaces don't hand-roll tables. The org port reuses the admin sections' patterns.

**Test coverage (ASCII — [GAP] = add to plan):**
```
CODE PATHS                                  USER FLOWS
[+] theme provider + SSR head script        [+] toggle light↔dark persists across reload  [GAP →E2E]
  ├─ [GAP] localStorage empty → prefers      [+] new org, zero data → empty states        [GAP]
  ├─ [GAP] script throws → default dark       [+] event-day mobile: table→cards, drawer    [GAP →E2E]
[+] /api/org/analytics                       [+] suspend org → its events vanish public    [GAP →E2E, CRITICAL]
  ├─ [GAP] no paid orders → empty funnel     [+] ported org surface parity vs old          [GAP →E2E per surface]
  ├─ [GAP] date range w/ no data → flat
[+] suspended-handle set                     ERROR STATES
  ├─ [GAP] stale after setStatus → refresh   ├─ [GAP] analytics 500 → KPI row still renders
  └─ [GAP] concurrent status flip            └─ [GAP] a11y: chart data-table alt, focus, contrast
```
**Failure modes (critical gaps):** (a) suspended-handle set stale → suspended org's events still public until refresh → **refresh synchronously on `setStatus` + short TTL**; (b) React-port regressions on 11 working surfaces → **strangler: keep the imperative version until the React one passes a snapshot + e2e parity test, then delete**; (c) SSR theme script throw → FOUC/crash → try/catch default dark.

**Parallelization lanes:**
- **Lane A (foundation, blocks all):** token system + SSR head script + shared CR component lib.
- **Lane B (org, after A):** Home → Sales → Payouts (React port, new layouts) → drop-editor/floor-plan/studio/onboarding/signup/login (port).
- **Lane C (admin, after A, ∥ B):** Overview → Events-manager → Orders & Carts → Broadcasts (restyle + build the two revived sections).
- **Lane D (backend, ∥ A):** analytics endpoint + `order(created_at,status,event_id)` index; suspension cascade + refresh.
- Order: **A → (B ∥ C ∥ D) → integrate.** B and C share `apps/web/app/(app)` but different subtrees (dashboard vs admin) — low conflict.

**Performance:** analytics needs an index on `order(created_at, status, event_id)`; date-bucket the chart server-side (never ship 10k rows); suspended-handle set is small + in-memory.

## Approved Mockups
Hand-built HTML at real v2 tokens (no AI gen — OpenAI key absent). Live file (toggles all
6 screens + light/dark, resize for responsive): `~/.gstack/projects/tareeq2020-Zora-Live/designs/dashboard-surfaces-20260819/surfaces.html`.

| Surface | Desktop | Mobile | Dark |
|---|---|---|---|
| Admin · Overview | `ov-desktop.png` | `ov-mobile.png` | `ov-dark.png` |
| Admin · Events-manager (#6) | `em-desktop.png` | `em-mobile.png` (table→cards) | — |
| Admin · Orders & Carts | `oc-desktop.png` | — | `oc-dark.png` |
| Org · Sales | `sa-desktop.png` | `sa-mobile.png` | — |
| Org · Payouts | `po-desktop.png` | — | — |
| Org · Storefront studio | `ss-desktop.png` | — | — |

(All in the designs folder above.) Responsiveness verified: sidebar→drawer + table→cards at ≤760px; KPI 5→3→2→1. Light/dark verified across surfaces.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | R2 fork resolved (full React port); token/analytics/suspension arch locked; 3 critical failure-modes → tests; 4 parallel lanes |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | skipped | codex not installed (informational; never gates) |
| Design Review | `/plan-design-review` | UI/UX gaps | 2 | clean | run1: 5→9, D-A…D-E resolved · run2: all 22 org+admin surfaces spec'd, E-1…E-3 resolved |

Run 1 passes: IA 5→9 · States 3→9 · Journey 4→8 · AI-Slop 6→9 · Design-Sys 7→10 · Responsive/A11y 3→9 · D-A…D-E resolved.
Run 2 (C-scope): per-surface spec for 11 organizer + 11 super-admin surfaces (hierarchy · v2 components · critical states each); E-1…E-3 resolved (signup/login=consumer-aura, onboarding=control-room; drop-editor+floor-plan re-skin now; build Orders&Carts + Broadcasts).

**VERDICT:** DESIGN + ENG CLEARED — ready to build. Design: 22 surfaces + 12 decisions. Eng: R2=full React port, global CSS-var theme tokens (SSR no-FOUC), analytics reuses `earnings.ts`, suspension via cached handle set, shared CR component lib (DRY), 4 parallel lanes (A→B∥C∥D). Outside voice skipped (codex absent, informational).

NO UNRESOLVED DECISIONS
