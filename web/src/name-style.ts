// Styled names: the look of a pasted name (colors, gradients, fonts, shadows, animations…),
// kept as plain data and turned back into CSS by us, never as HTML or raw CSS from someone else.
//
// Everything here is pure (no DOM) and runs on every name we RECEIVE, not just on paste:
// another client could send anything, so only the properties and values below ever reach CSS.
// What is blocked on purpose:
//   - url(), image-set(), element(), attr(), var(), env(), expression(), @import…: any way to make a
//     viewer's browser load something (that would leak their IP) or read page data
//   - layout properties (position, display, transform, size, margin, font-size…): a name can't
//     cover the screen, fake a dialog or push the call UI around
//   - anything over a size limit, invisible text, and animations faster than 0.3s (flashing)

/** One piece of the name with its own look (CSS property → value, both validated). */
export interface NameRun {
  t: string;
  s?: Record<string, string>;
  /**
   * Overlay layers (from a pasted ::before / ::after that repeats the text): copies of this run's
   * text drawn on top of it. We position them ourselves, always exactly over the text.
   */
  l?: Record<string, string>[];
  /**
   * Per-letter numbers (from a pasted style="--i: 3"), only plain numbers. Keyframes may use them
   * as var(--i); every run's own copy of those keyframes is filled in and checked like any value.
   */
  v?: Record<string, string>;
  /** index of a shared look in NameStyle.d */
  d?: number;
}
export interface KeyFrame {
  /** "0%", "50%", "from, to" … */
  at: string;
  s: Record<string, string>;
}
export interface NameStyle {
  /** look shared by every run (kept once, so per-letter styles stay small) */
  b?: Record<string, string>;
  /** looks several runs share (a run points at one with `d`), e.g. every other letter's colors */
  d?: Record<string, string>[];
  /** what every run's overlay layers have in common (a run's own `l` then holds only the rest) */
  bl?: Record<string, string>[];
  runs: NameRun[];
  /** keyframes by short local name ("k0"), referenced from animation-name */
  kf?: Record<string, KeyFrame[]>;
}

export const MAX_NAME = 32;
const MAX_RUNS = 32;
const MAX_DECLS = 48; // border/padding spell out into many longhands
const MAX_KEYFRAMES = 6;
const MAX_LAYERS = 2;
const MAX_FRAMES = 12;
const MAX_VALUE = 600;
/** LiveKit attributes are small; a styled name has to fit comfortably. */
export const MAX_SERIALIZED = 6000;

const COLOR_FNS = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color-mix'];
const GRADIENT_FNS = [
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
];
const FILTER_FNS = ['hue-rotate', 'drop-shadow', 'brightness', 'saturate', 'contrast', 'blur', 'grayscale', 'sepia', 'invert'];
const TIMING_FNS = ['cubic-bezier', 'steps'];

interface Rule {
  fns?: string[];
  /** quoted font names */
  strings?: boolean;
  /** extra check on the whole value */
  check?: (v: string) => boolean;
}

const plain: Rule = {};
const color: Rule = { fns: COLOR_FNS };

const minOpacity = (v: string) => {
  const n = Number(v.replace('%', '')) / (v.endsWith('%') ? 100 : 1);
  return Number.isFinite(n) && n >= 0.4;
};
/** No flashing: an animation cycle takes at least 0.3s. */
const slowEnough = (v: string) =>
  v.split(',').every((part) => {
    const m = part.trim().match(/^(\d*\.?\d+)(s|ms)$/);
    return !!m && (m[2] === 's' ? Number(m[1]) : Number(m[1]) / 1000) >= 0.3;
  });

/**
 * Squash, stretch, tilt, hop, in place: scale 0.5–1.5 (mirroring allowed), rotate and skew up to 30°,
 * shifts up to 24px / 1em. No matrix / 3D / big moves: a name can wobble and bounce but never
 * travel over the rest of the call.
 */
