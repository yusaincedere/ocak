// Built-in name styles: the styled-text snippets people liked, applied to anyone's name.
// They are not trusted code: each one is turned into HTML for the person's name and read by the
// same paste reader and checks as anything pasted (nameFromHtml → cleanNameStyle).

import { nameFromHtml } from './name-paste';
import { styleText, type NameStyle } from './name-style';

interface Preset {
  id: string;
  /** how the snippet wraps the text: per letter (<b style="--i:n">), plain, or plain + data-text */
  markup: 'letters' | 'text' | 'dataText';
  css: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'lightleak',
    markup: 'dataText',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-lightleak {
  position: relative;
  font: 600 34px/1.05 "JetBrains Mono", monospace;
  letter-spacing: .1em;
  color: var(--ink);
  isolation: isolate;
}
.fx-lightleak::before,
.fx-lightleak::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: transparent;
  -webkit-background-clip: text;
  background-clip: text;
  mix-blend-mode: screen;
}
.fx-lightleak::before {
  background: linear-gradient(
      118deg,
      transparent 12%,
      #ff5a1f 34%,
      #ffd27a 44%,
      #fff 48%,
      transparent 62%
    ) 120% 0 / 240% 100%;
  filter: blur(.35px);
  animation: fx-lightleak-a 4.4s ease-in-out infinite;
}
.fx-lightleak::after {
  background: linear-gradient(
      248deg,
      transparent 18%,
      var(--ink-3) 38%,
      var(--ink-2) 48%,
      transparent 68%
    ) -20% 0 / 240% 100%;
  opacity: .9;
  animation: fx-lightleak-b 5.6s ease-in-out infinite;
}
@keyframes fx-lightleak-a {
  0%, 100% { background-position: 130% 0; opacity: .12; }
  42%      { background-position: -30% 0; opacity: 1; }
}
@keyframes fx-lightleak-b {
  0%, 100% { background-position: -30% 0; opacity: .1; }
  55%      { background-position: 130% 0; opacity: .95; }
}
`,
  },
  {
    id: 'elastic',
    markup: 'text',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-elastic {
  font: 600 32px/1.1 "JetBrains Mono", monospace;
  letter-spacing: .08em;
  color: var(--ink-2);
  animation: fx-elastic 1.6s ease-in-out infinite;
}
@keyframes fx-elastic {
  0%, 100% { transform: scale(1, 1); }
  28% { transform: scale(1.28, .72); }
  44% { transform: scale(.78, 1.24); }
  60% { transform: scale(1.12, .9); }
  74% { transform: scale(.96, 1.05); }
  86% { transform: scale(1.02, .98); }
}
`,
  },
  {
    id: 'blueprint',
    markup: 'text',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-blueprint {
  font: 600 28px/1.15 "JetBrains Mono", monospace;
  letter-spacing: .1em;
  color: transparent;
  padding: .28em .45em;
  -webkit-text-stroke: 1px color-mix(in srgb, var(--ink-3) 80%, var(--ink));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--ink-3) 22%, transparent) 1px, transparent 1px),
    linear-gradient(0deg, color-mix(in srgb, var(--ink-3) 18%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--ink-3) 42%, transparent), transparent 35% 65%, color-mix(in srgb, var(--ink-3) 42%, transparent));
  background-size: 12px 12px, 12px 12px, 240% 100%;
  background-position: 0 0, 0 0, 100% 0;
  border: 1px solid color-mix(in srgb, var(--ink-3) 42%, transparent);
  box-shadow: inset 0 0 18px color-mix(in srgb, var(--ink-3) 18%, transparent);
  animation: fx-blueprint 4s linear infinite;
}
@keyframes fx-blueprint {
  to { background-position: 24px 0, 0 24px, -100% 0; }
}
`,
  },
  {
    id: 'kinetic',
    markup: 'letters',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-kinetic {
  font: 600 30px/1.1 "JetBrains Mono", monospace;
  letter-spacing: .06em;
  color: var(--ink);
  display: inline-flex;
}
.fx-kinetic b {
  font-weight: inherit;
  display: inline-block;
  transform-origin: center;
  animation: fx-kinetic 2.6s cubic-bezier(.2, .8, .2, 1) infinite;
  animation-delay: calc(var(--i) * .08s);
}
.fx-kinetic b:nth-child(2n) { color: var(--ink-3); }
.fx-kinetic b:nth-child(3n) { color: var(--ink-2); }
@keyframes fx-kinetic {
  0%, 18%   { transform: translateY(0) rotate(0deg); filter: blur(0); }
  34%       { transform: translateY(-18px) rotate(-9deg); filter: blur(.4px); }
  52%       { transform: translateY(14px) rotate(7deg); }
  68%, 100% { transform: translateY(0) rotate(0deg); filter: blur(0); }
}
`,
  },
  {
    id: 'equalizer',
    markup: 'letters',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-equalizer {
  font: 600 30px/1.1 "JetBrains Mono", monospace;
  color: var(--ink);
  display: inline-flex;
  align-items: flex-end;
  gap: 7px;
  padding-top: 44px;
}
.fx-equalizer b {
  position: relative;
  font-weight: inherit;
  display: inline-block;
  animation: fx-eqbounce 1.9s ease-in-out infinite;
  animation-delay: calc(var(--i) * -.21s);
}
.fx-equalizer b::before {
  content: '';
  position: absolute;
  left: 50%;
  width: 122%;
  transform: translateX(-50%);
  border-radius: 3px 3px 1px 1px;
  background: linear-gradient(
    180deg,
    var(--ink-2) 0%,
    var(--ink-3) 65%,
    color-mix(in srgb, var(--ink-3) 25%, transparent) 100%
  );
  box-shadow: 0 0 10px color-mix(in srgb, var(--ink-2) 40%, transparent);
  animation: fx-eqbar 1.9s ease-in-out infinite;
  animation-delay: calc(var(--i) * -.21s);
}
@keyframes fx-eqbar {
  0%, 100% { height: 7px; bottom: -7px; }
  20% { height: 34px; bottom: -34px; }
  40% { height: 15px; bottom: -15px; }
  60% { height: 44px; bottom: -44px; }
  80% { height: 22px; bottom: -22px; }
}
@keyframes fx-eqbounce {
  0%, 100% {
    transform: translateY(-7px);
    color: color-mix(in srgb, var(--ink) 65%, transparent);
    text-shadow: none;
  }
  20% {
    transform: translateY(-34px);
    color: var(--ink);
    text-shadow: none;
  }
  40% {
    transform: translateY(-15px);
    color: color-mix(in srgb, var(--ink) 80%, transparent);
    text-shadow: none;
  }
  60% {
    transform: translateY(-44px);
    color: #fff;
    text-shadow: 0 0 16px var(--ink-2);
  }
  80% {
    transform: translateY(-22px);
    color: var(--ink);
    text-shadow: none;
  }
}
`,
  },
  {
    id: 'gooey',
    markup: 'letters',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-gooey {
  font: 600 30px/1.1 "JetBrains Mono", monospace;
  letter-spacing: .08em;
  display: inline-flex;
  align-items: flex-end;
}
.fx-gooey b {
  font-weight: inherit;
  display: inline-block;
  color: transparent;
  background: linear-gradient(
    185deg,
    #f4f7ff 8%,
    var(--ink-3) 34%,
    #d5dbe6 50%,
    var(--ink-2) 72%,
    #9aa3b5 100%
  );
  background-size: 100% 190%;
  -webkit-background-clip: text;
  background-clip: text;
  transform-origin: 50% 100%;
  filter: drop-shadow(0 6px 8px color-mix(in srgb, var(--ink-3) 30%, transparent));
  animation: fx-gooey 3.4s cubic-bezier(.45, .06, .28, 1) infinite;
  animation-delay: calc(var(--i) * .06s);
}
@keyframes fx-gooey {
  0%, 16%, 100% {
    transform: translateX(0) scale(1, 1);
    background-position: 50% 0%;
    filter: drop-shadow(0 6px 8px color-mix(in srgb, var(--ink-3) 30%, transparent));
  }
  44%, 54% {
    transform: translateX(calc((3 - var(--i)) * 5px)) scale(1.14, .7);
    background-position: 50% 90%;
    filter: drop-shadow(0 2px 12px color-mix(in srgb, var(--ink-2) 55%, transparent));
  }
}
`,
  },
  {
    id: 'loud',
    markup: 'text',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-loud {
  font: 800 40px/1 "JetBrains Mono", monospace;
  letter-spacing: .06em;
  color: var(--ink);
  display: inline-block;
  animation: fx-loud 3s infinite;
}
@keyframes fx-loud {
  0%, 12% {
    transform: scale(1);
    color: var(--ink);
    text-shadow: none;
    animation-timing-function: cubic-bezier(.2, 1.5, .4, 1);
  }
  20% {
    transform: scale(1.75);
    color: var(--ink-2);
    text-shadow: 0 0 18px color-mix(in srgb, var(--ink-2) 55%, transparent);
  }
  23% { transform: translate(-5px, 2px) rotate(-3deg) scale(1.75); }
  26% { transform: translate(5px, -2px) rotate(3deg) scale(1.75); }
  29% { transform: translate(-4px, -1px) rotate(-2deg) scale(1.75); }
  32% { transform: translate(4px, 1px) rotate(2deg) scale(1.75); }
  35% { transform: translate(-2px, 2px) rotate(-1deg) scale(1.75); }
  38% { transform: translate(2px, -1px) rotate(1deg) scale(1.75); }
  44% {
    transform: scale(1.75);
    color: var(--ink-2);
    text-shadow: 0 0 18px color-mix(in srgb, var(--ink-2) 55%, transparent);
    animation-timing-function: cubic-bezier(.3, 1.6, .5, 1);
  }
  54%, 100% {
    transform: scale(1);
    color: var(--ink);
    text-shadow: none;
  }
}
`,
  },
  {
    id: 'smear',
    markup: 'letters',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-smear {
  font: 700 34px/1.1 "JetBrains Mono", monospace;
  letter-spacing: .08em;
  color: var(--ink);
  display: inline-flex;
}
.fx-smear b {
  font-weight: inherit;
  display: inline-block;
  animation: fx-smear 2.9s cubic-bezier(.16, .9, .3, 1) infinite;
  animation-delay: calc(var(--i) * .07s);
}
.fx-smear b:nth-child(3n)   { color: var(--ink-3); }
.fx-smear b:nth-child(3n+2) { color: var(--ink-2); }
@keyframes fx-smear {
  0% {
    transform: translateX(-120px) scale(3.4, .68) skewX(-16deg);
    filter: blur(5px);
    opacity: 0;
  }
  17% {
    transform: translateX(0) scale(1, 1) skewX(0deg);
    filter: blur(0);
    opacity: 1;
  }
  25% { transform: scale(.84, 1.14); }
  33% { transform: scale(1.06, .95); }
  41%, 72% { transform: scale(1, 1); filter: blur(0); opacity: 1; }
  92%, 100% {
    transform: translateX(120px) scale(3.4, .68) skewX(16deg);
    filter: blur(5px);
    opacity: 0;
  }
}
`,
  },
  {
    id: 'pewpew',
    markup: 'letters',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-pewpew {
  font: 700 34px/1.1 "JetBrains Mono", monospace;
  letter-spacing: .06em;
  color: var(--ink);
  display: inline-flex;
}
.fx-pewpew b {
  position: relative;
  font-weight: inherit;
  display: inline-block;
  animation: fx-pewpew 3.2s infinite;
  animation-delay: calc(var(--i) * .14s);
}
.fx-pewpew b::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1.5em;
  height: 1.5em;
  margin: -.75em 0 0 -.75em;
  border-radius: 50%;
  background: radial-gradient(circle,
    #fff 0 7%,
    var(--ink-3) 14%,
    color-mix(in srgb, var(--ink-2) 50%, transparent) 26%,
    transparent 46%);
  opacity: 0;
  pointer-events: none;
  animation: fx-pewpew-spark 3.2s ease-out infinite;
  animation-delay: calc(var(--i) * .14s);
}
@keyframes fx-pewpew {
  0% {
    opacity: 0;
    transform: translateX(-170px) scale(4, .08);
    color: #fff;
    text-shadow: 0 0 4px var(--ink-3), 0 0 10px var(--ink-3);
    animation-timing-function: linear;
  }
  2% { opacity: 1; animation-timing-function: linear; }
  8% {
    transform: translateX(0) scale(1.35, .7);
    color: #fff;
    text-shadow: 0 0 6px #fff, 0 0 16px var(--ink-3), 0 0 30px var(--ink-2);
    animation-timing-function: cubic-bezier(.2, .8, .3, 1);
  }
  12% { transform: translateX(-6px) scale(.88, 1.14); }
  17% { transform: translateX(2px) scale(1.04, .97); }
  24%, 80% {
    opacity: 1;
    transform: none;
    color: var(--ink);
    text-shadow: 0 0 10px color-mix(in srgb, var(--ink-3) 40%, transparent);
  }
  92%, 100% {
    opacity: 0;
    transform: translateX(18px);
    text-shadow: none;
  }
}
@keyframes fx-pewpew-spark {
  0%, 7% { opacity: 0; transform: scale(0); }
  8%     { opacity: 1; transform: scale(.45); }
  20%    { opacity: 0; transform: scale(1.7); }
  100%   { opacity: 0; transform: scale(1.7); }
}
`,
  },
  {
    id: 'balloon',
    markup: 'letters',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-balloon {
  font: 700 34px/1 "JetBrains Mono", monospace;
  letter-spacing: .06em;
  display: inline-flex;
  filter: drop-shadow(0 9px 10px color-mix(in srgb, var(--ink-2) 38%, transparent));
}
.fx-balloon b {
  font-weight: inherit;
  display: inline-block;
  color: transparent;
  background:
    radial-gradient(circle at 32% 22%, #fff 0 9%, transparent 22%),
    radial-gradient(circle at 50% 58%,
      var(--ink-2) 0 40%,
      color-mix(in srgb, var(--ink-2) 42%, #3a001f) 76%,
      color-mix(in srgb, var(--ink-2) 18%, #14000a) 100%);
  background-size: 160% 160%, 100% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  transform-origin: 50% 85%;
  animation: fx-balloon 3.1s cubic-bezier(.34, 1.5, .64, 1) infinite;
  animation-delay: calc(var(--i) * .13s);
}
.fx-balloon b:nth-child(even) {
  background:
    radial-gradient(circle at 32% 22%, #fff 0 9%, transparent 22%),
    radial-gradient(circle at 50% 58%,
      var(--ink-3) 0 40%,
      color-mix(in srgb, var(--ink-3) 42%, #003038) 76%,
      color-mix(in srgb, var(--ink-3) 18%, #001014) 100%);
  background-size: 160% 160%, 100% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
}
@keyframes fx-balloon {
  0%, 6% {
    transform: scale(.72, .58) translateY(8px);
    filter: blur(.4px);
    background-position: 50% 90%, 0 0;
  }
  28% {
    transform: scale(1.14, 1.2) translateY(-8px) rotate(-5deg);
    filter: blur(0);
    background-position: 16% 6%, 0 0;
  }
  40%, 74% {
    transform: scale(1, 1) translateY(0) rotate(0deg);
    filter: blur(0);
    background-position: 32% 22%, 0 0;
  }
  92%, 100% {
    transform: scale(.72, .58) translateY(8px);
    filter: blur(.4px);
    background-position: 50% 90%, 0 0;
  }
}
`,
  },
  {
    id: 'heatmap',
    markup: 'text',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-heatmap {
  font: 600 30px/1.1 "JetBrains Mono", monospace;
  letter-spacing: .08em;
  color: transparent;
  background:
    radial-gradient(circle at 20% 50%, #fff26d 0 8%, transparent 24%),
    radial-gradient(circle at 70% 40%, #ff4f8b 0 12%, transparent 28%),
    radial-gradient(circle at 44% 78%, var(--ink-3) 0 14%, transparent 32%),
    linear-gradient(90deg, #2d7dff, #36f0b2, #ffcf4a, #ff4f8b);
  background-size: 130% 130%, 150% 150%, 140% 140%, 260% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: fx-heatmap 3.5s ease-in-out infinite alternate;
}
@keyframes fx-heatmap {
  0%   { background-position: 0 0, 100% 20%, 40% 100%, 100% 0; filter: saturate(1); }
  100% { background-position: 100% 90%, 0 60%, 80% 0, -100% 0; filter: saturate(1.35); }
}
`,
  },
  {
    id: 'lava',
    markup: 'dataText',
    css: `
:root { --ink: currentColor; --ink-2: #ff4fd8; --ink-3: #4ff8ff; }
.fx-lava {
  position: relative;
  font: 800 40px/1.1 Arial, 'Helvetica Neue', sans-serif;
  letter-spacing: .02em;
  white-space: pre;
  color: transparent;
  background:
    radial-gradient(circle at 24% 80%, #ffd000 0 19%, transparent 22%),
    radial-gradient(circle at 74% 26%, #ff7a00 0 21%, transparent 24%),
    radial-gradient(circle at 50% 58%, #ff0066 0 23%, transparent 26%),
    radial-gradient(circle at 12% 30%, #ff2d00 0 17%, transparent 20%),
    linear-gradient(180deg, #b00028, #4d0016 96%);
  background-size: 150% 190%;
  background-position: 0% 0%;
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 0 18px #ff4d1a55) drop-shadow(0 0 6px #ffb70355);
  animation: fx-lava-drift 9s ease-in-out infinite;
}
.fx-lava::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: transparent;
  background:
    radial-gradient(circle at 32% 46%, #fff2a8 0 15%, transparent 18%),
    radial-gradient(circle at 78% 72%, #ff7b00 0 22%, transparent 25%),
    radial-gradient(circle at 60% 18%, #ff2d6f 0 18%, transparent 21%);
  background-size: 200% 200%;
  -webkit-background-clip: text;
  background-clip: text;
  mix-blend-mode: screen;
  animation: fx-lava-blobs 6.5s ease-in-out infinite;
}
@keyframes fx-lava-drift {
  0%, 100% { background-position: 0% 0%; }
  50% { background-position: 100% 100%; }
}
@keyframes fx-lava-blobs {
  0%, 100% { background-position: 100% 0%; }
  50% { background-position: 0% 100%; }
}
`,
  },
  {
    // The original spins its conic border with an animated @property and cuts it out with mask,
    // which names can't use; this keeps the same frame and cycles its colors around instead.
    id: 'gradientframe',
    markup: 'text',
    css: `
.fx-gradientframe {
  display: inline-block;
  padding: .3em .6em;
  font: 800 36px/1.1 'Trebuchet MS', 'Segoe UI', Arial, sans-serif;
  letter-spacing: .06em;
  white-space: pre;
  color: #efe9df;
  border: 3px solid transparent;
  border-radius: 16px;
  background:
    linear-gradient(#1a1714, #1a1714) padding-box,
    conic-gradient(#ff4fd8, #7a5cff, #4ff8ff, #ffd76a, #ff4fd8) border-box;
  box-shadow: 0 0 14px #ff4fd855;
  animation: fx-gradientframe-spin 5.5s linear infinite;
}
@keyframes fx-gradientframe-spin {
  to { filter: hue-rotate(360deg); }
}
`,
  },
  {
    // The original swaps in other words (content: "LOUD"…); a name always shows the real name,
    // so this keeps the roll-in / slide-out and the color cycle with the person's own name.
    id: 'rotator',
    markup: 'text',
    css: `
.fx-rotator {
  font: 800 40px/1.1 "JetBrains Mono", monospace;
  letter-spacing: .08em;
  color: #efe9df;
  animation:
    fx-rotator-color 8s infinite,
    fx-rotator-slide 2s cubic-bezier(.7, 0, .3, 1) infinite;
}
@keyframes fx-rotator-color {
  0%, 24.99%    { color: #efe9df; }
  25%, 49.99%   { color: #ff4fd8; }
  50%, 74.99%   { color: #4ff8ff; }
  75%, 100%     { color: #ff4fd8; }
}
@keyframes fx-rotator-slide {
  0%       { transform: translateY(1em); opacity: 0; }
  18%, 82% { transform: translateY(0); opacity: 1; }
  100%     { transform: translateY(-1em); opacity: 0; }
}
`,
  },
];

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function presetHtml(p: Preset, name: string): string {
  const text =
    p.markup === 'letters'
      ? Array.from(name)
          .map((c, i) => `<b style="--i:${i}">${escape(c)}</b>`)
          .join('')
      : escape(name);
  const attr = p.markup === 'dataText' ? ` data-text="${escape(name)}"` : '';
  return `<div class="fx-${p.id}"${attr}>${text}</div><style>${p.css}</style>`;
}

const cache = new Map<string, NameStyle | null>();
/** A built-in style for this name; null if the style or name is unknown, or nothing survives. */
export function presetStyle(id: string | null | undefined, name: string | null | undefined): NameStyle | null {
  const n = name?.trim();
  const p = PRESETS.find((x) => x.id === id);
  if (!p || !n) return null;
  const key = `${p.id}:${n}`;
  if (!cache.has(key)) {
    const style = nameFromHtml(presetHtml(p, n))?.style ?? null;
    cache.set(key, style && styleText(style) === n ? style : null);
  }
  return cache.get(key)!;
}
