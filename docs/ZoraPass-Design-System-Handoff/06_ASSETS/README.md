# Assets

## Folders

```
logo/svg   15 vector files — use these everywhere on web and in apps
logo/png   the same, rasterised, for places that can't take SVG
stamps/svg 115 stamp files: 17 states × 3 inks for DAR, plus 8 other cities in 2 inks
stamps/png the DAR set (51 files) at high resolution
stamps-campaign-only/   ADMIT US. Marketing only. Do NOT ship these in the product.
```

## Logo files

| File | Use |
|---|---|
| `zorapass-wordmark-black.svg` | Default, on light grounds |
| `zorapass-wordmark-chalk.svg` | On black and photos (bone ink) |
| `zorapass-wordmark-white.svg` | On colour, when bone is too warm |
| `zorapass-wordmark-signal.svg` | Yellow wordmark, on black only |
| `zorapass-logo-stacked-*.svg` | Square-ish spaces: app splash, avatars, stamps on merch |
| `zorapass-icon-*.svg` | The tear-line Z alone: app icon, favicon, avatar, loading |
| `zorapass-z-*.svg` | The Z glyph without the container |
| `zorapass-avatar-black/yellow.svg` | Social profile pictures |
| `zorapass-favicon.svg` | Favicon source |

Rules: minimum wordmark height 24px on screen (16px for the icon). Clear space around the wordmark equals the height of the "Z". Never stretch, re-space, outline, add a symbol beside it, or place it on a busy part of a photo — put it on a solid block instead.

**Live text alternative:** the wordmark is Bricolage Grotesque Bold at −0.035em tracking. Setting it as text is allowed in HTML when an SVG would be awkward (use the `.zp-logo` class in `fonts.css`). Anything printed or exported uses the SVG.

## Stamp file naming

```
zp-stamp-<state>-<city>-<ink>.svg
zp-stamp-zorapass-dar-black.svg      ← the default
zp-stamp-sold-out-dar-signal.svg
zp-stamp-checked-in-dar-chalk.svg
```

- **States:** zorapass · now-on · just-announced · on-sale · limited · few-left · almost-gone · sold-out · waitlist · were-in · checked-in · live-now · next-up · zora-pick · verified · tickets-on · powered-by
- **Cities:** dar · znz · ark · nbo · kla · kgl · los · acc · jnb
- **Inks:** black (on light), signal (yellow, on black), chalk (bone, on green or photos). DAR has all three; the other cities have black and signal.

Pick the stamp by the *true* state of the thing on screen. Default to `zorapass`.

## Favicon and app icons (to produce)

| Output | Source | Notes |
|---|---|---|
| `favicon.svg` | `logo/svg/zorapass-favicon.svg` | Modern browsers |
| `favicon.ico` 32/48 | same | Legacy |
| `apple-touch-icon.png` 180×180 | `zorapass-icon-yellow.svg` on black | No transparency, no rounded corners — iOS masks it |
| Android adaptive | foreground `zorapass-z-signal.svg`, background `#111111` | Keep the Z inside the 66% safe circle |
| iOS app icon 1024×1024 | Z in Signal Yellow on Board Black | Flat, no gloss, no gradient |
| Maskable PWA icon 512 | same | 20% padding |
| OG / Twitter image 1200×630 | Yellow ground, black wordmark, the stamp at −10° | Per page: event artwork left, black band right with the lockup |
| Splash screen | Black, centred stamped Z, no text | Stamp slam on launch, 180ms |

## Icons (UI)

The brand doesn't ship a UI icon set. Use **Lucide** or **Phosphor**, at 2px stroke weight, 20px/24px, square caps, and colour them with the text tokens. Icons are functional, never decorative. The only branded marks are the logo and the stamp.

## Photography

Real people at real events in Dar, shot at night, phones up, lights, movement. No stock photography, no staged studio smiles, no crowds shot from the stage as an anonymous mass. Treatment: no filters beyond exposure and contrast; if a photo needs to carry text, darken it with a solid black overlay at 40–60%, not a gradient.
