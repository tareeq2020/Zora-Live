# ZoraPass — design system handoff for the website and app

**Version 1.0 · 23 September 2026 · Stamp & Signal**

This folder is everything a developer needs to rebuild zorapass.com and the ZoraPass app on the current brand. Read this page first, then open `07_STYLE_GUIDE/index.html` in a browser. It shows every token and component rendered, plus four example screens.

## What ZoraPass is (the one paragraph that governs the UI)

ZoraPass is a **ticketing and live entertainment** platform. People use it to **discover → choose → buy → experience** events. It works the same for one person or twenty: *one pass or many.* The brand line is **"Your pass to what's on."**

Three product consequences:

1. The event is the hero. ZoraPass is the frame around it, never louder than the artwork.
2. Groups are a feature, not an identity. Never force people to call themselves a squad to buy four passes.
3. Campaign lines (ADMIT US., TUKO WANGAPI?) are marketing only. **They never appear in the product UI.**

## The folder

| Folder | What's in it | Who needs it |
|---|---|---|
| `01_BRAND_DIRECTION` | The short version of the brand direction, written for engineers and product | Everyone |
| `02_DESIGN_TOKENS` | `tokens.json` (source of truth) plus generated CSS variables, SCSS, Tailwind preset, JS/RN, Dart, Swift, Kotlin | Engineers |
| `03_COMPONENTS` | Component specs: anatomy, sizes, states, accessibility | Engineers, designers |
| `04_UI_COPY` | Every string pattern: CTA labels, status names, errors, empty states, what never to write | Engineers, product, content |
| `05_SCREENS` | Screen-by-screen direction for web and app, with layout rules | Engineers, designers |
| `06_ASSETS` | Logo and stamp files in SVG and PNG, plus the favicon and app icon spec | Engineers |
| `07_STYLE_GUIDE` | A single HTML file: live tokens, components and example screens | Everyone |

## Order of work we recommend

1. Install the three fonts (`02_DESIGN_TOKENS/fonts.css`). Everything else depends on them.
2. Drop in the tokens for your stack, and wire the light and dark themes.
3. Build the primitives in this order: button, status chip, input, card, board row, stamp, pass.
4. Then the screens in `05_SCREENS`, starting with What's on → event → checkout → confirmation → my passes. That is the money path.
5. Run the accessibility checklist at the end of `03_COMPONENTS/components.md` before you ship.

## Non-negotiables

- **Fonts:** Bungee (display, caps only), Bricolage Grotesque (headlines, body, UI, and the logo), IBM Plex Mono (data, labels, codes). No other fonts.
- **Colour:** Signal Yellow `#FFD21F`, Board Black `#111111`, Bone `#F7F5EE`. Yellow is the brand's signature, not a warning colour. Alert Red is only for problems.
- **The logo** is the word "ZoraPass", one word, Bricolage Grotesque Bold, letter-spacing −0.035em. Never "Zora Pass", never a divider, never "Zora" alone.
- **The stamp** is the brand's second mark. Its default state is **ZORAPASS**. A status state (SOLD OUT, FEW LEFT, CHECKED IN…) is only ever shown when it is actually true. Never invent states, never re-colour outside the supplied inks.
- **Never say "BUY NOW".** The CTA is GET PASSES.
- No gradients, drop shadows as decoration, sun motifs, flags, maps, safari or tribal patterns, or invented slang.

## Source documents (live, always current)

- **Brand Direction (Final)** — the strategy, the language hierarchy and the content system: https://claude.ai/code/artifact/62bc2691-3c98-4c88-b9a1-c7db7ee7726b
- **Canva Brand Library** — the full marketing system, 329 templates and the rules behind them: https://claude.ai/code/artifact/3128e193-7b9b-48be-812b-49b3a3833828

If this folder and those documents ever disagree, the documents win for strategy and the tokens in this folder win for implementation values.

## Questions the devs will ask, answered

- **Do we need the marketing template library?** No. That is for the social and print team. This folder is the product system.
- **Can we add a colour?** No new brand colours. If a UI state needs one, use the neutrals in the tokens.
- **Can we use a component library (shadcn, MUI, Material)?** Yes, as scaffolding, as long as the tokens here override its theme completely. The result must not look like default Material or default Bootstrap.
- **Dark mode?** Yes. Both themes are defined in the tokens. Black is the natural night-out theme, so the app may default to dark; the marketing site defaults to light (bone).
- **What about seat maps, refunds, payment method names?** Not settled yet. Ask Mr T before you design those screens.
