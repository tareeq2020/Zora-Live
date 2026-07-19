/* PR-10: printable ticket PDF (pure @zora/core, no HTTP/Nest).
   Renders one page-block per ticket: the QR (when supplied) plus the human
   `publicRef`, tier, and event name. Either the QR or the readable ref admits
   the holder at the gate, so a missing QR degrades gracefully.

   pdf-lib's StandardFonts/Helvetica is WinAnsi-only and THROWS on any glyph it
   cannot encode. Event names and tiers are user-authored (emoji, Swahili
   diacritics, smart quotes are all plausible), so every string is sanitised to
   the WinAnsi-safe subset BEFORE drawing — buildTicketsPdf must never throw on
   exotic text. */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFImage } from 'pdf-lib';

export interface TicketForPdf {
  publicRef: string;
  tier: string;
  eventName: string;
  qrPng?: Buffer | null;
}

/** Map/strip characters Helvetica (WinAnsi) cannot encode so drawText never
    throws. A few common typographic glyphs get ASCII fallbacks; anything else
    outside the printable Latin-1 range becomes '?'. */
function winAnsiSafe(input: string): string {
  const replacements: Record<string, string> = {
    '‘': "'", '’': "'", '“': '"', '”': '"',
    '–': '-', '—': '-', '…': '...', '•': '-',
    ' ': ' ',
  };
  let out = '';
  for (const ch of String(input ?? '')) {
    if (replacements[ch] !== undefined) { out += replacements[ch]; continue; }
    const cp = ch.codePointAt(0) ?? 0;
    // Printable ASCII + Latin-1 supplement that WinAnsi covers.
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0xff)) { out += ch; continue; }
    if (cp === 0x0a || cp === 0x09) { out += ' '; continue; }
    out += '?';
  }
  return out;
}

/** Truncate a sanitised string to fit a max width at the given size. */
function fit(font: PDFFont, text: string, size: number, maxWidth: number): string {
  let t = text;
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  const ell = '...';
  while (t.length > 0 && font.widthOfTextAtSize(t + ell, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + ell;
}

/** Build a multi-ticket PDF. Never throws on exotic text; a missing/undecodable
    QR simply omits the image and relies on the printed public_ref. */
export async function buildTicketsPdf(tickets: TicketForPdf[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle('ZORA Tickets');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const list = Array.isArray(tickets) && tickets.length > 0 ? tickets : [];
  // Always emit at least one page so the result is a valid, openable PDF.
  const pages = list.length > 0 ? list : [null];

  for (const ticket of pages) {
    const page = doc.addPage([420, 595]); // A5-ish portrait
    const { width, height } = page.getSize();
    const margin = 40;
    const ink = rgb(0.06, 0.06, 0.08);
    const muted = rgb(0.4, 0.4, 0.45);

    // Header band
    page.drawText('ZORA', { x: margin, y: height - margin - 10, size: 22, font: bold, color: ink });
    page.drawText('ADMIT ONE', { x: width - margin - bold.widthOfTextAtSize('ADMIT ONE', 10), y: height - margin - 6, size: 10, font: bold, color: muted });
    page.drawLine({ start: { x: margin, y: height - margin - 22 }, end: { x: width - margin, y: height - margin - 22 }, thickness: 1, color: muted });

    if (ticket) {
      let qrImage: PDFImage | null = null;
      if (ticket.qrPng && ticket.qrPng.length > 0) {
        try {
          qrImage = await doc.embedPng(ticket.qrPng);
        } catch {
          qrImage = null; // corrupt/undecodable QR must not block the PDF
        }
      }

      let cursorY = height - margin - 60;
      if (qrImage) {
        const qrSize = 200;
        page.drawImage(qrImage, { x: (width - qrSize) / 2, y: cursorY - qrSize, width: qrSize, height: qrSize });
        cursorY -= qrSize + 30;
      } else {
        cursorY -= 10;
      }

      const contentW = width - margin * 2;
      const eventName = fit(bold, winAnsiSafe(ticket.eventName), 16, contentW);
      page.drawText(eventName, { x: margin, y: cursorY, size: 16, font: bold, color: ink });
      cursorY -= 26;

      page.drawText('TIER', { x: margin, y: cursorY, size: 9, font: bold, color: muted });
      page.drawText(fit(font, winAnsiSafe(ticket.tier), 13, contentW), { x: margin, y: cursorY - 16, size: 13, font, color: ink });
      cursorY -= 46;

      page.drawText('REFERENCE (show this at the gate)', { x: margin, y: cursorY, size: 9, font: bold, color: muted });
      page.drawText(fit(bold, winAnsiSafe(ticket.publicRef), 18, contentW), { x: margin, y: cursorY - 22, size: 18, font: bold, color: ink });
    } else {
      page.drawText('No tickets on this order.', { x: margin, y: height / 2, size: 12, font, color: muted });
    }

    page.drawText('Present the QR code or read out your reference. Either works.', {
      x: margin, y: margin, size: 8, font, color: muted,
    });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
