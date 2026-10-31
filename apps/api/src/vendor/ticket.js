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
  // BS130: an organizer-branded pass only when the caller hands a resolved
  // theme (flag zp_pass_design on). Without it the output is byte-identical
  // to the classic Zora pass below.
  if (opts.brand) return brandedTicketSVG(data, opts.brand);
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
    `<text x="${pad}" y="${fy}" font-family="${SANS}" font-weight="600" font-size="15" fill="${t.mut}">zorapass.com</text>`,
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

/* ── BS130: the organizer-branded pass (ZoraPass handoff §6 + DD4) ───────────
   A FIXED frame with organizer colour in three places only: the header band
   (artwork / accent), the event name and the seat line. The tear line, the QR
   block, the pass ID, the brightness hint and the ZoraPass mark never change.

   `brand` = {
     template: 'artwork_top' | 'classic_black' | 'full_colour',
     accent, accentOnBlack, bgColor,        // from @zora/core resolveTheme
     brandName, showFields: [...],
     artworkDataUri, logoDataUri, eventLogoDataUri, sponsorDataUris: [...]
   }  — images must already be data: URIs (an <img>-loaded SVG can't fetch). */
const ZP = { black: '#111111', bone: '#F7F5EE', mut: '#BDBDBD', rule: '#4A4A4A', strip: '#1C1C1C' };
const BSANS = "'Bricolage Grotesque','Space Grotesk','Segoe UI',Arial,sans-serif";
const HEXRE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const isHex = (v) => HEXRE.test(String(v || ''));

function hexLum(hex) {
  let h = String(hex).slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Same rule as core pickTextOn: bone or black at ≥4.5:1, else pure white/black.
function inkOn(bg) {
  if (!isHex(bg)) return ZP.bone;
  const l = hexLum(bg);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const black = ratio(l, hexLum(ZP.black));
  const bone = ratio(l, hexLum(ZP.bone));
  if (Math.max(black, bone) >= 4.5) return black >= bone ? ZP.black : ZP.bone;
  return ratio(l, 0) >= ratio(l, 1) ? '#000000' : '#FFFFFF';
}

function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter((x) => /[A-Za-z0-9]/.test(x));
  if (!w.length) return '';
  const ws = w.length > 1 && /^the$/i.test(w[0]) ? w.slice(1) : w;
  return (ws.length > 1 ? ws[0][0] + ws[1][0] : ws[0].slice(0, 2)).toUpperCase();
}

