#!/usr/bin/env python3
"""Generate every token file in this folder from tokens.json.

Usage:  python3 build-tokens.py
tokens.json is the single source of truth. Edit it, re-run this, commit the output.
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, 'tokens.json')))
HEAD = "/* ZoraPass design tokens v%s — generated from tokens.json. Do not edit by hand. */" % T['meta']['version']


def flat(prefix, obj, out):
    for k, v in obj.items():
        key = f'{prefix}-{k}' if prefix else k
        if isinstance(v, dict):
            flat(key, v, out)
        else:
            out[key] = v
    return out


def kebab(s):
    return re.sub(r'[^a-z0-9]+', '-', str(s).lower()).strip('-')


def camel(s):
    parts = re.split(r'[^a-zA-Z0-9]+', str(s))
    return parts[0].lower() + ''.join(p.capitalize() for p in parts[1:])


def pascal(s):
    return ''.join(p.capitalize() for p in re.split(r'[^a-zA-Z0-9]+', str(s)))


def scale_vars():
    """Everything except the light/dark semantic sets and the status map."""
    out = {}
    flat('color', T['color']['primitive'], out)
    for group in ('font', 'space', 'radius', 'border', 'shadow', 'size', 'layout', 'motion', 'z', 'opacity'):
        flat(group, T[group], out)
    return {k: v for k, v in out.items() if not isinstance(v, (dict, list))}


# ---------- CSS ----------
def css():
    L = [HEAD, '', ':root {']
    for k, v in scale_vars().items():
        L.append(f'  --zp-{k}: {v};')
    L.append('')
    L.append('  /* semantic — light (default) */')
    for k, v in T['color']['semantic']['light'].items():
        L.append(f'  --zp-{k}: {v};')
    L.append('}')
    L.append('')
    L.append('[data-theme="dark"], .zp-dark {')
    for k, v in T['color']['semantic']['dark'].items():
        L.append(f'  --zp-{k}: {v};')
    L.append('}')
    L.append('')
    L.append('@media (prefers-color-scheme: dark) {')
    L.append('  :root:not([data-theme="light"]) {')
    for k, v in T['color']['semantic']['dark'].items():
        L.append(f'    --zp-{k}: {v};')
    L.append('  }')
    L.append('}')
    L.append('')
    L.append('/* status chips */')
    for name, c in T['color']['status'].items():
        L.append(f'.zp-chip--{name} {{ background: {c["bg"]}; color: {c["fg"]};'
                 + (f' border: 2px solid {c["border"]};' if c.get('border') else ' border: 2px solid transparent;')
                 + (' text-decoration: line-through;' if c.get('strikethrough') else '') + ' }')
    return '\n'.join(L) + '\n'


# ---------- SCSS ----------
def scss():
    L = [HEAD.replace('/*', '//').replace('*/', ''), '']
    for k, v in scale_vars().items():
        L.append(f'$zp-{k}: {v};')
    L.append('')
    for theme in ('light', 'dark'):
        for k, v in T['color']['semantic'][theme].items():
            L.append(f'$zp-{theme}-{k}: {v};')
        L.append('')
    return '\n'.join(L) + '\n'


# ---------- Tailwind ----------
def tailwind():
    def fam(v):
        return ', '.join('"%s"' % p.strip().strip("'") for p in v.split(','))
    c = T['color']['primitive']
    s = T['space']
    r = T['radius']
    f = T['font']
    return f"""// ZoraPass Tailwind preset v{T['meta']['version']} — generated from tokens.json.
