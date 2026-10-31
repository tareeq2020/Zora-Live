# Screen direction — website and app

The order below is the build order. Four of these screens are drawn in `07_STYLE_GUIDE/index.html`.

## The spine

`DISCOVER → DECIDE → BUY → EXPERIENCE → SHARE → RETURN`

Every screen belongs to one of those. If a screen doesn't move someone to the next one, it doesn't ship.

---

## WEB

### 1. Home — "What's on"
**Stage: discover.** The homepage is a listings page, not a brochure.

- Hero: bone or yellow ground, `WHAT'S ON?` in Bungee, one line of support copy, city selector, date filter (Today · This weekend · This week · Pick dates), and the ZORAPASS stamp at −10°.
- Then, immediately: **This weekend** as a board list or a 2–4 card grid. Real events above the fold on desktop, within one scroll on mobile.
- Then: Zora Picks · New on ZoraPass · By category (Live music, Day parties, Festivals, Nightlife, Comedy, Experiences) · By area.
- Footer CTA band: black, `YOUR PASS TO WHAT'S ON.`, app links.
- No carousel that auto-rotates. No hero video. No newsletter pop-up on first visit.

### 2. City page — `/dar`, `/znz`
Same as home, scoped, with the city code in the stamp ring and a short line of what the city is known for.

### 3. Category / search results
Filters as chips (date, price, area, category), results as cards, sort by date by default. Empty state uses the pattern in `04_UI_COPY`.

### 4. Event page — the money page
**Stage: decide → buy.** One column on mobile, two on desktop (content left, sticky purchase panel right).

Order: artwork (4:5 or 16:9, never cropped into a circle) · status chip · event name (h1) · organizer name + VERIFIED EVENT chip · date, time, venue, area as mono rows · price from · **GET PASSES** (sticky on mobile) · about · lineup with set times · know before you go (doors, age, dress, parking, entry) · map · organizer's other events.

- The purchase panel lists tiers as rows: name, description, price, chip. Sold-out tiers stay visible, struck through.
- Share row: WhatsApp first, then copy link, then Instagram story image.
- Structured data: `Event` schema, `offers` with price and availability, so Google shows it properly.

### 5. Checkout
**Stage: buy.** Three steps, one page, no account wall before the first step.

1. **Passes** — tier rows with a quantity stepper. At 2+, the group options appear inline: "One checkout for everyone going" and "Split with Tuchange".
2. **Who's going** — buyer's name and phone (+255 default) plus optional names per pass. Guest checkout must work; account creation happens after payment.
3. **Pay** — mobile money and card, in that order for Tanzania. Fees shown before the button. Button: `GET PASSES · TSh 100,000`.

Rules: never lose the cart on a failed payment; hold passes for a visible countdown (mono timer); if the tier sells out mid-flow, say so and offer the waitlist.

### 6. Confirmation
**Stage: buy → share.** Black screen, `YOU'RE IN.` in Bungee, the ZORAPASS stamp slamming in, event details, `OPEN MY PASS`, then "Add to Apple Wallet / Google Wallet" and a share card ("WE'RE IN.") for the buyer to post.

### 7. My passes
List of upcoming passes (event, date, venue, ADMIT n), past passes below in a muted state. Each opens the pass screen.

### 8. Pass screen
As specified in `03_COMPONENTS`. Works offline. Brightness hint. Tear line. QR. Stamp.

### 9. Organizer landing + dashboard
- **Landing:** bone, `SELL OUT YOUR NEXT EVENT.`, three proof points (sell passes · get paid · check people in · know your crowd), pricing, `START SELLING`.
- **Dashboard:** black or bone, data in mono, one yellow accent per chart. Cards: sales today, passes sold vs capacity (yellow bar), revenue, check-ins live. Event list as board rows. Never decorate data — the numbers are the design.

### 10. Auth
Phone-first: number → OTP → done. Email optional. No password until the user asks for one.

---

## APP

The app is the pass, the discovery feed and the wallet. It can default to the dark theme.

| Screen | Notes |
|---|---|
| First run | Three cards, no account: what's on · one pass or many · your pass in your phone. Then "Find events". |
| What's on (tab 1) | Today / This weekend / This week segmented control, board list and cards, city switcher in the header. |
| Search (tab 2) | Recent searches, categories, areas, date chips. |
| Event | Same content as web, single column, sticky GET PASSES bar at the bottom. |
| Checkout | Same three steps as web, native payment sheets. |
| My passes (tab 3) | Upcoming first, each as a mini pass card; tap opens the full pass. Works offline. |
| Pass | Full-bleed, auto brightness, QR, tear line, stamp. Live status. |
| Profile (tab 4) | Passes history, payment methods, city, notifications, help. |
| Notifications | Per-event opt-in, day-before and door-open reminders on by default. |

**Organizer app / check-in mode** (can be the same app, unlocked by role):

- Scanner screen: camera full-bleed, a yellow frame, a big green `CHECKED IN.` on success with the stamp slam, a red `ALREADY IN` or `WRONG EVENT` on failure. Haptics, and a sound that can be muted.
- Works offline for the whole door; syncs after.
- Door stats: checked in / total, last 10 scans.

---

## Layout rules (both platforms)

- Container max 1200px, gutters 16 / 24 / 32.
- Grid: 4 columns mobile, 8 tablet, 12 desktop.
- Cards per row: 1 / 2 / 3–4.
- Vertical rhythm: 8px base; 24px between blocks on mobile, 48–64px between sections on desktop.
- One ground per section, and never two yellow sections in a row.
- Photography: real people at real events, shot at night, no stock, no staged smiles. When there's no photo, use a black block with the stamp rather than a placeholder image.
- Every page states its city. Every event states its status.