const TRANSFORM_FNS = ['scale', 'scalex', 'scaley', 'rotate', 'skew', 'skewx', 'skewy', 'translate', 'translatex', 'translatey'];
const toDeg = (n: number, unit: string) => (unit === 'turn' ? n * 360 : unit === 'rad' ? (n * 180) / Math.PI : unit === 'grad' ? n * 0.9 : n);
export function boundedTransform(v: string): boolean {
  if (v === 'none') return true;
  const calls = [...v.matchAll(/([a-zA-Z]+)\(([^()]*)\)/g)];
  if (!calls.length || calls.length > 4 || v.replace(/([a-zA-Z]+)\(([^()]*)\)/g, '').trim()) return false;
  return calls.every(([, fn, args]) => {
    const name = fn!.toLowerCase();
    if (!TRANSFORM_FNS.includes(name)) return false;
    const nums = args!.split(/[\s,]+/).filter(Boolean).map((a) => a.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|turn|grad|%|px|em|rem)?$/));
    if (!nums.length || nums.length > 2 || nums.some((m) => !m)) return false;
    return nums.every((m) => {
      const n = Number(m![1]);
      const unit = m![2] ?? '';
      if (name.startsWith('translate')) return unit === '' ? n === 0 : unit === 'px' ? Math.abs(n) <= 24 : unit === 'em' || unit === 'rem' ? Math.abs(n) <= 1 : false;
      if (name.startsWith('scale')) {
        const k = Math.abs(unit === '%' ? n / 100 : n);
        return (unit === '' || unit === '%') && k >= 0.5 && k <= 1.5;
      }
      return (['deg', 'rad', 'turn', 'grad'].includes(unit) || (unit === '' && n === 0)) && Math.abs(toDeg(n, unit)) <= 30;
    });
  });
}

/** The point a name squashes or turns around: somewhere on the letters themselves. */
const origin = (v: string) =>
  [...v.matchAll(/([+-]?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]*)/g)].every(([, n, unit]) => {
    const x = Math.abs(Number(n));
    return unit === '%' ? x <= 100 : unit === 'em' ? x <= 1 : !unit && x === 0;
  });

/** Every length in the value is at most this big (a frame around the name, not a wall). */
const smallLengths = (maxPx: number, maxEm: number) => (v: string) =>
  [...v.matchAll(/([+-]?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]*)/g)].every(([, n, unit]) => {
    const x = Math.abs(Number(n));
    if (!unit) return x === 0;
    if (unit === 'px') return x <= maxPx;
    if (unit === 'em' || unit === 'rem') return x <= maxEm;
    if (unit === '%') return x <= 50;
    return false;
  });
