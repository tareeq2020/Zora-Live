/* ════════════════════════════════════════════════════════════════
   ZORA — share-card renderer (BS86 · the virality seed)
   ─────────────────────────────────────────────────────────────────
   Composes a brand-forward, consumer-plane share card as an SVG, then
   rasterizes to PNG with the SAME SVG→PNG path the tickets renderer uses
   (@resvg/resvg-js). NO headless browser (eng-review R1). The card READS
   the org theme (bg/card/accent/logo) + the event cover so it matches the
   storefront the buyer lands on; it never writes or mutates the theme.

     const { shareCardPNG, computeCardDigest } = require('./share-card');
     const png = await shareCardPNG({ format: 'og', theme, event, going });

   Two aspect ratios:
     · 'og'    → 1200×630  (1.91:1) — the link/WhatsApp UNFURL preview + download
     · 'story' → 1080×1920 (9:16)   — Instagram Stories download

   Resilience (eng-review failure-mode #1): a broken/oversized cover, a
   cover format resvg can't decode, or any render throw degrades to a
   BRANDED FALLBACK card (org colors + name + GET PASSES, no cover). The
   caller must NEVER get a 500 on the unfurl surface.
   ════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { Resvg } = require('@resvg/resvg-js');

const SANS = "'Space Grotesk','Segoe UI','Archivo',Arial,sans-serif";
const MONO = "'IBM Plex Mono','Consolas','Courier New',monospace";
// The "sunrise aura" — reserved for the logo O + the ONE accent affordance.
const AURA = ['#D53AD8', '#FF4D7D', '#FF9145'];

const DIMS = {
  og: { W: 1200, H: 630 },
  story: { W: 1080, H: 1920 },
};

/* ── small helpers ────────────────────────────────────────────── */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Relative luminance (0..1) of a #rgb/#rrggbb color — used to pick readable ink.
function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 0; // treat unknown as dark → light ink
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
// Contrasting ink for a solid fill (WCAG-ish): dark ink on light fills, else white.
const inkOn = (hex) => (luminance(hex) > 0.5 ? '#12131A' : '#FFFFFF');

// Estimate chars that fit in `w` px at `size` (Space Grotesk advance ≈ 0.54em / bold 0.58em).
function budget(w, size, bold) { return Math.max(1, Math.floor(w / (size * (bold ? 0.58 : 0.54)))); }

// Greedy word-wrap into ≤ maxLines, ellipsising the overflow.
function wrap(text, maxChars, maxLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (test.length <= maxChars) { line = test; continue; }
    if (line) lines.push(line);
    if (lines.length === maxLines) break;
    line = word.length > maxChars ? word.slice(0, maxChars - 1) + '…' : word;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    const consumed = lines.join(' ').replace(/…$/, '').split(/\s+/).length;
    if (consumed < words.length) {
      let last = lines[maxLines - 1];
      if (!last.endsWith('…')) last = (last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last) + '…';
      lines[maxLines - 1] = last;
    }
  }
  return lines.length ? lines : [''];
}

function textBlock(lines, x, y, lh, attrs) {
  return lines.map((ln, i) => `<text x="${x}" y="${y + i * lh}" ${attrs}>${esc(ln)}</text>`).join('');
}

/* ── "{N} going" social proof (eng-review R3 + design D4) ─────────
   Below 10 → no weak number; show nothing (caller shows a neutral hype
   line). At/above 10 → coarse ladder bucket so the card is stable across
   individual sales and only re-renders when a bucket boundary is crossed
   (feeds the cache-key digest). */
