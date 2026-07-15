/* ════════════════════════════════════════════════════════════════
   ZORA — programmatic premium ticket renderer
   ─────────────────────────────────────────────────────────────────
   Builds a brand-aligned collector's pass as an SVG, then rasterizes
   to a high-resolution PNG. No templates — every element is drawn and
   positioned in code, dark + light theme aware, with real QR codes.

     const { ticketSVG, ticketPNG } = require('./lib/ticket');
     const png = await ticketPNG(data, { theme: 'dark' });   // -> Buffer

   `data` shape:
     { event, dateLabel, venue,
       tableName, tableNo, seats,
       guest, ticketId, tier,
       qr }   // string encoded into the QR (defaults to zora://t/<ticketId>)
   ════════════════════════════════════════════════════════════════ */
const QRCode = require('qrcode');
const { Resvg } = require('@resvg/resvg-js');

/* ── brand palettes ───────────────────────────────────────────── */
const THEMES = {
  dark: {
    bg: '#0A0B10', panel: '#14151C', panelEdge: 'rgba(255,255,255,0.10)',
    ink: '#F4F1EA', mut: '#8B8C97', faint: 'rgba(255,255,255,0.06)',
    accent: '#4C6FFF', hair: 'rgba(255,255,255,0.13)', qrChip: '#FFFFFF',
    tableTint: 'rgba(76,111,255,0.10)', tableEdge: 'rgba(124,160,255,0.45)',
  },
  light: {
    bg: '#F5F1E8', panel: '#FFFFFF', panelEdge: 'rgba(0,0,0,0.10)',
    ink: '#0C1020', mut: '#6C6D77', faint: 'rgba(0,0,0,0.04)',
    accent: '#3D5AFE', hair: 'rgba(0,0,0,0.12)', qrChip: '#FFFFFF',
    tableTint: 'rgba(61,90,254,0.07)', tableEdge: 'rgba(61,90,254,0.32)',
  },
};
// The "sunrise aura" — reserved for the logo O and a single accent hairline.
const AURA = ['#D53AD8', '#FF4D7D', '#FF9145'];
const SANS = "'Space Grotesk','Segoe UI','Archivo',Arial,sans-serif";
const MONO = "'IBM Plex Mono','Consolas','Courier New',monospace";

/* ── helpers ──────────────────────────────────────────────────── */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Estimate how many characters of a given weight fit in `w` px at `size`.
// Space Grotesk / Segoe UI average glyph advance ≈ 0.54em (bold ≈ 0.58em).
function budget(w, size, bold) { return Math.max(1, Math.floor(w / (size * (bold ? 0.58 : 0.54)))); }

// Greedy word-wrap into at most `maxLines`, ellipsising the overflow.
function wrap(text, maxChars, maxLines) {
  const words = String(text || '').trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (test.length <= maxChars) { line = test; continue; }
    if (line) lines.push(line);
    if (lines.length === maxLines) break;
    // a single word longer than the line — hard-cut it
    line = word.length > maxChars ? word.slice(0, maxChars - 1) + '…' : word;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    // if content was truncated, ellipsise the last line
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
  return lines.map((ln, i) =>
    `<text x="${x}" y="${y + i * lh}" ${attrs}>${esc(ln)}</text>`).join('');
}

// A real QR, drawn as crisp module rects (dark modules on a transparent bg).
function qrRects(text, x, y, size, dark) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const cell = size / n;
  let r = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (data[row * n + col]) {
        // +0.5px overlap kills hairline seams between modules when rasterized
        r += `<rect x="${(x + col * cell).toFixed(2)}" y="${(y + row * cell).toFixed(2)}" width="${(cell + 0.5).toFixed(2)}" height="${(cell + 0.5).toFixed(2)}" fill="${dark}"/>`;
      }
    }
  }
  return r;
}

// Horizontal dashed "tear-off" line with a notch cut into each card edge.
function tearOff(y, W, pad, t) {
  const notch = 13;
  return (
    `<circle cx="0" cy="${y}" r="${notch}" fill="${t.bg}"/>` +
    `<circle cx="${W}" cy="${y}" r="${notch}" fill="${t.bg}"/>` +
    `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="${t.hair}" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>`
  );
}