const pad: Rule = { check: smallLengths(12, 0.6) };
const borderWidth: Rule = { check: (v) => /^(thin|medium)$/.test(v) || smallLengths(3, 0.2)(v) };
const radius: Rule = { check: smallLengths(16, 1) };
const SIDES = ['top', 'right', 'bottom', 'left'];
/** A frame around the name: padding, border, rounded corners. */
const BOX_PROPS: Record<string, Rule> = Object.fromEntries([
  ...SIDES.map((side) => [`padding-${side}`, pad]),
  ...SIDES.map((side) => [`border-${side}-width`, borderWidth]),
  ...SIDES.map((side) => [`border-${side}-style`, plain]),
  ...SIDES.map((side) => [`border-${side}-color`, color]),
  ...['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => [`border-${c}-radius`, radius]),
]);

/** Properties a name run may use. */
const RUN_PROPS: Record<string, Rule> = {
  color,
  'background-color': color,
  'background-image': { fns: [...COLOR_FNS, ...GRADIENT_FNS] },
  'background-size': plain,
  'background-position': plain,
  'background-position-x': plain,
  'background-position-y': plain,
  'background-repeat': plain,
  'background-clip': plain,
  '-webkit-background-clip': plain,
  'background-origin': plain,
  '-webkit-text-fill-color': color,
  '-webkit-text-stroke-width': plain,
  '-webkit-text-stroke-color': color,
  'font-family': { strings: true },
  'font-weight': plain,
  'font-style': plain,
  'font-variant': plain,
  'font-variant-caps': plain,
  'text-transform': plain,
  'text-decoration-line': plain,
  'text-decoration-style': plain,
  'text-decoration-color': color,
  'text-decoration-thickness': plain,
  'text-shadow': color,
  'box-shadow': color,
  ...BOX_PROPS,
  'letter-spacing': plain,
  filter: { fns: [...COLOR_FNS, ...FILTER_FNS] },
  opacity: { check: minOpacity },
  transform: { fns: TRANSFORM_FNS, check: boundedTransform },
  'transform-origin': { check: origin },
  'animation-name': plain,
  'animation-duration': { check: slowEnough },
  'animation-delay': plain,
  'animation-iteration-count': plain,
  'animation-direction': plain,
  'animation-fill-mode': plain,
  'animation-timing-function': { fns: TIMING_FNS },
};

/**
 * Overlays may also blend, and fade further: the name itself stays readable underneath.
 * (Their position and size are always ours: exactly over the text.)
 */
const LAYER_PROPS: Record<string, Rule> = { ...RUN_PROPS, opacity: plain, 'mix-blend-mode': plain };

/** Properties a keyframe may animate: looks only, nothing that moves things around. */
const FRAME_PROPS = [
  'transform',
  'color',
  'background-color',
  'background-position',
  'background-position-x',
  'background-position-y',
  'background-size',
  '-webkit-text-fill-color',
  '-webkit-text-stroke-color',
  'text-decoration-color',
  'text-shadow',
  'filter',
  'opacity',
  'letter-spacing',
  'animation-timing-function',
];

// One CSS token at a time: whitespace, #hex, number+unit, identifier or function name, punctuation,
// or (font-family only) a quoted name. Anything else - quotes elsewhere, ; { } < > \ @ ! … - fails.
const TOKEN = /\s+|#[0-9a-fA-F]+\b|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([a-zA-Z]+|%)?|-?-?[a-zA-Z_][a-zA-Z0-9_-]*(\()?|[(),/]|'[\p{L}\p{N} _.-]{1,48}'|"[\p{L}\p{N} _.-]{1,48}"/uy;

const UNITS: Record<string, number> = { '': 10000, px: 40, em: 2.5, rem: 2.5, '%': 1000, deg: 100000, rad: 1000, turn: 100, grad: 100000, s: 60, ms: 60000 };
const FORBIDDEN = /url|image|element|attr|var|env|expression|import|paint|cross-fade|src/i;

/** True when every token of `value` is allowed for this rule. */
export function validValue(value: string, rule: Rule): boolean {
  if (!value || value.length > MAX_VALUE) return false;
  if (rule.check && !rule.check(value.trim())) return false;
  TOKEN.lastIndex = 0;
  let depth = 0;
  while (TOKEN.lastIndex < value.length) {
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(value);
    if (!m || m.index !== start) return false;
    const tok = m[0];
    if (tok.startsWith('#')) {
      if (![4, 5, 7, 9].includes(tok.length)) return false;
    } else if (/^[+-]?[\d.]/.test(tok)) {
      const unit = (m[1] ?? '').toLowerCase();
      const max = UNITS[unit];
      if (max === undefined || Math.abs(parseFloat(tok)) > max) return false;
    } else if (tok.startsWith("'") || tok.startsWith('"')) {
      if (!rule.strings) return false;
    } else if (/^-?-?[a-zA-Z_]/.test(tok)) {
      if (tok.startsWith('--')) return false; // custom properties
      if (m[2]) {
        const fn = tok.slice(0, -1).toLowerCase();
        if (!rule.fns?.includes(fn)) return false;
        depth++;
      } else if (FORBIDDEN.test(tok) && !/^(border-box|padding-box|content-box|text)$/i.test(tok)) {
        // plain words can't load anything, but keep the obviously suspicious ones out anyway
        return false;
      }
    } else if (tok === ')') {
      if (--depth < 0) return false;
    } else if (tok === '(') {
      return false; // only as part of an allowed function name
    }
  }
  return depth === 0;
}

// ---------- calc() and per-letter numbers ----------

const NUM_TOKEN = /\s+|([+-]?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]*)|([*/+-])/y;
/** "(3 - 4) * 5px"-style arithmetic without parentheses → "-5px"; null if it isn't plain arithmetic. */
function arithmetic(expr: string): string | null {
  const items: ({ n: number; u: string } | string)[] = [];
  NUM_TOKEN.lastIndex = 0;
  while (NUM_TOKEN.lastIndex < expr.length) {
    const m = NUM_TOKEN.exec(expr);
    if (!m) return null;
    if (m[1] !== undefined) {
      const prev = items[items.length - 1];
      // "- 4" right after an operator (or at the start) is a sign, not a subtraction
      if (typeof prev === 'string' && (prev === '-' || prev === '+') && (items.length === 1 || typeof items[items.length - 2] === 'string')) {
        items.pop();
        items.push({ n: (prev === '-' ? -1 : 1) * Number(m[1]), u: m[2]!.toLowerCase() });
      } else items.push({ n: Number(m[1]), u: m[2]!.toLowerCase() });
    } else if (m[3]) items.push(m[3]);
  }
  // * and / first, then + and -
  const step = (ops: string, apply: (a: { n: number; u: string }, op: string, b: { n: number; u: string }) => { n: number; u: string } | null) => {
    for (let i = 1; i < items.length - 1; i++) {
      const op = items[i];
      if (typeof op !== 'string' || !ops.includes(op)) continue;
      const a = items[i - 1];
      const b = items[i + 1];
      if (typeof a === 'string' || typeof b === 'string') return false;
      const r = apply(a, op, b);
      if (!r || !Number.isFinite(r.n)) return false;
      items.splice(i - 1, 3, r);
      i--;
    }
    return true;
  };
  const ok =
    step('*/', (a, op, b) => (op === '*' ? (a.u && b.u ? null : { n: a.n * b.n, u: a.u || b.u }) : b.u || b.n === 0 ? null : { n: a.n / b.n, u: a.u })) &&
    step('+-', (a, op, b) => (a.u !== b.u ? null : { n: op === '+' ? a.n + b.n : a.n - b.n, u: a.u }));
  const only = items[0];
  if (!ok || items.length !== 1 || typeof only === 'string') return null;
  return `${Math.round(only.n * 1e4) / 1e4}${only.u}`;
}

