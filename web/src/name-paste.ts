// Reads the look of pasted text (from Word, a web page, or pasted HTML source) into a NameStyle.
// The HTML is parsed in an inert document (DOMParser: no scripts run, nothing loads) and only
// read; nothing from it is ever inserted into the page. cleanNameStyle then decides what is kept.

import { clampTransform, cleanNameStyle, MAX_NAME, simplifyCalc, styleText, type KeyFrame, type NameStyle } from './name-style';

export { simplifyCalc };

type Decls = Record<string, string>;

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'svg', 'IFRAME', 'OBJECT']);

/** What tags mean on their own, before any CSS. */
function tagStyle(el: Element): Decls {
  const s: Decls = {};
  switch (el.tagName) {
    case 'B':
    case 'STRONG':
      s['font-weight'] = '700';
      break;
    case 'I':
    case 'EM':
    case 'CITE':
    case 'VAR':
      s['font-style'] = 'italic';
      break;
    case 'U':
    case 'INS':
      s['text-decoration-line'] = 'underline';
      break;
    case 'S':
    case 'STRIKE':
    case 'DEL':
      s['text-decoration-line'] = 'line-through';
      break;
    case 'FONT': {
      const color = el.getAttribute('color');
      const face = el.getAttribute('face');
      if (color) s.color = color.trim();
      if (face) s['font-family'] = face.trim();
      break;
    }
  }
  return s;
}

/**
 * "text, initial" → "text, text". With several backgrounds the browser fills the layers a
 * property didn't name with "initial", which isn't valid in a list; CSS meant the given values
 * to repeat. (All "initial": the property says nothing.)
 */
function repeatLists(v: string): string {
  if (!/\binitial\b/.test(v) || !v.includes(',')) return v;
  const items = v.split(/,(?![^(]*\))/).map((x) => x.trim());
  const given = items.filter((x) => x !== 'initial');
  if (!given.length) return 'initial';
  return items.map((x, i) => (x === 'initial' ? given[i % given.length]! : x)).join(', ');
}

const declsOf = (style: CSSStyleDeclaration): Decls => {
  const out: Decls = {};
  // CSSOM spells shorthands out ("animation: x 2s" → animation-name, animation-duration…)
  for (let i = 0; i < style.length; i++) {
    const p = style.item(i);
    out[p] = repeatLists(simplifyCalc(style.getPropertyValue(p).trim()));
  }
  return out;
};

/** Declarations from CSS text, with this element's variables filled in. */
function parseDecls(css: string, vars: Map<string, string>): Decls {
  const tmp = document.createElement('span');
  tmp.setAttribute('style', withVars(css, vars));
  return declsOf(tmp.style);
}

/** "inherit" & co. mean "what the outer element said": take that (`outer`) instead. */
function merge(into: Decls, from: Decls, outer: Decls = into) {
  for (const [p, v] of Object.entries(from)) {
    if (!/^(inherit|unset|revert|revert-layer)$/i.test(v)) into[p] = v;
    else if (outer[p] !== undefined) into[p] = outer[p];
    else delete into[p];
  }
}

/** Custom properties (--i: 3) set on an element by its style="" or a rule. */
function customProps(css: string): [string, string][] {
  const tmp = document.createElement('span');
  tmp.setAttribute('style', css);
  const out: [string, string][] = [];
  for (let i = 0; i < tmp.style.length; i++) {
    const p = tmp.style.item(i);
    if (p.startsWith('--')) out.push([p, tmp.style.getPropertyValue(p).trim()]);
  }
  return out;
}

const parseSheet = (css: string) => {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(css); // @import is ignored by replaceSync
    return Array.from(sheet.cssRules);
  } catch {
    return [];
  }
};

/**
 * CSS variables (--ink-2: #ff4fd8) defined by <style> rules, so var(--ink-2) can be replaced by its
 * value. Variables an element sets itself (style="--i: 3") are added per element while reading.
 * Whatever comes out is checked like any other value afterwards.
 */
function readVars(doc: Document): Map<string, string> {
  const vars = new Map<string, string>();
  for (const el of Array.from(doc.querySelectorAll('style')))
    for (const rule of parseSheet(el.textContent ?? ''))
      if (rule instanceof CSSStyleRule) for (const [k, v] of customProps(rule.style.cssText)) vars.set(k, v);
  return vars;
}

const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
function withVars(css: string, vars: Map<string, string>): string {
  for (let pass = 0; pass < 5 && css.includes('var('); pass++)
    css = css.replace(VAR, (m, name: string, fallback?: string) => vars.get(name) ?? fallback?.trim() ?? m);
  return css;
}

