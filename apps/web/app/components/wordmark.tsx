/* Wordmark — the React home for the wordmark half of the legacy
   public/zora-theme.js `swapWordmarks()`, which replaced the text of every
   `.wordmark` / `.brand` with the real ZORA logo <img>, choosing the asset by
   theme (white letters on dark, black on light) and preserving any trailing
   <small> sublabel. This renders that post-swap DOM directly:
     <a class="wordmark" ...><img class="zora-logo" .../>[ <small>…</small>]</a>

   F1 follow-up: the theme choice is driven by CSS off <html data-theme>, not a
   useTheme() mount effect — both assets are rendered and zora-tokens.css shows
   exactly one. That keeps <Wordmark> a plain (server-renderable) component with
   no hydration flash, matching the no-flash boot that sets data-theme pre-paint.
   The .wordmark img.zora-logo rule in zora-tokens.css sizes it identically. */

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
  return (
    <a href={href} className={className}>
      <img className="zora-logo zora-logo-dark" src={WHITE} alt="ZORA" draggable={false} />
      <img className="zora-logo zora-logo-light" src={BLACK} alt="ZORA" draggable={false} />
      {small ? <> <small>{small}</small></> : null}
    </a>
  );
}