// tailwind.config.js:  module.exports = {{ presets: [require('./tailwind.zorapass.js')], content: [...] }}
module.exports = {{
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {{
    extend: {{
      colors: {{
        signal: '{c['signal-yellow']}',
        board: '{c['board-black']}',
        bone: '{c['bone']}',
        night: '{c['night']}',
        mtaa: '{c['mtaa-green']}',
        bahari: '{c['bahari-blue']}',
        alert: '{c['alert-red']}',
        ink: {{ 900: '{c['ink-900']}', 800: '{c['ink-800']}', 700: '{c['ink-700']}', 600: '{c['ink-600']}', 500: '{c['ink-500']}', 300: '{c['ink-300']}' }},
        line: {{ light: '{c['line-light']}', dark: '{c['line-dark']}' }},
        // semantic (driven by the CSS variables in zorapass.css)
        surface: 'var(--zp-surface)',
        'surface-raised': 'var(--zp-surface-raised)',
        'text-primary': 'var(--zp-text-primary)',
        'text-secondary': 'var(--zp-text-secondary)',
        border: 'var(--zp-border)',
      }},
      fontFamily: {{
        display: [{fam(f['family']['display'])}],
        sans: [{fam(f['family']['sans'])}],
        mono: [{fam(f['family']['mono'])}],
      }},
      fontSize: {{
{chr(10).join(f"        '{k}': '{v}'," for k, v in f['size'].items())}
      }},
      letterSpacing: {{
{chr(10).join(f"        '{k}': '{v}'," for k, v in f['letter-spacing'].items())}
      }},
      lineHeight: {{
{chr(10).join(f"        '{k}': '{v}'," for k, v in f['line-height'].items())}
      }},
      spacing: {{
{chr(10).join(f"        '{k}': '{v}'," for k, v in s.items())}
      }},
      borderRadius: {{
{chr(10).join(f"        '{k}': '{v}'," for k, v in r.items())}
      }},
      screens: {{
{chr(10).join(f"        '{k}': '{v}'," for k, v in T['layout']['breakpoint'].items())}
      }},
      maxWidth: {{ container: '{T['layout']['container-max']}' }},
      transitionTimingFunction: {{
{chr(10).join(f"        '{k}': '{v}'," for k, v in T['motion']['easing'].items())}
      }},
      transitionDuration: {{
{chr(10).join(f"        '{k}': '{v.replace('ms','')}'," for k, v in T['motion']['duration'].items())}
      }},
    }},
  }},
}};
"""


# ---------- JS / TS (React Native, plain JS) ----------
def js():
    obj = {
        'color': {'primitive': T['color']['primitive'], 'light': T['color']['semantic']['light'],
                  'dark': T['color']['semantic']['dark'], 'status': T['color']['status']},
        'font': T['font'], 'space': T['space'], 'radius': T['radius'], 'size': T['size'],
        'layout': T['layout'], 'motion': T['motion'], 'z': T['z'], 'opacity': T['opacity'],
    }
    return (f"// ZoraPass design tokens v{T['meta']['version']} — generated from tokens.json.\n"
            f"export const tokens = {json.dumps(obj, indent=2)};\n\nexport default tokens;\n")


# ---------- Dart (Flutter) ----------
def dart():
    def col(hexv):
        h = hexv.lstrip('#')
        return f'Color(0xFF{h.upper()})'
    L = [f"// ZoraPass design tokens v{T['meta']['version']} — generated from tokens.json.",
         "import 'package:flutter/material.dart';", '', 'class ZpColors {']
    for k, v in T['color']['primitive'].items():
        L.append(f'  static const {camel(k)} = {col(v)};')
    L.append('}')
    L.append('')
    for theme in ('light', 'dark'):
        L.append(f'class ZpColors{theme.capitalize()} {{')
        for k, v in T['color']['semantic'][theme].items():
            if v.startswith('rgba'):
                continue
            L.append(f'  static const {camel(k)} = {col(v)};')
        L.append('}')
        L.append('')
    L.append('class ZpSpace {')
    for k, v in T['space'].items():
        L.append(f'  static const s{k} = {v.replace("px", "")}.0;')
    L.append('}')
    L.append('')
    L.append('class ZpRadius {')
    for k, v in T['radius'].items():
        L.append(f'  static const {camel(k)} = {v.replace("px", "")}.0;')
    L.append('}')
    L.append('')
    L.append('class ZpType {')
    L.append("  static const display = 'Bungee';")
    L.append("  static const sans = 'BricolageGrotesque';")
    L.append("  static const mono = 'IBMPlexMono';")
    for k, v in T['font']['size'].items():
        L.append(f'  static const size{pascal(k)} = {v.replace("px", "")}.0;')
    L.append('}')
    return '\n'.join(L) + '\n'


# ---------- Swift ----------
def swift():
    def col(hexv):
        h = hexv.lstrip('#')
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        return f'Color(red: {r:.3f}, green: {g:.3f}, blue: {b:.3f})'
    L = [f"// ZoraPass design tokens v{T['meta']['version']} — generated from tokens.json.",
         'import SwiftUI', '', 'public enum ZPColor {']
    for k, v in T['color']['primitive'].items():
        L.append(f'    public static let {camel(k)} = {col(v)}')
    L.append('}')
    L.append('')
    for theme in ('light', 'dark'):
        L.append(f'public enum ZPColor{theme.capitalize()} {{')
        for k, v in T['color']['semantic'][theme].items():
            if v.startswith('rgba'):
                continue
            L.append(f'    public static let {camel(k)} = {col(v)}')
        L.append('}')
        L.append('')
    L.append('public enum ZPSpace {')
    for k, v in T['space'].items():
        L.append(f'    public static let s{k}: CGFloat = {v.replace("px", "")}')
    L.append('}')
    L.append('')
    L.append('public enum ZPRadius {')
    for k, v in T['radius'].items():
        L.append(f'    public static let {camel(k)}: CGFloat = {v.replace("px", "")}')
    L.append('}')
    return '\n'.join(L) + '\n'


# ---------- Kotlin ----------
def kotlin():
    def col(hexv):
        return f'Color(0xFF{hexv.lstrip("#").upper()})'
    L = [f"// ZoraPass design tokens v{T['meta']['version']} — generated from tokens.json.",
         'package com.zorapass.design', '',
         'import androidx.compose.ui.graphics.Color',
         'import androidx.compose.ui.unit.dp', '', 'object ZpColor {']
    for k, v in T['color']['primitive'].items():
        L.append(f'    val {camel(k)} = {col(v)}')
    L.append('}')
    L.append('')
    for theme in ('light', 'dark'):
        L.append(f'object ZpColor{theme.capitalize()} {{')
        for k, v in T['color']['semantic'][theme].items():
            if v.startswith('rgba'):
                continue
            L.append(f'    val {camel(k)} = {col(v)}')
        L.append('}')
        L.append('')
    L.append('object ZpSpace {')
    for k, v in T['space'].items():
        L.append(f'    val s{k} = {v.replace("px", "")}.dp')
    L.append('}')
    L.append('')
    L.append('object ZpRadius {')
    for k, v in T['radius'].items():
        L.append(f'    val {camel(k)} = {v.replace("px", "")}.dp')
    L.append('}')
    return '\n'.join(L) + '\n'


OUT = {
    'zorapass.css': css(),
    'tokens.scss': scss(),
    'tailwind.zorapass.js': tailwind(),
    'tokens.js': js(),
    'tokens.dart': dart(),
    'ZPTokens.swift': swift(),
    'ZpTokens.kt': kotlin(),
}
for name, content in OUT.items():
    open(os.path.join(HERE, name), 'w').write(content)
    print('wrote', name, len(content), 'bytes')
