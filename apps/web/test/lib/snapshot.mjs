/* Structural-DOM snapshot utility (dependency-free, node-only).

   The conversion oracle described in FRONTEND-PLAN.md §7.1(3): a normalized-DOM
   snapshot with volatile nodes masked, used as a REGRESSION GUARD between React
   PRs once a page is React — not as the byte-diff-vs-legacy oracle (that is
   retired per page as it converts). The pipeline:

     parse HTML -> tree
       -> normalize (lowercase tags, SORT attributes, collapse whitespace)
       -> strip Next hydration artifacts (comments incl. <!--$--> suspense
          markers, data-reactroot/data-reactid, the #__next mount wrapper,
          /_next/* script+preload noise)
       -> mask volatile nodes by a selector allowlist (countdowns, claim codes,
          sparklines, anything non-deterministic) -> replace their text with «MASK»
       -> serialize to a stable, one-node-per-line string
       -> diff vs a committed golden under apps/web/test/golden/

   It has NO browser/Playwright dependency and adds no packages: the small HTML
   parser below is sufficient for the well-formed HTML these pages emit. */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['script', 'style', 'textarea', 'title']);

export const MASK = '«MASK»';

// ── parse ────────────────────────────────────────────────────────────────────
export function parse(html) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let i = 0;
  const n = html.length;
  const top = () => stack[stack.length - 1];

  while (i < n) {
    if (html[i] === '<') {
      // comment
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4);
        const stop = end === -1 ? n : end + 3;
        top().children.push({ type: 'comment', value: html.slice(i + 4, end === -1 ? n : end) });
        i = stop;
        continue;
      }
      // doctype / declarations
      if (html[i + 1] === '!') {
        const end = html.indexOf('>', i);
        const stop = end === -1 ? n : end + 1;
        top().children.push({ type: 'doctype', value: html.slice(i, stop) });
        i = stop;
        continue;
      }
      // close tag
      if (html[i + 1] === '/') {
        const end = html.indexOf('>', i);
        const name = html.slice(i + 2, end === -1 ? n : end).trim().toLowerCase();
        // pop to matching open (tolerant of minor mismatches)
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === name) {
            stack.length = s;
            break;
          }
        }
        i = end === -1 ? n : end + 1;
        continue;
      }
      // open tag
      const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i));
      if (m) {
        const tag = m[1].toLowerCase();
        // find end of the open tag, respecting quotes
        let j = i + m[0].length;
        let quote = null;
        while (j < n) {
          const c = html[j];
          if (quote) {
            if (c === quote) quote = null;
          } else if (c === '"' || c === "'") {
            quote = c;
          } else if (c === '>') {
            break;
          }
          j++;
        }
        const rawAttrs = html.slice(i + m[0].length, j);
        const selfClose = /\/\s*$/.test(rawAttrs);
        const el = { type: 'element', tag, attrs: parseAttrs(rawAttrs), children: [] };
        top().children.push(el);
        i = j + 1;

        if (VOID.has(tag) || selfClose) continue;

        if (RAWTEXT.has(tag)) {
          // consume verbatim until the matching close tag
          const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
          const rest = html.slice(i);
          const cm = closeRe.exec(rest);
          const textEnd = cm ? i + cm.index : n;
          el.children.push({ type: 'text', value: html.slice(i, textEnd) });
          i = cm ? textEnd + cm[0].length : n;
          continue;
        }
        stack.push(el);
        continue;
      }
      // stray '<'
      top().children.push({ type: 'text', value: '<' });
      i++;
      continue;
    }
    // text
    const next = html.indexOf('<', i);
    const textEnd = next === -1 ? n : next;
    top().children.push({ type: 'text', value: html.slice(i, textEnd) });
    i = textEnd;
  }
  return root;
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([^\s"'=/>]+)(\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=>]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    if (!m[1]) continue;
    const name = m[1].toLowerCase();
    if (name === '/') continue;
    const value = m[2] === undefined ? '' : (m[4] ?? m[5] ?? m[6] ?? '');
    attrs[name] = value;
  }
  return attrs;
}