/** "a::before, .b:after" → the element selectors and which overlay they style. */
function pseudoParts(selectorText: string) {
  return selectorText.split(',').map((part) => {
    const m = part.trim().match(/^(.*?)::?(before|after)$/i);
    return m ? { selector: m[1]!.trim() || '*', layer: m[2]!.toLowerCase() as 'before' | 'after' } : { selector: part.trim(), layer: null };
  });
}

/** A <style> rule; `css` is kept when it uses variables, to read it again per element. */
type SheetRule = { selector: string; layer: 'before' | 'after' | null; s: Decls; css: string | null };

/** Style rules and @keyframes from <style> blocks, parsed by the browser without applying them. */
function readSheets(doc: Document, vars: Map<string, string>) {
  const rules: SheetRule[] = [];
  const keyframes = new Map<string, KeyFrame[]>();
  for (const el of Array.from(doc.querySelectorAll('style'))) {
    // Shared variables are filled in as text first: the browser throws away a shorthand like
    // `background: … var(--x) …` once a later longhand touches it, so it must never see one.
    // Only per-element ones (style="--i: 3") are left for reading each element.
    for (const rule of parseSheet(withVars(el.textContent ?? '', vars))) {
      if (rule instanceof CSSStyleRule) {
        const css = rule.style.cssText;
        const s = parseDecls(css, vars);
        for (const part of pseudoParts(rule.selectorText)) rules.push({ ...part, s, css: css.includes('var(') ? css : null });
      } else if (rule instanceof CSSKeyframesRule)
        keyframes.set(
          rule.name,
          Array.from(rule.cssRules)
            .filter((f): f is CSSKeyframeRule => f instanceof CSSKeyframeRule)
            .map((f) => ({ at: f.keyText, s: declsOf(f.style) })),
        );
    }
  }
  return { rules, keyframes };
}