/**
 * Works out calc() where it is plain arithmetic: calc(13 * .08s) → 1.04s,
 * calc((3 - 4) * 5px) → -5px. Anything else (calc(100% - 4px)…) stays, and is then dropped.
 */
export function simplifyCalc(v: string): string {
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    v = v.replace(/(calc)?\(([^()]*)\)/gi, (m, calc: string | undefined, inner: string, at: number, all: string) => {
      // a bare "( … )" is a calc() sub-expression; after a function name it's that function's arguments
      if (!calc && /[\w-]$/.test(all.slice(0, at))) return m;
      const r = arithmetic(inner);
      if (r === null) return m;
      changed = true;
      return r;
    });
    if (!changed) break;
  }
  return v;
}

/**
 * Bigger moves than a name may make are toned down to the limit instead of lost: shifts to one
 * letter height, scale to 0.5–1.5, turns and slants to 30°.
 */
export function clampTransform(v: string): string {
  const cap = (x: number, max: number) => Math.round(Math.max(-max, Math.min(max, x)) * 1e4) / 1e4;
  return v.replace(/(translate[XY]?|scale[XY]?|rotate|skew[XY]?)\(([^()]*)\)/gi, (_, fn: string, args: string) => {
    const name = fn.toLowerCase();
    return `${fn}(${args
      .split(',')
      .map((a) => {
        const m = a.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(em|deg|%)?$/);
        if (!m) return a.trim();
        const n = Number(m[1]);
        const unit = m[2] ?? '';
        if (name.startsWith('translate') && unit === 'em') return `${cap(n, 1)}em`;
        if ((name.startsWith('rotate') || name.startsWith('skew')) && unit === 'deg') return `${cap(n, 30)}deg`;
        if (name.startsWith('scale') && (unit === '' || unit === '%')) {
          const k = unit === '%' ? n / 100 : n;
          return `${Math.sign(k || 1) * Math.min(1.5, Math.max(0.5, Math.abs(k)))}`;
        }
        return a.trim();
      })
      .join(', ')})`;
  });
}

const VAR_NAME = /^--[a-zA-Z][\w-]{0,15}$/;
const VAR_REF = /var\(\s*(--[\w-]+)\s*\)/g;
const MAX_VARS = 4;
const isNumber = (v: string) => /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(v) && Math.abs(Number(v)) <= 1000;

/** A run's per-letter numbers: a few plain numbers under simple names. */
function cleanVars(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((e): e is [string, string] => VAR_NAME.test(e[0]) && typeof e[1] === 'string' && isNumber(e[1].trim()))
      .slice(0, MAX_VARS)
      .map(([k, v]) => [k, v.trim()]),
  );
  return Object.keys(out).length ? out : undefined;
}

