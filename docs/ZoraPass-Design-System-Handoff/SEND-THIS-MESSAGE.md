# Message to send with this folder

Copy, paste, send. Attach the zip, or share the folder link.

---

**Subject: ZoraPass — brand and design direction for the website and app rebuild**

Team,

Here is the current ZoraPass design direction, everything in one folder. It replaces anything you have from before.

Start with `00_START_HERE.md`, then open `07_STYLE_GUIDE/index.html` in a browser — it shows the whole system rendered: colours, type, components and four example screens.

What's inside:

- `01_BRAND_DIRECTION` — the positioning and the language rules, written for product, not marketing.
- `02_DESIGN_TOKENS` — `tokens.json` plus generated CSS variables, a Tailwind preset, SCSS, JS/React Native, Dart, Swift and Kotlin. Use the tokens; no hard-coded colours.
- `03_COMPONENTS` — specs for buttons, status chips, the stamp, cards, the listings board, the pass, forms, navigation, empty and error states, motion, and an accessibility checklist we want signed off before launch.
- `04_UI_COPY` — the exact strings: CTA labels, status names, errors, notifications, and what we never write.
- `05_SCREENS` — screen-by-screen direction for web and app, in build order.
- `06_ASSETS` — logo and stamp files in SVG and PNG, plus the favicon and app-icon spec.

The short version of the brand:

1. ZoraPass is **ticketing + live entertainment**. The line is "Your pass to what's on."
2. The event is the hero; ZoraPass is the frame.
3. It works the same for one person or twenty — groups are a feature, never the framing.
4. Fonts are Bungee (display), Bricolage Grotesque (everything else), IBM Plex Mono (numbers and codes).
5. Yellow `#FFD21F`, black `#111111`, bone `#F7F5EE`. The stamp is our second mark, and its default state is ZORAPASS.
6. Marketing campaign lines (ADMIT US., TUKO WANGAPI?) never appear in the product.
7. The CTA is GET PASSES, never BUY NOW.

Please build in this order: What's on → event page → checkout → confirmation → my passes → the pass. That's the money path.

If something isn't covered here, ask me before you invent it.

---

## Still open — tell the devs where you stand

- Payment methods to name in the UI (M-Pesa, Airtel Money, Mixx by Yas, cards). The templates currently say "mobile money".
- Refund and transfer policy wording.
- Whether seat selection ships in this version.
- The Zanzibar launch date, for the city switcher.