function brandedTicketSVG(data = {}, brand = {}) {
  const W = 760, R = 32, pad = 36;
  const innerW = W - pad * 2;
  const template = ['artwork_top', 'classic_black', 'full_colour'].includes(brand.template) ? brand.template : 'artwork_top';
  const accent = isHex(brand.accent) ? brand.accent : '#FFD21F';
  const show = new Set(Array.isArray(brand.showFields) ? brand.showFields : ['guest_name', 'seat', 'pass_type']);
  const fill = template === 'classic_black' ? ZP.black : (isHex(brand.bgColor) ? brand.bgColor : accent);
  const fillInk = inkOn(fill);
  // body: black for artwork_top / classic_black, the brand fill for full_colour
  const full = template === 'full_colour';
  const bodyBg = full ? fill : ZP.black;
  const bodyInk = full ? fillInk : ZP.bone;
  const bodyMut = full ? fillInk : ZP.mut;
  const brandInk = full ? fillInk : (isHex(brand.accentOnBlack) ? brand.accentOnBlack : accent);

  const d = {
    event: data.event || 'Untitled Event',
    dateLabel: data.dateLabel || 'Date TBA',
    venue: data.venue || 'Venue TBA',
    guest: data.guest || '',
    ticketId: data.ticketId || 'ZORA-0000-0000',
    tier: data.tier || '',
    seat: data.seat || (data.tableNo && data.tableNo !== '—' ? data.tableNo : ''),
    dressCode: data.dressCode || '',
    qr: data.qr || `zora://t/${data.ticketId || 'ZORA-0000-0000'}`,
  };

  const parts = [];
  const defs = [];
  const bandH = 300;

  // ── header band (organizer zone 1) ──
  parts.push(`<rect x="0" y="0" width="${W}" height="${bandH}" fill="${fill}"/>`);
  if (template !== 'classic_black' && brand.artworkDataUri) {
    defs.push(`<clipPath id="band"><rect x="0" y="0" width="${W}" height="${bandH}"/></clipPath>`);
    parts.push(`<image x="0" y="0" width="${W}" height="${bandH}" href="${esc(brand.artworkDataUri)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#band)"/>`);
  }
  if (template === 'classic_black') {
    parts.push(`<rect x="${pad}" y="${bandH - 8}" width="${innerW}" height="6" rx="3" fill="${accent}"/>`);
  }
  // organizer logo chip (top-right): the logo image, else the brand initials
  const chipS = 88, chipX = W - pad - chipS, chipY = 24;
  const logo = brand.eventLogoDataUri || brand.logoDataUri;
  if (logo) {
    defs.push(`<clipPath id="chip"><rect x="${chipX}" y="${chipY}" width="${chipS}" height="${chipS}" rx="20"/></clipPath>`);
    parts.push(
      `<rect x="${chipX}" y="${chipY}" width="${chipS}" height="${chipS}" rx="20" fill="${ZP.black}"/>`,
      `<image x="${chipX}" y="${chipY}" width="${chipS}" height="${chipS}" href="${esc(logo)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#chip)"/>`
    );
  } else if (initials(brand.brandName)) {
    const chipBg = template === 'classic_black' ? accent : ZP.black;
    const chipInk = template === 'classic_black' ? inkOn(accent) : (isHex(fill) && hexLum(fill) > 0.05 ? fill : ZP.bone);
    parts.push(
      `<rect x="${chipX}" y="${chipY}" width="${chipS}" height="${chipS}" rx="20" fill="${chipBg}"/>`,
      `<text x="${chipX + chipS / 2}" y="${chipY + chipS / 2 + 11}" text-anchor="middle" font-family="${BSANS}" font-weight="800" font-size="32" fill="${chipInk}">${esc(initials(brand.brandName))}</text>`
    );
  }
  // kind pill (bottom-left of the band): "<TIER> · ADMIT 1"
  if (show.has('pass_type') && d.tier) {
    const kind = `${d.tier.toUpperCase()} · ADMIT 1`;
    const pw = Math.min(innerW, Math.round(kind.length * 16.4 + 40));
    const pillBg = template === 'classic_black' ? accent : ZP.bone;
    const pillInk = template === 'classic_black' ? inkOn(accent) : ZP.black;
    parts.push(
      `<rect x="${pad}" y="${bandH - 80}" width="${pw}" height="50" rx="25" fill="${pillBg}"/>`,
      `<text x="${pad + 20}" y="${bandH - 47}" font-family="${MONO}" font-size="23" letter-spacing="2.6" fill="${pillInk}">${esc(kind)}</text>`
    );
  }

  // ── info block (organizer zones 2 + 3: event name, seat line) ──
  const infoTop = bandH;
  const nameLines = wrap(d.event, budget(innerW, 52, true), 3);
  const nameLH = 56;
  const rows = [['DATE', d.dateLabel, false], ['VENUE', d.venue, false]];
  if (show.has('seat') && d.seat) rows.push(['SEAT', String(d.seat).toUpperCase(), true]);
  if (show.has('guest_name') && d.guest) rows.push(['NAME', d.guest, false]);
  if (show.has('dress_code') && d.dressCode) rows.push(['DRESS', d.dressCode, false]);
  const rowLH = 46;
  const infoH = 32 + 44 + (nameLines.length - 1) * nameLH + 12 + rows.length * rowLH + 28;
  parts.push(`<rect x="0" y="${infoTop}" width="${W}" height="${infoH}" fill="${bodyBg}"/>`);
  let y = infoTop + 32 + 44;
  parts.push(textBlock(nameLines, pad, y, nameLH, `font-family="${BSANS}" font-weight="800" font-size="52" letter-spacing="-1" fill="${brandInk}"`));
  y += (nameLines.length - 1) * nameLH + 12;
  const valX = pad + 148;
  for (const [lab, val, isSeat] of rows) {
    y += rowLH;
    parts.push(
      `<text x="${pad}" y="${y}" font-family="${MONO}" font-size="23" letter-spacing="1.8" fill="${bodyMut}">${esc(lab)}</text>`,
      `<text x="${valX}" y="${y}" font-family="${MONO}" font-size="28" ${isSeat ? 'font-weight="600" ' : ''}fill="${isSeat ? brandInk : bodyInk}">${esc(wrap(val, budget(W - pad - valX, 28, false), 1)[0])}</text>`
    );
  }
  y = infoTop + infoH;

  // ── FIXED: tear line (2px dashed @1x, 16px notches cut into both edges) ──
  const tearH = 32, tearY = y + tearH / 2;
  parts.push(
    `<rect x="0" y="${y}" width="${W}" height="${tearH}" fill="${ZP.black}"/>`,
    `<line x1="${pad - 6}" y1="${tearY}" x2="${W - pad + 6}" y2="${tearY}" stroke="${ZP.rule}" stroke-width="4" stroke-dasharray="12 8"/>`
  );
  y += tearH;

  // ── FIXED: QR block (white card, 16px padding @1x, mono pass id, hint) ──
  const qrCard = 432, qrPad = 32, qrTop = y + 24;
  const qrX = (W - qrCard) / 2;
  const qrBlockH = 24 + qrCard + 136;
  parts.push(
    `<rect x="0" y="${y}" width="${W}" height="${qrBlockH}" fill="${ZP.black}"/>`,
    `<rect x="${qrX}" y="${qrTop}" width="${qrCard}" height="${qrCard}" rx="24" fill="#FFFFFF"/>`,
    qrRects(d.qr, qrX + qrPad, qrTop + qrPad, qrCard - qrPad * 2, ZP.black),
    `<text x="${W / 2}" y="${qrTop + qrCard + 52}" text-anchor="middle" font-family="${MONO}" font-size="30" letter-spacing="2.4" fill="${ZP.bone}">${esc(d.ticketId)}</text>`,
    `<text x="${W / 2}" y="${qrTop + qrCard + 98}" text-anchor="middle" font-family="${BSANS}" font-size="26" fill="${ZP.mut}">Turn your brightness up</text>`
  );
  y += qrBlockH;

  // ── sponsor strip + FIXED ZoraPass mark ──
  const stripH = 84;
  parts.push(`<rect x="0" y="${y}" width="${W}" height="${stripH}" fill="${ZP.strip}"/>`);
  const sponsors = (Array.isArray(brand.sponsorDataUris) ? brand.sponsorDataUris : []).filter(Boolean).slice(0, 4);
  if (sponsors.length) {
    parts.push(`<text x="${pad}" y="${y + 50}" font-family="${MONO}" font-size="20" letter-spacing="2.4" fill="${ZP.mut}">WITH</text>`);
    sponsors.forEach((uri, i) => {
      parts.push(`<image x="${pad + 80 + i * 116}" y="${y + 18}" width="104" height="48" href="${esc(uri)}" preserveAspectRatio="xMidYMid meet"/>`);
    });
  }
  parts.push(`<text x="${W - pad}" y="${y + 52}" text-anchor="end" font-family="${BSANS}" font-weight="700" font-size="28" letter-spacing="-1" fill="${ZP.bone}">ZoraPass</text>`);
  y += stripH;

  const H = y;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${BSANS}" data-pass="branded" data-template="${template}">
  <defs>
    <mask id="notch"><rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/><circle cx="0" cy="${tearY}" r="16" fill="#000000"/><circle cx="${W}" cy="${tearY}" r="16" fill="#000000"/></mask>
    <clipPath id="card"><rect x="0" y="0" width="${W}" height="${H}" rx="${R}"/></clipPath>
    ${defs.join('\n    ')}
  </defs>
  <g clip-path="url(#card)"><g mask="url(#notch)">
  ${parts.join('\n  ')}
  </g></g>
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

module.exports = { ticketSVG, ticketPNG, brandedTicketSVG, THEMES };