/** A ::before/::after counts as an overlay only when it repeats the element's own text. */
function repeatsText(el: Element, content: string | undefined): boolean {
  const text = (el.textContent ?? '').trim();
  if (!content || !text) return false;
  const attr = content.match(/^attr\(\s*([\w-]+)\s*\)$/);
  if (attr) return (el.getAttribute(attr[1]!) ?? '').trim() === text;
  const literal = content.match(/^["'](.*)["']$/);
  return !!literal && literal[1]!.trim() === text;
}

/**
 * An empty ::before/::after (content: "") that flashes: a gradient that fades in and out, like a
 * spark on impact. It is drawn over its letter. Anything else empty (bars, boxes, lines…) is left out.
 */
function isFlash(l: Decls, keyframes: Map<string, KeyFrame[]>): boolean {
  if (!/^(""|'')$/.test(l.content ?? '') || !/gradient\(/.test(l['background-image'] ?? '')) return false;
  return (l['animation-name'] ?? '').split(',').some((n) => keyframes.get(n.trim())?.some((f) => f.s.opacity !== undefined));
}

/** The pasted HTML, or HTML source pasted as plain text ("<span style=…>Mert</span>"). */
function pastedHtml(data: DataTransfer): string | null {
  // HTML source wins: copying code from an editor or a code box also puts the *highlighted code*
  // on the clipboard as HTML, which would turn the name into the code itself.
  const text = data.getData('text/plain').trim();
  if (/^<[a-z!][\s\S]*>$/i.test(text)) return text;
  const html = data.getData('text/html');
  return html.trim() ? html : null;
}

/**
 * The name and its look from a paste. Null when the paste has no HTML (a normal text paste);
 * `style` is null when HTML came along but nothing in it survives the checks.
 */
export function nameFromPaste(data: DataTransfer): { text: string; style: NameStyle | null } | null {
  const html = pastedHtml(data);
  return html ? nameFromHtml(html) : null;
}

/** The name and its look from styled HTML (a paste, or one of the built-in styles). */
export function nameFromHtml(html: string): { text: string; style: NameStyle | null } | null {
  if (html.length > 200_000) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const vars = readVars(doc);
  const { rules, keyframes } = readSheets(doc, vars);

  const runs: { t: string; s: Decls; l: Decls[]; v: Decls }[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const chain: Element[] = [];
    let skip = false;
    for (let el = node.parentElement; el && el !== doc.body; el = el.parentElement) {
      if (SKIP.has(el.tagName)) skip = true;
      chain.unshift(el);
    }
    if (skip) continue;
    // Outer to inner: tag meaning, then matching <style> rules, then the element's own style="".
    const s: Decls = {};
    let layers: Decls[] = [];
    const scope = new Map(vars); // variables as this element sees them
    const nums: Decls = {}; // numbers set on the element itself (style="--i: 3"), for keyframes
    for (const el of chain) {
      const outer = { ...s }; // what this element inherits
      merge(s, tagStyle(el));
      const inline = el.getAttribute('style') ?? '';
      const matching = rules.filter((r) => {
        try {
          return el.matches(r.selector);
        } catch {
          return false; // a selector the browser can't match
        }
      });
      for (const r of matching) if (r.css && !r.layer) for (const [k, v] of customProps(r.css)) scope.set(k, v);
      for (const [k, v] of customProps(inline)) scope.set(k, v);
      for (const [k, v] of [...matching.flatMap((r) => (r.css && !r.layer ? customProps(r.css) : [])), ...customProps(inline)])
        if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(v)) nums[k] = v;
      const before: Decls = {};
      const after: Decls = {};
      for (const r of matching) merge(r.layer === 'before' ? before : r.layer === 'after' ? after : s, r.css ? parseDecls(r.css, scope) : r.s, r.layer ? s : outer);
      if (inline) merge(s, parseDecls(inline, scope), outer);
      // a flex row's gap between letters reads as letter spacing
      if (/flex/.test(s.display ?? '') && s['column-gap'] && s['column-gap'] !== 'normal') s['letter-spacing'] ??= s['column-gap'];
      delete s['column-gap'];
      const own = [before, after]
        .filter((l) => repeatsText(el, l.content) || isFlash(l, keyframes))
        // a flash has no text of its own: only its glow shows over the letter
        .map((l) => {
          if (!repeatsText(el, l.content)) return { ...l, color: 'transparent', '-webkit-text-fill-color': 'transparent' };
          // a see-through copy of the text with a gradient is meant to color the letters, even when
          // a later `background:` shorthand reset its clip (it would otherwise be a box over the name)
          const seeThrough = /^(transparent|rgba\(0, 0, 0, 0\))$/.test(l.color ?? '');
          if (seeThrough && /gradient\(/.test(l['background-image'] ?? '') && !/text/.test(`${l['background-clip'] ?? ''}`))
            return { ...l, 'background-clip': 'text', '-webkit-background-clip': 'text' };
          return l;
        });
      if (own.length) layers = own; // the innermost element's overlays
    }
    runs.push({ t: (node.textContent ?? '').replace(/\s+/g, ' '), s, l: layers, v: nums });
  }

  // Trim like a name: no spaces at the ends, at most MAX_NAME characters.
  while (runs.length && !runs[0]!.t.trim()) runs.shift();
  while (runs.length && !runs[runs.length - 1]!.t.trim()) runs.pop();
  if (!runs.length) return null;
  runs[0]!.t = runs[0]!.t.trimStart();
  runs[runs.length - 1]!.t = runs[runs.length - 1]!.t.trimEnd();
  let left = MAX_NAME;
  for (const r of runs) {
    r.t = Array.from(r.t).slice(0, left).join('');
    left -= Array.from(r.t).length;
  }
  const text = runs.map((r) => r.t).join('');
  if (!text) return null;

  // Pixel sizes were made for the snippet's own font size; a name is smaller, so they become em
  // (relative to the letters). Hops are capped at one letter height.
  const fs = parseFloat(runs.find((r) => r.s['font-size']?.endsWith('px'))?.s['font-size'] ?? '') || 16;
  const em = (n: number) => `${Math.round((n / fs) * 1000) / 1000}em`;
  const relative = (decls: Decls) => {
    for (const p of ['transform', 'letter-spacing', 'text-shadow', 'filter']) {
      const v = decls[p];
      if (!v) continue;
      decls[p] = v.replace(/([+-]?(?:\d+\.?\d*|\.\d+))px/g, (_, n: string) => em(Number(n)));
      if (p === 'transform') decls[p] = clampTransform(decls[p]!);
    }
  };
  for (const r of runs) [r.s, ...r.l].forEach(relative);
  for (const frames of keyframes.values()) for (const f of frames) relative(f.s);

  // Keyframes travel under short local names (k0, k1…).
  const local = new Map<string, string>();
  const kf: Record<string, KeyFrame[]> = {};
  for (const decls of runs.flatMap((r) => [r.s, ...r.l])) {
    const names = decls['animation-name'];
    if (!names) continue;
    decls['animation-name'] = names
      .split(',')
      .map((n) => {
        const name = n.trim().replace(/^["']|["']$/g, '');
        const frames = keyframes.get(name);
        if (!frames) return 'none';
        if (!local.has(name)) {
          const k = `k${local.size}`;
          local.set(name, k);
          kf[k] = frames;
        }
        return local.get(name)!;
      })
      .join(', ');
  }

  const style = cleanNameStyle({ runs: runs.filter((r) => r.t), kf });
  return { text, style: style && styleText(style) === text ? style : null };
}