/* ── the template ─────────────────────────────────────────────── */
function ticketSVG(data = {}, opts = {}) {
  const t = THEMES[opts.theme === 'light' ? 'light' : 'dark'];
  const W = 760, H = 1180, pad = 52, R = 34;
  const innerW = W - pad * 2;

  const d = {
    event: data.event || 'Untitled Event',
    dateLabel: data.dateLabel || 'Date TBA',
    venue: data.venue || 'Venue TBA',
    tableName: data.tableName || 'General Admission',
    tableNo: data.tableNo || '—',
    seats: data.seats == null ? '—' : String(data.seats),
    guest: data.guest || 'Guest',
    ticketId: data.ticketId || 'ZORA-0000-0000',
    tier: data.tier || 'STANDARD',
    qr: data.qr || `zora://t/${data.ticketId || 'ZORA-0000-0000'}`,
  };

  // ── vertical rhythm ──
  let y = 0;
  const label = (x, yy, s) => `<text x="${x}" y="${yy}" font-family="${MONO}" font-size="12.5" letter-spacing="2.4" fill="${t.mut}">${esc(s)}</text>`;

  // Header
  const headTop = 70;
  const eventLines = wrap(d.event, budget(innerW, 46, true), 3);
  const eventLH = 50;
  const headerH = headTop + 44 /*eyebrow*/ + eventLines.length * eventLH + 76 /*date/venue*/;

  // Table block
  const tableTop = headerH + 20;
  const tableNameLines = wrap(d.tableName, budget(innerW - 56, 34, true), 2);
  const tableNameLH = 38;
  const tableH = 34 /*label*/ + tableNameLines.length * tableNameLH + 76 /*no/seats row*/ + 52;
  const tableBoxY = tableTop;

  // Ticket block
  const tearY1 = tableBoxY + tableH + 34;
  const ticketTop = tearY1 + 44;
  const guestLines = wrap(d.guest, budget(innerW, 40, true), 2);
  const guestLH = 44;
  const ticketH = 26 + guestLines.length * guestLH + 74;

  // Security block
  const tearY2 = ticketTop + ticketH + 20;
  const qrTop = tearY2 + 44;
  const qrSize = 216;
  const chip = qrSize + 40;

  // ── compose ──
  const parts = [];

  // card + subtle top aura hairline
  parts.push(
    `<rect x="0" y="0" width="${W}" height="${H}" rx="${R}" fill="${t.bg}"/>`,
    `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="${R - 2}" fill="none" stroke="${t.panelEdge}" stroke-width="1.5"/>`,
    `<rect x="${pad}" y="34" width="${innerW}" height="4" rx="2" fill="url(#aura)"/>`
  );

  // ── HEADER ──
  y = headTop;
  // wordmark z●ra  (the O carries the aura)
  parts.push(
    `<text x="${pad}" y="${y}" font-family="${SANS}" font-weight="700" font-size="24" letter-spacing="1" fill="${t.ink}">z<tspan fill="url(#aura)">o</tspan>ra</text>`,
    `<text x="${W - pad}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="12.5" letter-spacing="2.4" fill="${t.accent}">${esc(d.tier.toUpperCase())} · PASS</text>`
  );
  y += 40;
  parts.push(label(pad, y, 'EVENT'));
  y += 30;
  parts.push(textBlock(eventLines, pad, y, eventLH, `font-family="${SANS}" font-weight="700" font-size="46" fill="${t.ink}"`));
  y += (eventLines.length - 1) * eventLH + 52;
  // date + venue two-up
  const colB = pad + innerW * 0.5;
  parts.push(
    label(pad, y, 'DATE'),
    label(colB, y, 'VENUE')
  );
  y += 28;
  parts.push(
    `<text x="${pad}" y="${y}" font-family="${SANS}" font-weight="500" font-size="21" fill="${t.ink}">${esc(d.dateLabel)}</text>`,
    textBlock(wrap(d.venue, budget(innerW * 0.5 - 10, 21, false), 2), colB, y, 26, `font-family="${SANS}" font-weight="500" font-size="21" fill="${t.ink}"`)
  );

  // ── TABLE BLOCK (framed, high-contrast) ──
  parts.push(
    `<rect x="${pad}" y="${tableBoxY}" width="${innerW}" height="${tableH}" rx="20" fill="${t.tableTint}" stroke="${t.tableEdge}" stroke-width="1.5"/>`,
    `<rect x="${pad}" y="${tableBoxY}" width="5" height="${tableH}" rx="2.5" fill="url(#aura)"/>`
  );
  let ty = tableBoxY + 40;
  parts.push(label(pad + 30, ty, 'TABLE'));
  ty += 34;
  parts.push(textBlock(tableNameLines, pad + 30, ty, tableNameLH, `font-family="${SANS}" font-weight="700" font-size="34" fill="${t.ink}"`));
  ty += (tableNameLines.length - 1) * tableNameLH + 58;
  const tCol2 = pad + innerW * 0.56;
  parts.push(
    label(pad + 30, ty, 'TABLE NO.'),
    label(tCol2, ty, 'SEATS / GUESTS'),
  );
  ty += 34;
  parts.push(
    `<text x="${pad + 30}" y="${ty}" font-family="${SANS}" font-weight="700" font-size="30" fill="${t.accent}">${esc(d.tableNo)}</text>`,
    `<text x="${tCol2}" y="${ty}" font-family="${SANS}" font-weight="700" font-size="30" fill="${t.ink}">${esc(d.seats)}</text>`
  );

  // tear-off
  parts.push(tearOff(tearY1, W, pad - 14, t));

  // ── TICKET BLOCK ──
  let iy = ticketTop;
  parts.push(label(pad, iy, 'GUEST'));
  iy += 30;
  parts.push(textBlock(guestLines, pad, iy, guestLH, `font-family="${SANS}" font-weight="700" font-size="40" fill="${t.ink}"`));
  iy += (guestLines.length - 1) * guestLH + 50;
  parts.push(
    label(pad, iy, 'TICKET ID'),
    label(colB, iy, 'TIER'),
  );
  iy += 30;
  parts.push(
    `<text x="${pad}" y="${iy}" font-family="${MONO}" font-weight="500" font-size="21" letter-spacing="1" fill="${t.ink}">${esc(d.ticketId)}</text>`,
    `<text x="${colB}" y="${iy}" font-family="${SANS}" font-weight="700" font-size="21" fill="${t.ink}">${esc(d.tier)}</text>`
  );

  // tear-off
  parts.push(tearOff(tearY2, W, pad - 14, t));

  // ── SECURITY / SCAN BLOCK ──
  const chipX = pad, chipY = qrTop;
  parts.push(
    `<rect x="${chipX}" y="${chipY}" width="${chip}" height="${chip}" rx="18" fill="${t.qrChip}"/>`,
    qrRects(d.qr, chipX + 20, chipY + 20, qrSize, '#0A0B10')
  );
  // scan copy to the right of the chip
  const sx = chipX + chip + 34;
  parts.push(
    label(sx, chipY + 34, 'SCAN AT THE DOOR'),
    `<text x="${sx}" y="${chipY + 74}" font-family="${SANS}" font-weight="700" font-size="26" fill="${t.ink}">One tap.</text>`,
    `<text x="${sx}" y="${chipY + 104}" font-family="${SANS}" font-weight="700" font-size="26" fill="${t.ink}">One entry.</text>`,
    `<text x="${sx}" y="${chipY + 150}" font-family="${MONO}" font-size="14" letter-spacing="1" fill="${t.mut}">${esc(d.ticketId)}</text>`,
    `<text x="${sx}" y="${chipY + 174}" font-family="${MONO}" font-size="12.5" letter-spacing="1.5" fill="${t.mut}">SINGLE USE · NON-TRANSFERABLE</text>`
  );

  // footer
  const fy = H - 46;
  parts.push(
    `<line x1="${pad}" y1="${fy - 30}" x2="${W - pad}" y2="${fy - 30}" stroke="${t.hair}" stroke-width="1.5"/>`,
    `<text x="${pad}" y="${fy}" font-family="${SANS}" font-weight="600" font-size="15" fill="${t.mut}">zora.com</text>`,
    `<text x="${W - pad}" y="${fy}" text-anchor="end" font-family="${MONO}" font-size="12.5" letter-spacing="1.5" fill="${t.mut}">THE TICKET IS THE PRODUCT</text>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">
  <defs>
    <linearGradient id="aura" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${AURA[0]}"/><stop offset="0.5" stop-color="${AURA[1]}"/><stop offset="1" stop-color="${AURA[2]}"/>
    </linearGradient>
  </defs>
  ${parts.join('\n  ')}
</svg>`;
}

/* ── rasterize to PNG ─────────────────────────────────────────── */
async function ticketPNG(data = {}, opts = {}) {
  const svg = ticketSVG(data, opts);
  const scale = opts.scale || 2;                 // 2x → crisp @ retina / print-ish
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 760 * scale },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
    background: 'transparent',
    shapeRendering: 2, textRendering: 2, imageRendering: 0,
  });
  return resvg.render().asPng();
}

module.exports = { ticketSVG, ticketPNG, THEMES };
