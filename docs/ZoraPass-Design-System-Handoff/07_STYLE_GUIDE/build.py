#!/usr/bin/env python3
"""Inline the stamp SVGs and a QR placeholder into _page.html.

Writes:
  index.html      standalone file — open it in any browser
  _artifact.html  the same page without the html/head/body wrapper (for publishing)
"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', '06_ASSETS')
src = open(os.path.join(HERE, '_page.html')).read()


def stamp(name):
    for folder in ('stamps/svg', 'stamps-campaign-only'):
        p = os.path.join(ASSETS, folder, f'zp-stamp-{name}.svg')
        if os.path.exists(p):
            svg = open(p).read()
            svg = re.sub(r'\s(width|height)="\d+"', '', svg, count=2)
            return svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" aria-hidden="true" ')
    raise SystemExit('missing stamp: ' + name)


def qr(size=21, cell=6, seed=7):
    """A deterministic QR-shaped placeholder. Replace with a real code in production."""
    p = []
    def rect(x, y, w, h, fill):
        p.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"/>')
    n = size * cell
    rect(0, 0, n, n, '#FFFFFF')
    for (a, b) in ((0, 0), (14, 0), (0, 14)):
        rect(a * cell, b * cell, 7 * cell, 7 * cell, '#111111')
        rect((a + 1) * cell, (b + 1) * cell, 5 * cell, 5 * cell, '#FFFFFF')
        rect((a + 2) * cell, (b + 2) * cell, 3 * cell, 3 * cell, '#111111')
    s = seed
    for i in range(size):
        for j in range(size):
            if (i < 8 and j < 8) or (i > 12 and j < 8) or (i < 8 and j > 12):
                continue
            s = (s * 16807) % 2147483647
            if s % 3 == 0:
                rect(i * cell, j * cell, cell, cell, '#111111')
    return (f'<svg viewBox="0 0 {n} {n}" width="100%" role="img" aria-label="Pass QR code placeholder">'
            + ''.join(p) + '</svg>')


out = re.sub(r'<!--STAMP:([a-z0-9\-]+)-->', lambda m: stamp(m.group(1)), src)
out = out.replace('<!--QR-->', qr())

open(os.path.join(HERE, '_artifact.html'), 'w').write(out)

standalone = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
              '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
              + out.split('<header class="hero">')[0] +
              '</head>\n<body>\n<header class="hero">'
              + out.split('<header class="hero">', 1)[1] +
              '\n</body>\n</html>\n')
open(os.path.join(HERE, 'index.html'), 'w').write(standalone)
print('index.html', len(standalone), 'bytes · _artifact.html', len(out), 'bytes')
