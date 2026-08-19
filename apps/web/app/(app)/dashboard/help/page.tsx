import type { Metadata } from 'next';
import HelpCr from './help-cr';

/* PR-BS77 — the organizer HELP & SUPPORT screen at /dashboard/help. The
   /dashboard/* prefix is already organizer-gated in middleware.ts, so this route
   inherits that gate — no auth work here. HelpCr renders inside the shared
   Control-Room v2 <CrShell> (nav + topbar + theme), so this stays a thin shell. */

export const metadata: Metadata = {
  title: 'Help & Support — ZORA Dashboard',
  description: 'Answers for organizers, and a direct line to Zora support.',
  robots: { index: false, follow: false },
};

export default function HelpPage() {
  return <HelpCr />;
}
