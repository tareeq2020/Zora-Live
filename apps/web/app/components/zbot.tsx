'use client';

/* ZBot — the bottom-right help launcher. BS47: was a scripted "Zora Assist" bot
   that claimed "Online · replies instantly", which read as a live chat that
   didn't actually exist. Replaced with a direct WhatsApp link — honest about
   what it is, no canned-FAQ facade. Keeps the exported name and the `.zbot`/
   `.zbot-fab` classes (styled per host page) so no caller needs to change; the
   ref/open() API is gone since there's no panel left to open. */

import { forwardRef } from 'react';
import { WHATSAPP_HREF } from '@zora/core/contacts';

export type ZBotHandle = { open: () => void };

export const ZBot = forwardRef<ZBotHandle>(function ZBot(_props, _ref) {
  return (
    <div className="zbot" id="zbot">
      <a className="zbot-fab" id="zbot-fab" href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        WhatsApp
      </a>
    </div>
  );
});
