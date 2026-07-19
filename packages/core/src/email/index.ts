/* PR-10: email delivery + the credential (ticket) email (pure @zora/core).
   Driver is `resend` when RESEND_API_KEY is present, else `mock`; EMAIL_DRIVER=mock
   forces the mock even if a key is set (safe for local/CI).

   Same misconfig philosophy as SMS: the mock never throws and logs to the
   dev-log. sendCredentialEmail additionally guarantees RENDER-FAILURE ISOLATION
   — if the ticket PDF build throws, the email still goes out (attachment simply
   omitted); if a per-ticket QR is missing, the readable public_ref carries the
   holder through the gate. */
import { buildTicketsPdf, TicketForPdf } from '../credentials/ticket-pdf';

export type EmailDriver = 'resend' | 'mock';

export interface EmailAttachment {
  filename: string;
  /** Raw bytes; serialised to base64 for the provider. */
  content: Buffer;
  /** When set, the attachment is referenced inline via cid: in the HTML. */
  content_id?: string;
}

export interface EmailResult {
  delivered: boolean;
  dev: boolean;
}

function resolveDriver(env: NodeJS.ProcessEnv): EmailDriver {
  if ((env.EMAIL_DRIVER ?? '').trim().toLowerCase() === 'mock') return 'mock';
  return env.RESEND_API_KEY && env.RESEND_API_KEY.trim() ? 'resend' : 'mock';
}

/** Escape user-authored text for safe interpolation into HTML. */
export function escapeHtml(input: string): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Send an email via the configured driver. The mock never throws; a genuine
    Resend rejection (key present) throws so the caller can react. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments: EmailAttachment[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<EmailResult> {
  const driver = resolveDriver(env);

  if (driver === 'mock') {
    console.log(`[email:mock] to=${to} subject=${JSON.stringify(subject)} attachments=${attachments.length}`);
    return { delivered: false, dev: true };
  }

  const from = env.EMAIL_FROM;
  if (!from) {
    // Real driver selected but no From — loud misconfig, dev-log, no throw.
    console.warn('[email:UNCONFIGURED] driver=resend but EMAIL_FROM missing — dev-log only, not sent');
    console.log(`[email:dev] to=${to} subject=${JSON.stringify(subject)}`);
    return { delivered: false, dev: true };
  }

  const body: Record<string, unknown> = {
    from,
    to,
    subject,
    html,
  };
  if (attachments.length > 0) {
    body.attachments = attachments.map((a) => {
      const att: Record<string, unknown> = {
        filename: a.filename,
        content: a.content.toString('base64'),
      };
      if (a.content_id) att.content_id = a.content_id;
      return att;
    });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[email:resend] send failed ${res.status}: ${text.slice(0, 300)}`);
  }
  return { delivered: true, dev: false };
}

export interface CredentialTicket {
  publicRef: string;
  tier: string;
  qrPng?: Buffer | null;
}

export interface CredentialEmailData {
  buyerName: string;
  eventName: string;
  tickets: CredentialTicket[];
}

/** Send the buyer their ticket(s): one HTML block per ticket with the QR inline
    (CID qr-<publicRef>) plus the readable ref (either admits at the gate), and
    the printable PDF attached. Render failures NEVER block the send. */
export async function sendCredentialEmail(
  to: string,
  data: CredentialEmailData,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EmailResult> {
  const buyerName = escapeHtml(data.buyerName);
  const eventName = escapeHtml(data.eventName);
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];

  const attachments: EmailAttachment[] = [];

  const blocks = tickets.map((t) => {
    const ref = escapeHtml(t.publicRef);
    const tier = escapeHtml(t.tier);
    let qrHtml = '';
    if (t.qrPng && t.qrPng.length > 0) {
      const cid = `qr-${t.publicRef}`;
      attachments.push({ filename: `${t.publicRef}.png`, content: t.qrPng, content_id: cid });
      qrHtml = `<img src="cid:${escapeHtml(cid)}" alt="QR for ${ref}" width="200" height="200" style="display:block;border:0;" />`;
    }
    return `
      <table role="presentation" width="100%" style="margin:0 0 24px;border:1px solid #e5e5ea;border-radius:12px;">
        <tr><td style="padding:20px;">
          <div style="font-size:16px;font-weight:700;color:#0f0f14;">${eventName}</div>
          <div style="font-size:13px;color:#6a6a72;margin:2px 0 14px;">${tier}</div>
          ${qrHtml}
          <div style="font-size:11px;color:#6a6a72;margin:14px 0 2px;text-transform:uppercase;letter-spacing:.05em;">Reference (show this at the gate)</div>
          <div style="font-size:20px;font-weight:700;letter-spacing:.04em;color:#0f0f14;">${ref}</div>
        </td></tr>
      </table>`;
  }).join('');

  const html = `<!doctype html>
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f0f14;">
  <div style="font-size:22px;font-weight:800;letter-spacing:.1em;">ZORA</div>
  <p style="font-size:15px;line-height:1.5;">Hi ${buyerName}, your ${tickets.length === 1 ? 'ticket is' : 'tickets are'} ready. Present the QR code or read out your reference at the gate — either works.</p>
  ${blocks}
  <p style="font-size:12px;color:#6a6a72;">A printable PDF of your ${tickets.length === 1 ? 'ticket' : 'tickets'} is attached.</p>
</div>`;

  // RENDER-FAILURE ISOLATION: never let a PDF build error block delivery.
  try {
    const pdfTickets: TicketForPdf[] = tickets.map((t) => ({
      publicRef: t.publicRef,
      tier: t.tier,
      eventName: data.eventName,
      qrPng: t.qrPng ?? null,
    }));
    const pdf = await buildTicketsPdf(pdfTickets);
    attachments.push({ filename: 'zora-tickets.pdf', content: pdf });
  } catch (err) {
    console.warn(`[email] ticket PDF build failed, sending without attachment: ${(err as Error)?.message ?? err}`);
  }

  const subject = `Your ZORA ${tickets.length === 1 ? 'ticket' : 'tickets'} — ${data.eventName}`;
  return sendEmail(to, subject, html, attachments, env);
}