/** A keyframe value with a run's numbers filled in, or null if one is missing. */
function fillVars(value: string, vars: Record<string, string> | undefined): string | null {
  let missing = false;
  const out = value.replace(VAR_REF, (_, n: string) => {
    const x = vars?.[n];
    if (x === undefined) missing = true;
    return x === undefined ? '0' : `(${x})`;
  });
  return missing || /var\(/i.test(out) ? null : clampTransform(simplifyCalc(out));
}

const usesVars = (frames: KeyFrame[] | undefined) => !!frames?.some((f) => Object.values(f.s).some((v) => v.includes('var(')));

/** A run's own copy of keyframes that use per-letter numbers (others as they are). */
export function runFrames(frames: KeyFrame[], vars: Record<string, string> | undefined): KeyFrame[] {
  if (!usesVars(frames)) return frames;
  return frames.map((f) => ({
    at: f.at,
    s: Object.fromEntries(
      Object.entries(f.s).flatMap(([p, v]) => {
        if (!v.includes('var(')) return [[p, v]];
        const x = fillVars(v, vars);
        return x ? [[p, x]] : [];
      }),
    ),
  }));
}

/** Keywords that just mean "whatever it would be anyway". */
const CSS_WIDE = /^(initial|inherit|unset|revert|revert-layer)$/i;

const DEFAULTS: Record<string, string[]> = {
  'font-weight': ['400', 'normal'],
  'font-style': ['normal'],
  'font-variant': ['normal'],
  'font-variant-caps': ['normal'],
  'text-transform': ['none'],
  'text-decoration-line': ['none'],
  'text-shadow': ['none'],
  'letter-spacing': ['normal', '0px'],
  'background-image': ['none'],
  'background-color': ['transparent', 'rgba(0, 0, 0, 0)'],
  filter: ['none'],
  opacity: ['1'],
  'animation-name': ['none'],
  '-webkit-text-stroke-width': ['0px', '0'],
  'animation-delay': ['0s'],
  'box-shadow': ['none'],
  ...Object.fromEntries(SIDES.flatMap((side) => [[`border-${side}-style`, ['none']], [`padding-${side}`, ['0px']], [`border-${side}-width`, ['0px']]])),
  'animation-direction': ['normal'],
  'animation-fill-mode': ['none'],
  'animation-timing-function': ['ease'],
  'animation-iteration-count': ['1'],
};

/** Relative luminance of a #hex / rgb() color, or null if we can't tell. */
export function luminance(v: string): number | null {
  let r: number, g: number, b: number;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{1,2})?$/i);
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  } else if (rgb) [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  else if (v === 'black') return 0;
  else if (v === 'white') return 1;
  else return null;
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const transparent = (v: string) => v === 'transparent' || /^rgba\(.*,\s*0\)$/.test(v) || /^#[0-9a-f]{6}00$/i.test(v);

function cleanDecls(raw: unknown, allowed: (prop: string) => Rule | undefined, keepDefaults = false): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  let n = 0;
  for (const [prop, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_DECLS) break;
    const rule = allowed(prop);
    if (!rule || typeof value !== 'string') continue;
    const v = value.trim();
    // (in keyframes a default like opacity: 1 is a real step of the animation)
    if (CSS_WIDE.test(v) || (!keepDefaults && DEFAULTS[prop]?.includes(v)) || !validValue(v, rule)) continue;
    out[prop] = v;
    n++;
  }
  return out;
}

/** Validates one run's look and drops what wouldn't work or would hide the name. */
export function cleanRunStyle(raw: unknown, keyframes: Set<string>, layer = false): Record<string, string> {
  const s = cleanDecls(raw, (p) => (layer ? LAYER_PROPS : RUN_PROPS)[p]);
  const gradient = !!s['background-image'];
  const clipped = /text/.test(`${s['background-clip'] ?? ''} ${s['-webkit-background-clip'] ?? ''}`);

  // Dark text from a light web page or Word would vanish on our dark background.
  // (Overlays may be see-through: the name underneath is what people read.)
  for (const p of layer ? [] : ['color', '-webkit-text-fill-color']) {
    const v = s[p];
    if (!v) continue;
    const l = luminance(v);
    if (l !== null && l < 0.1) delete s[p];
    // see-through text only works over a text-clipped gradient
    // (or under an outline: hollow letters)
    const outlined = !!s['-webkit-text-stroke-width'];
    if (transparent(v) && !(gradient && clipped) && !outlined) delete s[p];
  }
  // A page's white/light background behind the text: not part of the name's look.
  const bg = s['background-color'];
  if (bg && ((luminance(bg) ?? 0) > 0.7 || transparent(bg))) delete s['background-color'];

  if (!gradient) for (const p of ['background-size', 'background-position', 'background-position-x', 'background-position-y', 'background-repeat', 'background-clip', '-webkit-background-clip', 'background-origin']) delete s[p];
  if (!s['text-decoration-line']) for (const p of ['text-decoration-style', 'text-decoration-color', 'text-decoration-thickness']) delete s[p];
  if (!s['-webkit-text-stroke-width']) delete s['-webkit-text-stroke-color'];

  // animations only by the names of keyframes that came with the name
  const names = s['animation-name']?.split(',').map((x) => x.trim());
  if (!names || !names.every((x) => keyframes.has(x))) {
    for (const p of Object.keys(s)) if (p.startsWith('animation-')) delete s[p];
  } else if (!s['animation-duration']) {
    s['animation-duration'] = '2s';
  }
  return s;
}

const FRAME_AT = /^(?:from|to|\d{1,3}(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d{1,3}(?:\.\d+)?%))*$/;

const frameRule = (p: string) => (FRAME_PROPS.includes(p) ? (LAYER_PROPS[p] ?? plain) : undefined);

