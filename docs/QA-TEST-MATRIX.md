# Zora — QA test matrix

Everything shipped in this cycle (PR-BS22 → BS45), where to test it, and what "correct" looks like.

## Before you start

**Environments**
- Production: `https://www.zorapass.com` (web auto-deploys; API is on PM2)
- Live tenant for testing: **The Brunch City** — `/thebrunchcity`

**Accounts you need**
| Role | How to get in | Notes |
|---|---|---|
| Super admin | `/admin` → username `admin` | ⚠️ password is still the repo default — **rotate before QA** and use the new one |
| Organizer | `/dashboard/login` — handle + password | Admin can set one: ADMIN → ORGANIZERS → set password |
| Buyer | none — public checkout | Use a real TZ number you control (SMS OTP + payment prompts are real) |
| Scanner (agent / supervisor) | 6-digit code from ADMIN → SCANNER USERS | Two separate users, two different roles |

**Deployment check** (run first; if an endpoint 404s, it's not deployed — that's not a bug to file):
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' https://www.zorapass.com/api/scan/session   # expect 400
curl -s -o /dev/null -w '%{http_code}\n' https://www.zorapass.com/api/org/payouts                                                        # expect 401
```
`400/401` = deployed and correctly refusing. `404` = not deployed. `500` = deployed but **migrations may not have run** — escalate, don't file as a feature bug.

**Money warning:** the payment gateway is live. Real charges. Use small-value tiers, and don't approve payouts in production unless you intend to actually pay.

---

## 1. Consumer / buyer surfaces

| # | Feature | Where | What correct looks like |
|---|---|---|---|
| 1.1 | Coming-soon home | `/` | Dark cinematic landing, orb + rings, 3 acts (Hi I'm Zora → brand line → "We are going Live Soon"), REPLAY works, reduced-motion respected |
| 1.2 | "Explore events" link | `/` header | Goes to `/thebrunchcity` |
| 1.3 | Discover redesign | `/discover` | Dark consumer skin, cover-forward cards, FROM price in mono, SPLITTABLE badge, search + city filter + chips all work |
| 1.4 | Discover states | `/discover` | Empty city ("No events in {city} yet"), empty search + SHOW EVERYTHING, loading skeletons, error state with retry |
| 1.5 | Discover currency | `/discover` switch city | A Dar event still shows **TZS**, never relabelled to the browsed city's currency |
| 1.6 | Storefront index | `/thebrunchcity` | Dark, organizer accent, one hero, event cards |
| 1.7 | Card FROM price | `/thebrunchcity` | FROM = the **cheapest tier that's on sale**; a disabled cheap tier must NOT set the headline |
| 1.8 | Off-sale events hidden | `/thebrunchcity` | An event whose tiers are **all** off does not appear at all |
| 1.9 | Event page packages | `/@thebrunchcity/events/apricot-crush` | **All** on-sale packages listed with prices — not just a FROM line |
| 1.10 | Splittable highlighting | same | Split tiers show a `SPLITTABLE` badge + "Split this table →" |
| 1.11 | Not-on-sale leaf | event with all tiers off | "Tickets aren't on sale right now" — no dead GET TICKET button |
| 1.12 | Checkout accent | any GET PASSES / GET TICKET | Pop-up uses the **organizer's accent** (Brunch City = green), never default blue |
| 1.13 | Honest fee copy | checkout + marketing | "Zora adds no booking fee. Your mobile-money or card provider may charge a small fee." **No** "no fees at checkout" anywhere |
| 1.14 | Bare handle alias | `/thebrunchcity` and `/@thebrunchcity` | Both resolve to the storefront |

## 2. Organizer dashboard

| # | Feature | Where | What correct looks like |
|---|---|---|---|
| 2.1 | Self-registration | `/dashboard/signup` | Phone → OTP → org name + handle picker with **live availability**; no Google button (deferred) |
| 2.2 | Handle rules | signup | Taken handle refused; reserved handle (`storefront`, `login`, `admin`…) refused; a refused handle does **not** burn the OTP |
| 2.3 | Pending state | `/dashboard` as a new org | Banner: verification pending, can build drafts, publish + withdrawals locked; CTA "Set up your first drop" |
| 2.4 | Publish gate | pending org tries to publish | Blocked (KYC required); **drafts still save** |
| 2.5 | Net earnings | `/dashboard` | KPI reads **NET EARNINGS** = net of commission, with "net of X%" + gross shown |
| 2.6 | Sales net | `/dashboard/sales` | Header + per-event rows show **net**, with the commission note |
| 2.7 | Tier editor | drop editor → Tickets & Pricing | Note: buyers pay the set price, payout is net of X% commission |
| 2.8 | Tier on/off | drop editor | Toggle a tier off → it disappears from the storefront; existing tickets stay valid |
| 2.9 | Tier delete | drop editor | Tier with sales **cannot** be deleted (clear message); clean tier can |
| 2.10 | Split seats | drop editor, split tier on | "Max people per table" field; value carries into the split flow's cap |
| 2.11 | Live-but-hidden warning | drop with all tiers off | "⚠ No tickets on sale — hidden from your storefront" |
| 2.12 | Archive / restore | `/dashboard` drop row | Archive works **even with sales**; Restore brings it back; Delete still refuses drops with paid orders |
| 2.13 | Payout balance | `/dashboard/payouts` | Balance card first, mono figure, "net of X% commission" |
| 2.14 | Payout request | same | Amount ≤ balance succeeds; over-balance refused with a clear reason; below minimum (10,000 TZS) refused |
| 2.15 | Payout gating | unverified org | Cannot request — clear "not verified" message |
| 2.16 | Pending reservation | request, then try again | Second request blocked / balance reduced — never able to over-withdraw |

## 3. Super admin console (`/admin`)

| # | Feature | Where | What correct looks like |
|---|---|---|---|
| 3.1 | React shell + sidebar | `/admin/dashboard` | Left sidebar, section in the URL hash (survives refresh), impersonation banner when acting |
| 3.2 | Responsive | resize < 900px | Sidebar becomes a hamburger drawer (scrim + Esc); tables stack into cards < 620px |
| 3.3 | Organizers | ORGANIZERS | List, suspend/unlock, **act on behalf**, commission % column editable (0–50) |
| 3.4 | Verification queue | VERIFICATION | KYC cases **and** self-signups (marked); approve unlocks selling + payouts; reject carries a reason |
| 3.5 | Orders & carts | ORDERS & CARTS | **Every** state incl. pending/failed; filter by status/event; search phone/email/order id |
| 3.6 | Cart drawer | click "Open cart" | Full items, buyer, payment attempt, credentials |
| 3.7 | Split cart | open a `table_share` order | Shows **SEATS** with per-seat state — **not** an empty cart |
| 3.8 | PII window | an old never-paid cart | Contact masked; paid orders keep contact |
| 3.9 | Payout queue | PAYOUTS | Approve **requires a reference**; reject **requires a reason**; decided rows can't be re-decided |
| 3.10 | Payments routing | PAYMENTS | Per-method + per-network FSP; GODIGITAL rejected for card/bill-pay (mobile-only) |
| 3.11 | Scanner users | SCANNER USERS | Create agent + supervisor, assign role/scope, rotate code, revoke |
| 3.12 | Audit log | OVERVIEW | Recent admin actions incl. commission changes, payout decisions, verification |

## 4. Door scanner (`/scan`) — test on a phone

| # | Feature | Where | What correct looks like |
|---|---|---|---|
| 4.1 | Shift sign-in | `/scan` | 6-digit code → session; wrong code refused; **repeated wrong codes → locked out** (429), and the message says so |
| 4.2 | Agent scan (valid) | scan a real pass QR | **Full-screen solid GREEN**, ✓, holder + tier, haptic, auto-dismiss |
| 4.3 | Replay | scan the same QR twice | **Solid RED**, "Already used", shows **who scanned it and when** |
| 4.4 | Invalid / wrong event | forged or other-event QR | Solid RED with the plain reason |
| 4.5 | Needs supervisor | scan a comp/table pass | **Aura gradient** takeover — "Get a supervisor" |
| 4.6 | Role gate | agent tries to confirm | Refused; supervisor cannot use the agent verify endpoint |
| 4.7 | Supervisor queue | sign in as supervisor | Calm dark queue; CONFIRM issues the wristband; item leaves the queue |
| 4.8 | Camera denied | block camera permission | Falls back to manual pass-reference entry — never a dead end |
| 4.9 | Offline dot | turn off data | Amber dot + honest message; no silent dropped scan |
| 4.10 | Revoke | admin revokes the code | That scanner is out immediately (401) |

## 5. Bulk messaging (API is live; organizer composer UI is NOT built yet)

| # | Feature | Where | Status |
|---|---|---|---|
| 5.1 | Send / audience / opt-out / caps | API only | ✅ built + tested — **no organizer UI yet**, so QA via API or defer |
| 5.2 | Admin Broadcasts section | ADMIN → BROADCASTS | ⚠️ still a **placeholder** — expected, not a bug |

---

## Automated coverage (already passing — re-run before a release)

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
bash db/test/org-sales.e2e.sh       # revenue, split revenue, stamped commission, refunds
bash db/test/org-events.e2e.sh      # drops, tiers, split seats, archive/restore
bash db/test/payouts.e2e.sh         # balance, CONCURRENT over-withdraw guard
bash db/test/org-register.e2e.sh    # signup, handle rules, verification gate
bash db/test/scan.e2e.sh            # replay, role gate, brute-force lockout
bash db/test/broadcasts.e2e.sh      # scope isolation, opt-out, caps, bounded drain
bash db/test/admin-orders.e2e.sh    # pending/failed carts, split seats, pagination, PII
bash db/test/pg-parity.e2e.sh       # API == golden fixtures
```

## Highest-risk areas — test these hardest

1. **Payout concurrency** (2.16) — two withdrawal requests at once must never over-withdraw.
2. **Commission at time of purchase** — change an organizer's commission in admin, then check that **past** earnings do **not** change; only new orders use the new rate.
3. **Refunds** — a refunded order must leave earnings and must **not** be withdrawable.
4. **Split carts** (3.7) — the case most likely to regress into an empty cart.
5. **Scanner replay + lockout** (4.3, 4.1) — the two that matter at a real gate.

## Known gaps (don't file these)

- Organizer **messaging composer UI** not built (API is).
- Admin **Broadcasts** section is a placeholder.
- **Google OAuth** signup deliberately deferred — phone-OTP only.
- Payout screens have had **no visual/design pass** yet.
- Organizer dashboard is still **light**; the dark unify ships with a later PR.