const GOING_LADDER = [10, 25, 50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
function goingBucket(sold) {
  const n = Number(sold) || 0;
  if (n < GOING_LADDER[0]) return null;
  let bucket = GOING_LADDER[0];
  for (const step of GOING_LADDER) if (n >= step) bucket = step;
  return bucket;
}
function goingLabel(sold) {
  const b = goingBucket(sold);
  return b == null ? null : `${b.toLocaleString('en-US')}+ going`;
}

/* ── theme normalization ──────────────────────────────────────── */
function themeColors(theme = {}) {
  const bg = theme.bg || '#0A0B10';
  const card = theme.card || '#14151C';
  const accent = theme.accent || '#4C6FFF';
  const lightBg = luminance(bg) > 0.5;
  return {
    bg, card, accent,
    ink: lightBg ? '#14161F' : '#F4F1EA',
    mut: lightBg ? '#5B6272' : '#9A9BA6',
    hair: lightBg ? 'rgba(16,18,27,0.12)' : 'rgba(255,255,255,0.13)',
    onAccent: inkOn(accent),
    logoUrl: theme.logoUrl || '',
    brandName: theme.brandName || 'Zora store',
  };
}

/* ── the composition ──────────────────────────────────────────── */
function shareCardSVG(input = {}) {
  const format = input.format === 'story' ? 'story' : 'og';
  const { W, H } = DIMS[format];
  const t = themeColors(input.theme);
  const cover = input.coverDataUri || '';
  const brandName = t.brandName;
  const title = input.title || brandName;
  const eyebrowBits = [input.city, input.dateLabel].filter(Boolean).map((s) => String(s).toUpperCase());
  const eyebrow = eyebrowBits.join(' · ');
  const url = input.url || 'zorapass.com';
  const going = input.going || null; // pre-computed label or null
  const hype = input.hype || 'Passes are live — get yours';
  const cta = input.cta || 'GET PASSES';

  const defs = `
    <defs>
      <linearGradient id="aura" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${AURA[0]}"/><stop offset="0.5" stop-color="${AURA[1]}"/><stop offset="1" stop-color="${AURA[2]}"/>
      </linearGradient>
      <linearGradient id="fallbackCover" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.card}"/>
      </linearGradient>
      <linearGradient id="coverShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.55" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.34)"/>
      </linearGradient>
      <clipPath id="coverClip"><rect id="coverRect" x="0" y="0" width="0" height="0"/></clipPath>
    </defs>`;

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${t.bg}"/>`);

  // Reusable "brand + logo" mark.
  const brandMark = (x, y, size) => {
    const logo = t.logoUrl
      ? `<image x="${x}" y="${y - size * 0.8}" width="${size}" height="${size}" href="${esc(t.logoUrl)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#logoClip)"/>`
      : `<circle cx="${x + size / 2}" cy="${y - size * 0.3}" r="${size / 2}" fill="url(#aura)"/>`;
    return (
      `<clipPath id="logoClip"><circle cx="${x + size / 2}" cy="${y - size * 0.3}" r="${size / 2}"/></clipPath>` +
      logo +
      `<text x="${x + size + 18}" y="${y}" font-family="${SANS}" font-weight="700" font-size="${size * 0.82}" fill="${t.ink}">${esc(brandName)}</text>`
    );
  };

  // Reusable accent CTA pill. Returns { svg, w } so callers can right-align it.
  const ctaPillW = (h) => Math.max(cta.length * (h * 0.52) + h, h * 3);
  const ctaPill = (x, y, h) => {
    const w = ctaPillW(h);
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.accent}"/>` +
      `<text x="${x + w / 2}" y="${y + h * 0.66}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${h * 0.4}" letter-spacing="1.5" fill="${t.onAccent}">${esc(cta)}</text>`
    );
  };

  // Reusable "{N} going" / hype chip (mono; social proof only when strong).
  const proofChip = (x, y, h) => {
    if (going) {
      const w = going.length * (h * 0.46) + h * 1.15;
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="none" stroke="${t.accent}" stroke-width="2"/>` +
        `<circle cx="${x + h * 0.62}" cy="${y + h / 2}" r="${h * 0.16}" fill="${t.accent}"/>` +
        `<text x="${x + h}" y="${y + h * 0.68}" font-family="${MONO}" font-weight="500" font-size="${h * 0.42}" fill="${t.ink}">${esc(going)}</text>`
      );
    }
    return `<text x="${x}" y="${y + h * 0.66}" font-family="${SANS}" font-weight="600" font-size="${h * 0.44}" fill="${t.mut}">${esc(hype)}</text>`;
  };

  const coverImage = (x, y, w, h) => {
    if (cover) {
      return (
        `<clipPath id="cc"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>` +
        `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${esc(cover)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cc)"/>` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#coverShade)"/>`
      );
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#fallbackCover)"/>`;
  };

  if (format === 'og') {
    // ── LANDSCAPE 1200×630 — cover left, brand-forward text right ──
    const coverW = Math.round(W * 0.46);
    parts.push(coverImage(0, 0, coverW, H));
    const cx = coverW + 56;
    const cw = W - cx - 56;

    parts.push(brandMark(cx, 92, 40));
    if (eyebrow) parts.push(`<text x="${cx}" y="150" font-family="${MONO}" font-size="19" letter-spacing="2.4" fill="${t.mut}">${esc(eyebrow)}</text>`);

    const nameLines = wrap(title, budget(cw, 58, true), 3);
    parts.push(textBlock(nameLines, cx, 220, 62, `font-family="${SANS}" font-weight="700" font-size="58" fill="${t.ink}"`));

    // proof chip (left) + primary GET PASSES CTA (right) share one row —
    // the CTA is the ONE place the card spends the accent as a solid affordance.
    const proofY = 220 + nameLines.length * 62 + 6;
    parts.push(proofChip(cx, proofY, 46));
    parts.push(ctaPill(W - 56 - ctaPillW(46), proofY, 46));

    // footer: the URL gets the full width (this is the payload — zorapass.com/handle).
    const fy = H - 66;
    parts.push(`<line x1="${cx}" y1="${fy - 30}" x2="${W - 56}" y2="${fy - 30}" stroke="${t.hair}" stroke-width="1.5"/>`);
    parts.push(`<text x="${cx}" y="${fy}" font-family="${MONO}" font-weight="500" font-size="26" letter-spacing="0.5" fill="${t.ink}">${esc(url)}</text>`);
  } else {
    // ── PORTRAIT 1080×1920 — cover top, text stacked below ──
    const coverH = Math.round(H * 0.56);
    parts.push(coverImage(0, 0, W, coverH));

    const px = 72;
    const pw = W - px * 2;
    let y = coverH + 116;
    parts.push(brandMark(px, y, 52));
    y += 70;
    if (eyebrow) { parts.push(`<text x="${px}" y="${y}" font-family="${MONO}" font-size="26" letter-spacing="3" fill="${t.mut}">${esc(eyebrow)}</text>`); y += 64; }

    const nameLines = wrap(title, budget(pw, 82, true), 3);
    parts.push(textBlock(nameLines, px, y, 92, `font-family="${SANS}" font-weight="700" font-size="82" fill="${t.ink}"`));
    y += nameLines.length * 92 + 28;

    parts.push(proofChip(px, y, 64));

    // footer near the bottom
    const fy = H - 120;
    parts.push(`<line x1="${px}" y1="${fy - 48}" x2="${W - px}" y2="${fy - 48}" stroke="${t.hair}" stroke-width="2"/>`);
    parts.push(`<text x="${px}" y="${fy}" font-family="${MONO}" font-weight="500" font-size="34" fill="${t.ink}">${esc(url)}</text>`);
    parts.push(ctaPill(px, fy + 30, 76));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">${defs}
  ${parts.join('\n  ')}
</svg>`;
}

/* ── rasterize (reuses the tickets @resvg/resvg-js path) ──────────
   Renders at native card size. On ANY resvg failure with a cover embedded
   (e.g. a format resvg can't decode), it retries WITHOUT the cover so the
   unfurl always gets a valid, branded PNG rather than a 500. */
function rasterize(svg, W) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
    background: 'transparent',
    shapeRendering: 2, textRendering: 2, imageRendering: 0,
  });
  return resvg.render().asPng();
}

async function shareCardPNG(input = {}) {
  const format = input.format === 'story' ? 'story' : 'og';
  const { W } = DIMS[format];
  try {
    return rasterize(shareCardSVG(input), W);
  } catch (e) {
    // Cover likely undecodable/broken → branded fallback, no cover.
    return rasterize(shareCardSVG({ ...input, coverDataUri: '' }), W);
  }
}

/* ── cover fetch, hard-capped (eng-review R1) ─────────────────────
   Fetches the event cover with a byte cap + timeout and returns a data
   URI resvg can embed. Any failure (timeout, oversized, non-image,
   network) returns null → the card renders its branded fallback. */
async function fetchCover(url, { maxBytes = 3_000_000, timeoutMs = 2500 } = {}) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res || !res.ok) return null;
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    // resvg decodes png/jpeg/gif reliably; skip anything else (incl. webp/svg).
    let mime = '';
    if (type.includes('png')) mime = 'image/png';
    else if (type.includes('jpeg') || type.includes('jpg')) mime = 'image/jpeg';
    else if (type.includes('gif')) mime = 'image/gif';
    else return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes || buf.length === 0) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── cache-key digest (eng-review R2) ─────────────────────────────
   v = short hash of (theme-version · price · sold-bucket · event-version).
   Bumps on publish/edit (event.updated_at), theme change (theme fields +
   updated_at), price change, or a sold-bucket crossing — so the unfurl URL
   changes exactly when the pixels should, and never on an individual sale
   within a bucket. */
function computeCardDigest(input = {}) {
  const theme = input.theme || {};
  const parts = [
    'v1',
    input.format || 'og',
    theme.bg || '', theme.card || '', theme.accent || '', theme.logoUrl || '', theme.brandName || '',
    theme.updatedAt || '',
    input.eventUpdatedAt || '',
    String(input.priceFrom == null ? '' : input.priceFrom),
    String(goingBucket(input.sold) || 0),
    input.title || '',
  ];
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

/* Pure visibility predicate for the STORE card (the event card reuses
   isPublicEvent from vendor/events). A missing org, a suspended org, or a
   suspended-handle set hit → not visible → the route 404s (eng-review R4,
   failure-mode #2). */
function storeCardVisible(org, suspendedSet) {
  if (!org) return false;
  if (String(org.status || '').toLowerCase() === 'suspended') return false;
  if (suspendedSet && typeof suspendedSet.has === 'function' && suspendedSet.has(org.handle)) return false;
  return true;
}

module.exports = {
  shareCardSVG,
  shareCardPNG,
  fetchCover,
  computeCardDigest,
  goingBucket,
  goingLabel,
  storeCardVisible,
  DIMS,
};
