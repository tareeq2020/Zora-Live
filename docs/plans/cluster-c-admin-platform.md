# Plan — Cluster C: Admin platform

Items: **#3 cart/order visibility · #9 port super-admin dashboard to Next (sidebar, responsive)**

These land together: the cart view is a surface in the ported admin.

---

## #9 — Port the super-admin dashboard to Next

**Today.** `/admin/dashboard` is a single 800-line legacy port: one `MARKUP` HTML string + a `SCRIPT` string run via `new Function('setInterval','setTimeout', SCRIPT)`, all under `.admin-console`. Nine imperative panels (drop settings, tiers, crews, media, agents, placements, organizers, KYC, access) + the payments panel (BS29). tsc can't see inside the SCRIPT string; every mutation is hand-wired DOM.

**Target.** Idiomatic React/Next, componentized like the organizer dashboard — typed, testable, no `dangerouslySetInnerHTML`/`new Function`.
- **Sidebar navigation** (left rail, not the top tab bar), sections grouped: Overview · Organizers (incl. Verification #5) · Events/Drops · Orders & Carts (#3) · Payouts (#7) · Scanner users (#1) · Broadcasts (#2) · Payments routing (BS29) · Media · Access.
- Route structure: `/admin/dashboard` shell + `/admin/dashboard/<section>` (or a client-side section state) — each section a React component fetching its own `/api/*`.
- **Responsive:** collapsible sidebar (hamburger on mobile), tables → stacked cards on narrow screens. Applies to the organizer dashboard too (cross-cutting responsive requirement).
- Keep the dark control-room palette (or lightly modernize during the port — design review decides).

**Migration approach.** Port section-by-section behind the same `/api/*` calls (no API change needed for existing panels), so each panel can be verified against the legacy behavior before the old `MARKUP`/`SCRIPT` is deleted. New sections (#3 carts, #5 verification queue enhancements, #7 payouts, #1 scanner users, #2 broadcasts) are built React-native from the start.

**Open decisions for eng review:** (a) route-per-section vs single-page sections; (b) shared admin data/layout primitives (a small `AdminShell` + table/card components) to avoid re-porting each panel ad hoc; (c) auth/session unchanged (`isAdmin` gate); (d) do we retire the legacy console in one cut or run both during the port.

---

## #3 — Cart / order visibility for admin

**Problem.** Admin can't see the **full order the user was trying to make** — only paid summaries. Abandoned/pending/failed carts with their line items are invisible, so support can't see what someone attempted.

**Model.** A super-admin order view showing EVERY order state (`pending, paid, payment_short, paid_unseatable, failed, expired, …`) with full **line items** (tier, qty, unit price), buyer contact, method/FSP, timestamps, and the credentials issued (if any). Filter by event/organizer/status; search by phone/email/order id.

**Schema / API.**
- No schema change — orders + order_items already exist. Add a super-admin read:
  `GET /api/admin/orders?status=&event=&organizer=&q=&limit=` → each order with `{ id, status, buyer, eventId/name, organizer, method, fspId, createdAt, lines:[{tier,qty,unitPrice}], total, credentials:[…] }`.
- Includes non-paid orders (the whole point) — so support sees the attempted cart. Guarded `isAdmin`, read-only, no buyer-PII leak beyond admin.
- (Split flow: show `table_split` + its `table_share` orders and per-share paid/pending state.)

**UI (responsive).** Orders & Carts section in the ported admin (#9): filterable table (stacked cards on mobile), row → drawer with the full cart, buyer, payment attempt, and credentials.

**Open decisions for eng review:** (a) how far back / pagination for pending+failed (could be large); (b) show split shares inline; (c) any redaction (full contact is intended for admin).