// ── selector matching (subset: tag, .class, #id, [attr], [attr=val], comma-lists) ─
function matches(el, selector) {
  return selector.split(',').map((s) => s.trim()).filter(Boolean).some((sel) => matchesSimple(el, sel));
}
function matchesSimple(el, sel) {
  // one compound simple selector, e.g. div#foo.bar[data-x=y]
  const re = /([.#]?[\w-]+|\[[^\]]+\])/g;
  let part;
  while ((part = re.exec(sel))) {
    const p = part[0];
    if (p.startsWith('#')) {
      if (el.attrs.id !== p.slice(1)) return false;
    } else if (p.startsWith('.')) {
      const cls = (el.attrs.class || '').split(/\s+/);
      if (!cls.includes(p.slice(1))) return false;
    } else if (p.startsWith('[')) {
      const am = /^\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(p);
      if (!am) return false;
      const has = am[1] in el.attrs;
      if (am[2] === undefined) {
        if (!has) return false;
      } else if (el.attrs[am[1]] !== am[2]) return false;
    } else {
      if (el.tag !== p.toLowerCase()) return false;
    }
  }
  return true;
}

// ── normalize + strip + mask ─────────────────────────────────────────────────
const DEFAULT_STRIP_ATTRS = new Set(['data-reactroot', 'data-reactid', 'data-react-checksum']);

function isNextArtifactElement(el) {
  if (el.type !== 'element') return false;
  if (el.attrs.id === '__next' || el.attrs.id === '__next-build-watcher') return true;
  // Next-injected script/preload plumbing (kept out of the structural signature)
  if (el.tag === 'script' && /\/_next\//.test(el.attrs.src || '')) return true;
  if (el.tag === 'link' && (el.attrs.rel === 'preload' || el.attrs.rel === 'prefetch') && /\/_next\//.test(el.attrs.href || '')) return true;
  if (el.tag === 'template' && (el.attrs.id === '__NEXT_DATA__' || 'data-dgst' in el.attrs)) return true;
  return false;
}

export function normalize(node, opts = {}) {
  const mask = opts.mask || []; // array of selectors whose subtree text is masked
  const stripAttrs = new Set([...(opts.stripAttrs || []), ...DEFAULT_STRIP_ATTRS]);

  function walk(node, masked) {
    if (node.type === 'text') {
      const v = (masked ? MASK : node.value).replace(/\s+/g, ' ').trim();
      return v ? [{ type: 'text', value: v }] : [];
    }
    if (node.type === 'comment' || node.type === 'doctype') return []; // strip comments/doctype
    if (node.type === 'element') {
      if (isNextArtifactElement(node)) {
        // #__next is a wrapper: drop the element but KEEP its normalized children
        if (node.attrs.id === '__next') return node.children.flatMap((c) => walk(c, masked));
        return [];
      }
      const isMasked = masked || mask.some((sel) => matches(node, sel));
      const attrs = {};
      for (const [k, val] of Object.entries(node.attrs)) {
        if (stripAttrs.has(k)) continue;
        attrs[k] = val;
      }
      const children = node.children.flatMap((c) => walk(c, isMasked));
      return [{ type: 'element', tag: node.tag, attrs, children, masked: isMasked }];
    }
    return [];
  }

  const children = node.children.flatMap((c) => walk(c, false));
  return { type: 'root', children };
}

// ── serialize (stable, one node per line) ────────────────────────────────────
export function serialize(node) {
  const out = [];
  function attrStr(attrs) {
    return Object.keys(attrs)
      .sort()
      .map((k) => (attrs[k] === '' ? k : `${k}="${String(attrs[k]).replace(/"/g, '&quot;')}"`))
      .join(' ');
  }
  function walk(node, depth) {
    const pad = '  '.repeat(depth);
    if (node.type === 'text') {
      out.push(`${pad}#text ${node.value}`);
      return;
    }
    if (node.type === 'element') {
      const a = attrStr(node.attrs);
      out.push(`${pad}<${node.tag}${a ? ' ' + a : ''}>`);
      for (const c of node.children) walk(c, depth + 1);
    }
  }
  for (const c of node.children) walk(c, 0);
  return out.join('\n') + '\n';
}

/** HTML string -> normalized structural snapshot string. */
export function snapshot(html, opts = {}) {
  return serialize(normalize(parse(html), opts));
}

/** Tiny line diff for readable failures. Returns null when equal. */
export function diff(actual, expected) {
  if (actual === expected) return null;
  const a = actual.split('\n');
  const b = expected.split('\n');
  const lines = [];
  const max = Math.max(a.length, b.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 40; i++) {
    if (a[i] !== b[i]) {
      lines.push(`  line ${i + 1}:`);
      lines.push(`    - golden: ${b[i] ?? '<none>'}`);
      lines.push(`    + actual: ${a[i] ?? '<none>'}`);
      shown++;
    }
  }
  if (shown >= 40) lines.push('  … (diff truncated)');
  return lines.join('\n');
}
