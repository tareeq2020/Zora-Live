'use client';

/* Wordmark — the React home for the wordmark half of the legacy
   public/zora-theme.js `swapWordmarks()`, which replaced the text of every
   `.wordmark` / `.brand` with the real ZORA logo <img>, choosing the asset by
   theme (white letters on dark, black on light) and preserving any trailing
   <small> sublabel. This renders that post-swap DOM directly:
     <a class="wordmark" ...><img class="zora-logo" .../>[ <small>…</small>]</a>
   The .wordmark img.zora-logo rule in zora-tokens.css sizes it identically. */

import { useTheme } from './theme-provider';

const WHITE = '/assets/zora-wordmark-white.png'; // dark theme
const BLACK = '/assets/zora-wordmark-black.png'; // light theme

export function Wordmark({
  href,
  className = 'wordmark',
  small,
}: {
  href: string;
  className?: string;
  small?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const src = theme === 'light' ? BLACK : WHITE;
  return (
    <a href={href} className={className}>
      <img className="zora-logo" src={src} alt="ZORA" draggable={false} />
      {small ? <> <small>{small}</small></> : null}
    </a>
  );
}
