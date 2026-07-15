import type { ReactNode } from 'react';

// Minimal root layout — real pages are the lift-and-shifted static HTML in public/.
// This exists only so the App Router is valid; it renders nothing of its own.
export const metadata = { title: 'ZORA' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
