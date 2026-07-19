'use client';

/* RevealImg — reproduces the inline onload/onerror the static marketing pages
   put on every .ph media <img>:
     onload="this.classList.add('loaded')"   → fade the real asset in (.ph img is
                                                opacity:0 until .loaded)
     onerror="this.remove()"                  → drop the broken img, leaving the
                                                .ph gradient placeholder
   DOM event handlers force a client component, so this small island wraps <img>
   and lets otherwise-static server pages keep the reveal behaviour. */

import type { ImgHTMLAttributes } from 'react';

export function RevealImg(props: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      {...props}
      onLoad={(e) => e.currentTarget.classList.add('loaded')}
      onError={(e) => e.currentTarget.remove()}
    />
  );
}