/**
 * A keyframe value that uses per-letter numbers (var(--i)) only has to be well-formed here; each
 * run's filled-in copy is checked in full once the runs are known.
 */
function cleanTemplate(prop: string, value: string): boolean {
  const rule = frameRule(prop);
  if (!rule || value.length > MAX_VALUE || CSS_WIDE.test(value)) return false;
  const names = [...value.matchAll(VAR_REF)].map((m) => m[1]!);
  // the shape must hold with any number filled in: plain arithmetic in an allowed value
  const filled = simplifyCalc(value.replace(VAR_REF, '1'));
  return names.every((n) => VAR_NAME.test(n)) && !/var\(/i.test(filled) && validValue(filled, { ...rule, check: undefined });
}

function cleanKeyframes(raw: unknown): Record<string, KeyFrame[]> {
  const out: Record<string, KeyFrame[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, frames] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_KEYFRAMES)) {
    if (!/^k\d{1,2}$/.test(name) || !Array.isArray(frames)) continue;
    const clean = frames
      .slice(0, MAX_FRAMES)
      .filter((f): f is { at: string; s: unknown } => !!f && typeof f.at === 'string' && FRAME_AT.test(f.at.trim()))
      .map((f) => {
        const s = cleanDecls(f.s, frameRule, true);
        if (f.s && typeof f.s === 'object')
          for (const [p, v] of Object.entries(f.s as Record<string, unknown>))
            if (typeof v === 'string' && v.includes('var(') && cleanTemplate(p, v.trim())) s[p] = v.trim();
        return { at: f.at.trim(), s };
      })
      .filter((f) => Object.keys(f.s).length);
    if (clean.length) out[name] = clean;
  }
  return out;
}

/** How much of one cycle the keyframes keep the name readable (opacity ≥ 0.4), from 0 to 1. */
export function visibleShare(frames: KeyFrame[]): number {
  const points = new Map<number, number>();
  for (const f of frames) {
    const v = f.s.opacity;
    if (v === undefined) continue;
    const o = /%$/.test(v) ? Number(v.slice(0, -1)) / 100 : Number(v);
    if (!Number.isFinite(o)) return 0;
    for (const at of f.at.split(',')) {
      const a = at.trim();
      points.set(a === 'from' ? 0 : a === 'to' ? 1 : parseFloat(a) / 100, o);
    }
  }
  if (!points.size) return 1;
  // where a cycle doesn't say, the name is fully there
  if (!points.has(0)) points.set(0, 1);
  if (!points.has(1)) points.set(1, 1);
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  let visible = 0;
  for (let i = 1; i < sorted.length; i++) {
    const [t0, o0] = sorted[i - 1]!;
    const [t1, o1] = sorted[i]!;
    const span = t1 - t0;
    if (o0 >= 0.4 && o1 >= 0.4) visible += span;
    else if (o0 >= 0.4 || o1 >= 0.4) visible += (span * (Math.max(o0, o1) - 0.4)) / Math.abs(o1 - o0);
  }
  return visible;
}

