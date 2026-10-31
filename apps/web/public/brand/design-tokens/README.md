# Design tokens

`tokens.json` is the **single source of truth**. Everything else in this folder is generated from it by `build-tokens.py` (Python 3, no dependencies):

```bash
python3 build-tokens.py
```

| File | For |
|---|---|
| `tokens.json` | The source. Edit this, never the generated files. |
| `zorapass.css` | CSS custom properties (`--zp-*`), light and dark themes, plus ready-made `.zp-chip--*` status classes |
| `fonts.css` | Font loading and the whole type scale as classes (`.zp-display-xl`, `.zp-h1`, `.zp-body`, `.zp-meta`…) |
| `tokens.scss` | SCSS variables |
| `tailwind.zorapass.js` | Tailwind preset — `presets: [require('./tailwind.zorapass.js')]` |
| `tokens.js` | Plain JS / TypeScript / React Native |
| `tokens.dart` | Flutter (`ZpColors`, `ZpSpace`, `ZpRadius`, `ZpType`) |
| `ZPTokens.swift` | SwiftUI |
| `ZpTokens.kt` | Jetpack Compose |

## How to wire the themes (web)

```html
<link rel="stylesheet" href="fonts.css">
<link rel="stylesheet" href="zorapass.css">
```

- Light (bone) is the default.
- Dark follows the OS automatically, and `document.documentElement.dataset.theme = 'dark' | 'light'` overrides it.
- Use the **semantic** variables in components: `var(--zp-surface)`, `var(--zp-text-primary)`, `var(--zp-border)`, `var(--zp-brand)`. Reach for a primitive such as `--zp-color-signal-yellow` only when the value must stay the same in both themes (the logo mark, a stamp ink).

## Rules

1. No hard-coded hex values in components. If a value isn't in the tokens, it doesn't belong in the UI.
2. No new brand colours. Extra UI states come from the neutral ramp.
3. Spacing is the 8px scale. `space-3` (12px) is the smallest gap between unrelated things.
4. Text never renders below 12px, and body input text never below 16px (iOS zooms otherwise).
5. If you need a token that doesn't exist, add it to `tokens.json`, regenerate, and tell the brand owner — don't patch it locally.