/** Full validation of a style (from a paste, local storage or another person). Null if nothing is left. */
export function cleanNameStyle(raw: unknown): NameStyle | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as NameStyle).runs)) return null;
  const kf = cleanKeyframes((raw as NameStyle).kf);
  const names = new Set(Object.keys(kf));
  const base = (raw as NameStyle).b && typeof (raw as NameStyle).b === 'object' ? (raw as NameStyle).b : {};
  const palette: unknown[] = Array.isArray((raw as NameStyle).d) ? (raw as NameStyle).d!.slice(0, MAX_RUNS) : [];
  const sharedLayers: unknown[] = Array.isArray((raw as NameStyle).bl) ? (raw as NameStyle).bl! : [];
  let runs: NameRun[] = [];
  let length = 0;
  for (const r of (raw as NameStyle).runs.slice(0, MAX_RUNS)) {
    if (!r || typeof r.t !== 'string' || !r.t) continue;
    const t = Array.from(r.t.replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, MAX_NAME - length).join('');
    if (!t) continue;
    length += Array.from(t).length;
    const look = typeof r.d === 'number' ? palette[r.d] : undefined;
    const s = cleanRunStyle({ ...base, ...(look && typeof look === 'object' ? look : {}), ...(r.s && typeof r.s === 'object' ? r.s : {}) }, names);
    const ownLayers: unknown[] = Array.isArray(r.l) ? r.l : [];
    const l = (sharedLayers.length ? sharedLayers.map((x, j) => ({ ...(x && typeof x === 'object' ? x : {}), ...((ownLayers[j] as object | undefined) ?? {}) })) : ownLayers)
      .slice(0, MAX_LAYERS)
      .map((x) => cleanRunStyle(x, names, true))
      .filter((x) => Object.keys(x).length);
    const v = cleanVars(r.v);
    const run: NameRun = { t };
    if (Object.keys(s).length) run.s = s;
    if (l.length) run.l = l;
    if (v) run.v = v;
    runs.push(run);
    if (length >= MAX_NAME) break;
  }
  if (!runs.some((r) => r.s || r.l)) return null;
  // keep only keyframes that are used
  const animNames = (x?: Record<string, string>) => x?.['animation-name']?.split(',').map((n) => n.trim()) ?? [];
  const runAnims = (r: NameRun) => [...animNames(r.s), ...(r.l ?? []).flatMap(animNames)];
  const onText = new Set(runs.flatMap((r) => animNames(r.s)));
  const used = new Set(runs.flatMap(runAnims));
  const kept: Record<string, KeyFrame[]> = Object.fromEntries(
    Object.entries(kf)
      .filter(([k]) => used.has(k))
      // keyframes that animate the name itself can't fade it out (overlays can)
      .map(([k, frames]) => [
        k,
        // (a quick fade in or out is fine, as long as the name is there most of the time)
        onText.has(k) && visibleShare(frames) < 0.6 ? frames.map((f) => ({ ...f, s: Object.fromEntries(Object.entries(f.s).filter(([p, v]) => p !== 'opacity' || minOpacity(v))) })) : frames,
      ]),
  );
  // Values with per-letter numbers: every run's own filled-in copy must pass, or the value goes.
  for (const [k, frames] of Object.entries(kept)) {
    if (!usesVars(frames)) continue;
    const users = runs.filter((r) => runAnims(r).includes(k));
    kept[k] = frames
      .map((f) => ({
        at: f.at,
        s: Object.fromEntries(
          Object.entries(f.s).filter(([p, v]) => {
            if (!v.includes('var(')) return true;
            return users.every((r) => {
              const x = fillVars(v, r.v);
              return x !== null && validValue(x, frameRule(p)!) && (p !== 'opacity' || !onText.has(k) || minOpacity(x));
            });
          }),
        ),
      }))
      .filter((f) => Object.keys(f.s).length);
    if (!kept[k]!.length) delete kept[k];
  }
  // an animation whose keyframes had nothing left goes too
  const dropDead = (x?: Record<string, string>) => {
    if (x && animNames(x).some((k) => !kept[k])) for (const p of Object.keys(x)) if (p.startsWith('animation-')) delete x[p];
    return x && Object.keys(x).length ? x : undefined;
  };
  for (const r of runs) {
    r.s = dropDead(r.s);
    if (!r.s) delete r.s;
    if (r.l) r.l = r.l.map(dropDead).filter((x): x is Record<string, string> => !!x);
    if (!r.l?.length) delete r.l;
  }
  if (!runs.some((r) => r.s || r.l)) return null;
  // Per-letter numbers only matter to runs whose keyframes use them; then neighbours that look the
  // same become one run.
  const templated = new Set(Object.entries(kept).filter(([, f]) => usesVars(f)).map(([k]) => k));
  const merged: NameRun[] = [];
  for (const r of runs) {
    if (r.v && !runAnims(r).some((k) => templated.has(k))) delete r.v;
    const prev = merged[merged.length - 1];
    if (prev && JSON.stringify([prev.s, prev.l, prev.v]) === JSON.stringify([r.s, r.l, r.v])) prev.t += r.t;
    else merged.push(r);
  }
  runs = merged;
  // What every run has in common is stored once.
  const shared: Record<string, string> = {};
  if (runs.length > 1)
    for (const [p, v] of Object.entries(runs[0]!.s ?? {})) if (runs.every((r) => r.s?.[p] === v)) shared[p] = v;
  const restOf = (r: NameRun) => Object.entries(r.s ?? {}).filter(([p]) => !(p in shared));
  // Overlays every run has are stored once too.
  const n = runs[0]!.l?.length ?? 0;
  const layers =
    runs.length > 1 && n && runs.every((r) => r.l?.length === n)
      ? runs[0]!.l!.map((first, j) => Object.fromEntries(Object.entries(first).filter(([p, v]) => runs.every((r) => r.l![j]![p] === v))))
      : undefined;
  const layerRest = (r: NameRun) => {
    if (!layers) return r.l;
    const rest = r.l!.map((x, j) => Object.fromEntries(Object.entries(x).filter(([p]) => !(p in layers[j]!))));
    return rest.some((x) => Object.keys(x).length) ? rest : undefined;
  };
  // And looks that several runs share (alternating colors…) go into a list the runs point at.
  const counts = new Map<string, number>();
  for (const r of runs) for (const [p, v] of restOf(r)) counts.set(`${p}:${v}`, (counts.get(`${p}:${v}`) ?? 0) + 1);
  const looks: Record<string, string>[] = [];
  const lookIndex = new Map<string, number>();
  const compact = runs.map((r) => {
    const rest = restOf(r);
    const repeated = rest.filter(([p, v]) => counts.get(`${p}:${v}`)! > 1).sort(([a], [b]) => (a < b ? -1 : 1));
    const own = rest.filter(([p, v]) => counts.get(`${p}:${v}`)! <= 1);
    const out: NameRun = { t: r.t };
    if (repeated.length) {
      const key = JSON.stringify(repeated);
      if (!lookIndex.has(key)) {
        lookIndex.set(key, looks.length);
        looks.push(Object.fromEntries(repeated));
      }
      out.d = lookIndex.get(key)!;
    }
    if (own.length) out.s = Object.fromEntries(own);
    const l = layerRest(r);
    if (l) out.l = l;
    if (r.v) out.v = r.v;
    return out;
  });
  const style: NameStyle = {
    ...(Object.keys(shared).length ? { b: shared } : {}),
    ...(looks.length ? { d: looks } : {}),
    ...(layers ? { bl: layers } : {}),
    runs: compact,
    ...(Object.keys(kept).length ? { kf: kept } : {}),
  };
  return JSON.stringify(style).length <= MAX_SERIALIZED ? style : null;
}

export const styleText = (s: NameStyle) => s.runs.map((r) => r.t).join('');

/** Reads a stored / received style; only valid when it spells exactly this name. */
export function parseNameStyle(json: string | null | undefined, name: string | null | undefined): NameStyle | null {
  if (!json || !name || json.length > MAX_SERIALIZED) return null;
  try {
    const style = cleanNameStyle(JSON.parse(json));
    return style && styleText(style) === name ? style : null;
  } catch {
    return null;
  }
}

export const serializeNameStyle = (s: NameStyle | null) => (s ? JSON.stringify(s) : '');

// ---------- turning it back into CSS ----------

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Global keyframe names for a style (by content, so two people's "k0" never clash). Keyframes with
 * per-letter numbers get a name per run (`r`), since each run has its own copy.
 */
export function keyframeNames(style: NameStyle, r?: NameRun): Record<string, string> {
  return Object.fromEntries(Object.entries(style.kf ?? {}).map(([k, frames]) => [k, `ocak-name-${hash(JSON.stringify(runFrames(frames, r?.v)))}`]));
}

/** @keyframes rules, built only from validated values (no quotes, braces or semicolons can occur). */
export function keyframesCss(style: NameStyle): string[] {
  const rules = new Set<string>();
  for (const r of style.runs) {
    const names = keyframeNames(style, r);
    for (const [k, frames] of Object.entries(style.kf ?? {}))
      rules.add(`@keyframes ${names[k]} {${runFrames(frames, r.v).map((f) => ` ${f.at} { ${Object.entries(f.s).map(([p, v]) => `${p}: ${v};`).join(' ')} }`).join('')} }`);
  }
  return [...rules];
}

/** Whether a run moves (a transform, or an animation that transforms): it then needs a box of its own. */
/** A run's full look: the shared part plus its own. */
export const runStyle = (style: NameStyle, r: NameRun) => ({ ...style.b, ...(r.d !== undefined ? style.d?.[r.d] : undefined), ...r.s });
/** A run's overlay layers (its own, or the ones every run has). */
export const runLayers = (style: NameStyle, r: NameRun) => (style.bl ? style.bl.map((x, j) => ({ ...x, ...r.l?.[j] })) : r.l);

export function moves(s: Record<string, string> | undefined, style: NameStyle): boolean {
  if (!s) return false;
  if (s.transform) return true;
  return (s['animation-name'] ?? '').split(',').some((k) => style.kf?.[k.trim()]?.some((f) => f.s.transform));
}

export const camel = (p: string) => p.replace(/^-webkit-/, 'Webkit-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** A run's look as a React style object (animation names mapped to the global keyframes). */
export function runCss(s: Record<string, string> | undefined, names: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, v] of Object.entries(s ?? {}))
    out[camel(p)] = p === 'animation-name' ? v.split(',').map((x) => names[x.trim()] ?? 'none').join(', ') : v;
  return out;
}
