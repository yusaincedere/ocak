import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clampTransform, simplifyCalc } from '../src/name-style.ts';
import { cleanNameStyle, keyframesCss, parseNameStyle, runCss, runLayers, runStyle, serializeNameStyle, styleText } from '../src/name-style.ts';

const one = (s: Record<string, string>, kf?: object) => cleanNameStyle({ runs: [{ t: 'Mert', s }], kf });
const kept = (s: Record<string, string>) => one(s)?.runs[0]?.s ?? {};

describe('pasted name styles: what is kept', () => {
  test('colors, weight, italics, shadows and fonts', () => {
    const s = kept({
      color: 'rgb(242, 161, 61)',
      'font-weight': '700',
      'font-style': 'italic',
      'text-shadow': 'rgb(255, 0, 0) 0px 0px 6px',
      'font-family': '"Comic Sans MS", cursive',
      'letter-spacing': '2px',
    });
    assert.equal(Object.keys(s).length, 6);
  });

  test('gradient text', () => {
    const s = kept({
      'background-image': 'linear-gradient(90deg, rgb(255, 0, 0), #00f 50%, hsl(120 100% 50%))',
      '-webkit-background-clip': 'text',
      '-webkit-text-fill-color': 'transparent',
    });
    assert.equal(s['-webkit-text-fill-color'], 'transparent');
    assert.ok(s['background-image']?.startsWith('linear-gradient'));
  });

  test('animations with their keyframes', () => {
    const style = one(
      { 'animation-name': 'k0', 'animation-duration': '3s', 'animation-iteration-count': 'infinite', color: '#f0f' },
      { k0: [{ at: '0%', s: { color: '#ff0000' } }, { at: '100%', s: { color: 'rgb(0, 0, 255)', 'text-shadow': '#fff 0 0 4px' } }] },
    )!;
    assert.ok(style.kf?.k0);
    const css = keyframesCss(style)[0]!;
    assert.match(css, /^@keyframes ocak-name-[a-z0-9]+ \{ 0% \{ color: #ff0000; \}/);
    // the run points at the same global name
    const name = css.split(' ')[1];
    assert.equal(runCss(style.runs[0]!.s, { k0: name! }).animationName, name);
  });

  test('several looks in one name', () => {
    const style = cleanNameStyle({ runs: [{ t: 'Me', s: { color: '#f00' } }, { t: 'rt', s: { color: '#0f0' } }, { t: '!', s: { color: '#0f0' } }] })!;
    assert.deepEqual(style.runs.map((r) => r.t), ['Me', 'rt!']); // same look merged
  });
});

describe('pasted name styles: what is blocked', () => {
  test('anything that could load from the network', () => {
    for (const [p, v] of [
      ['background-image', 'url(https://evil.example/x.png)'],
      ['background-image', 'image-set("https://evil.example/x.png" 1x)'],
      ['background-image', 'linear-gradient(red, blue), url(//evil.example)'],
      ['background-image', 'u\\72 l(https://evil.example)'],
      ['filter', 'url(#x)'],
      ['font-family', 'x; background: url(https://evil.example)'],
      ['color', 'var(--accent)'],
      ['color', 'attr(data-x)'],
      ['color', 'expression(alert(1))'],
      ['color', 'red; position: fixed'],
      ['color', 'red}</style><script>alert(1)</script>'],
    ] as const)
      assert.deepEqual(kept({ [p]: v }), {}, `${p}: ${v}`);
  });

  test('properties that move or resize things', () => {
    for (const p of ['position', 'display', 'transform', 'font-size', 'width', 'margin', 'z-index', 'content', 'cursor', 'animation', 'background', '--x'])
      assert.deepEqual(kept({ [p]: '10px' }), {}, p);
  });

  test('oversized values', () => {
    assert.deepEqual(kept({ 'text-shadow': 'red 0 0 400px' }), {});
    assert.deepEqual(kept({ 'letter-spacing': '50em' }), {});
    assert.deepEqual(kept({ color: `rgb(${'1, '.repeat(400)}1)` }), {});
  });

  test('invisible or unreadable text', () => {
    assert.deepEqual(kept({ color: 'rgb(0, 0, 0)' }), {}); // black from a white page
    assert.deepEqual(kept({ color: 'transparent' }), {}); // no gradient behind it
    assert.deepEqual(kept({ opacity: '0.05' }), {});
    assert.deepEqual(kept({ 'background-color': 'rgb(255, 255, 255)' }), {}); // page background
  });

  test('flashing and unknown animations', () => {
    const frames = { k0: [{ at: 'from', s: { color: '#f00' } }, { at: 'to', s: { color: '#0f0' } }] };
    // too fast to be safe: it still plays, slowly
    assert.equal(one({ 'animation-name': 'k0', 'animation-duration': '0.05s' }, frames)?.runs[0]?.s?.['animation-duration'], '2s');
    assert.equal(one({ 'animation-name': 'spin', 'animation-duration': '2s' }, frames), null); // not sent along
    // keyframes may only change looks
    const moving = one({ 'animation-name': 'k0', color: '#f0f' }, { k0: [{ at: 'to', s: { transform: 'translate(-999px)', top: '0' } }] });
    assert.equal(moving?.kf, undefined);
    assert.equal(moving?.runs[0]?.s?.['animation-name'], undefined);
    // keyframe selectors can't smuggle CSS
    const sneaky = one({ 'animation-name': 'k0' }, { k0: [{ at: '0%} body{display:none', s: { color: '#f00' } }] });
    assert.equal(sneaky, null);
  });

  test('a received style must spell the name exactly', () => {
    const style = cleanNameStyle({ runs: [{ t: 'Mert', s: { color: '#f2a13d' } }] })!;
    const json = serializeNameStyle(style);
    assert.equal(styleText(parseNameStyle(json, 'Mert')!), 'Mert');
    assert.equal(parseNameStyle(json, 'Admin'), null); // can't show a different name than the real one
    assert.equal(parseNameStyle('{not json', 'Mert'), null);
    assert.equal(parseNameStyle('x'.repeat(5000), 'Mert'), null);
  });

  test('names stay short', () => {
    const style = cleanNameStyle({ runs: [{ t: 'x'.repeat(100), s: { color: '#f00' } }] })!;
    assert.equal(styleText(style).length, 32);
  });
});

describe('pasted name styles: overlay layers', () => {
  const frames = { k0: [{ at: '0%, 100%', s: { 'background-position': '130% 0px', opacity: '0.12' } }, { at: '42%', s: { opacity: '1' } }] };

  test('overlays may be see-through, faint and blended', () => {
    const style = cleanNameStyle({
      runs: [{ t: 'test', s: { 'font-weight': '600' }, l: [{ color: 'transparent', opacity: '0.1', 'mix-blend-mode': 'screen', 'background-image': 'linear-gradient(118deg, transparent 12%, #ff5a1f 34%)', 'animation-name': 'k0', 'animation-duration': '4.4s' }] }],
      kf: frames,
    })!;
    const layer = style.runs[0]!.l![0]!;
    assert.equal(layer.color, 'transparent');
    assert.equal(layer.opacity, '0.1');
    assert.equal(layer['mix-blend-mode'], 'screen');
    // keyframes used only by overlays keep their fades
    assert.equal(style.kf?.k0?.[0]?.s.opacity, '0.12');
  });

  test('the name itself still cannot stay faded out', () => {
    const mostlyGone = { k0: [{ at: '0%, 80%', s: { 'background-position': '130% 0px', opacity: '0.12' } }, { at: '90%', s: { opacity: '1' } }] };
    const style = cleanNameStyle({ runs: [{ t: 'test', s: { 'animation-name': 'k0', opacity: '0.1' } }], kf: mostlyGone })!;
    assert.equal(style.runs[0]!.s!.opacity, undefined);
    assert.equal(style.kf?.k0?.[0]?.s.opacity, undefined); // faded frame stripped
    assert.equal(style.kf?.k0?.[1]?.s.opacity, '1');
  });

  test('a quick fade in and out is fine', () => {
    const whip = { k0: [{ at: '0%', s: { opacity: '0' } }, { at: '17%, 72%', s: { opacity: '1' } }, { at: '92%, 100%', s: { opacity: '0' } }] };
    const style = cleanNameStyle({ runs: [{ t: 'test', s: { 'animation-name': 'k0' } }], kf: whip })!;
    assert.deepEqual(style.kf!.k0!.map((f) => f.s.opacity), ['0', '1', '0']);
  });

  test('overlays get the same blocks, and at most two', () => {
    const style = cleanNameStyle({
      runs: [{ t: 'test', l: [{ position: 'fixed', inset: '0px', content: 'attr(data-text)', 'background-image': 'url(https://evil.example)', color: '#f0f' }, { color: '#0ff' }, { color: '#ff0' }] }],
    })!;
    assert.deepEqual(style.runs[0]!.l, [{ color: '#f0f' }, { color: '#0ff' }]);
  });
});


describe('pasted name styles: squash and stretch', () => {
  test('in-place scale, tilt and skew are kept, in animations too', () => {
    const style = cleanNameStyle({
      runs: [{ t: 'test', s: { 'animation-name': 'k0', 'animation-duration': '1.6s', transform: 'rotate(-5deg)' } }],
      kf: { k0: [{ at: '0%, 100%', s: { transform: 'scale(1, 1)' } }, { at: '28%', s: { transform: 'scale(1.28, 0.72)' } }, { at: '50%', s: { transform: 'skewX(-12deg) scaleY(1.2)' } }] },
    })!;
    assert.equal(style.runs[0]!.s!.transform, 'rotate(-5deg)');
    assert.equal(style.kf?.k0?.length, 3);
  });

  test('anything that travels, flips into 3D or blows up is dropped', () => {
    for (const t of ['translate(-999px)', 'translateY(2em)', 'translateX(100px)', 'matrix(1, 0, 0, 1, 500, 0)', 'scale(8)', 'scale(0.1)', 'rotate(1turn)', 'rotate(90deg)', 'rotateX(20deg)', 'perspective(10px)', 'scale(1) translate(80px)', 'skew(80deg)'])
      assert.deepEqual(kept({ transform: t }), {}, t);
  });
});

describe('pasted name styles: outlines and frames', () => {
  test('hollow outlined letters over a grid, with color-mix', () => {
    const s = kept({
      color: 'transparent',
      '-webkit-text-stroke-width': '1px',
      '-webkit-text-stroke-color': 'color-mix(in srgb, rgb(79, 248, 255) 80%, currentcolor)',
      'background-image': 'linear-gradient(90deg, color-mix(in srgb, rgb(79, 248, 255) 22%, transparent) 1px, transparent 1px)',
      'padding-top': '0.28em',
      'border-top-width': '1px',
      'border-top-style': 'solid',
      'box-shadow': 'inset 0 0 18px color-mix(in srgb, #4ff8ff 18%, transparent)',
    });
    assert.equal(s.color, 'transparent'); // visible thanks to the outline
    assert.equal(Object.keys(s).length, 8);
  });

  test('frames stay small', () => {
    assert.deepEqual(kept({ 'padding-left': '200px' }), {});
    assert.deepEqual(kept({ 'border-top-width': '40px' }), {});
    assert.deepEqual(kept({ 'border-top-left-radius': '5em' }), {});
    assert.deepEqual(kept({ 'box-shadow': '0 0 900px red' }), {});
    assert.deepEqual(kept({ 'margin-left': '1px' }), {});
  });
});

describe('pasted name styles: per-letter effects', () => {
  test('staggered delays from calc()', () => {
    assert.equal(simplifyCalc('calc(13 * .08s)'), '1.04s');
    assert.equal(simplifyCalc('calc(0 * 0.08s)'), '0s');
    assert.equal(simplifyCalc('calc(1.04s)'), '1.04s');
    assert.equal(simplifyCalc('calc(100% - 4px)'), 'calc(100% - 4px)'); // left alone, then dropped
  });

  test('small hops are kept', () => {
    assert.equal(kept({ transform: 'translateY(-18px) rotate(-9deg)' }).transform, 'translateY(-18px) rotate(-9deg)');
  });

  test('what all letters share is stored once', () => {
    const letters = [...'test test test'].map((t, i) => ({ t, s: { color: '#4ff8ff', 'font-weight': '600', 'animation-name': 'k0', 'animation-duration': '2.6s', 'animation-delay': `${(i * 0.08).toFixed(2)}s` } }));
    const style = cleanNameStyle({ runs: letters, kf: { k0: [{ at: '34%', s: { transform: 'translateY(-18px) rotate(-9deg)' } }] } })!;
    assert.equal(styleText(style), 'test test test');
    assert.equal(style.b?.color, '#4ff8ff');
    assert.deepEqual(Object.keys(style.runs[1]!.s!), ['animation-delay']);
    // and it survives a round trip with the shared part merged back
    assert.deepEqual(parseNameStyle(serializeNameStyle(style), 'test test test'), style);
  });
});

describe('pasted name styles: per-letter numbers in keyframes', () => {
  const letters = (n: number, frames: object[]) =>
    cleanNameStyle({
      runs: Array.from({ length: n }, (_, i) => ({ t: 'abcdefghijklmn'[i], s: { color: '#ff4fd8', 'animation-name': 'k0', 'animation-duration': '3s' }, v: { '--i': String(i) } })),
      kf: { k0: frames },
    });

  test('calc() arithmetic with brackets and signs', () => {
    assert.equal(simplifyCalc('translateX(calc((3 - 4) * 0.167em))'), 'translateX(-0.167em)');
    assert.equal(simplifyCalc('calc((3 - (-2)) * 5px)'), '25px');
    assert.equal(simplifyCalc('scale(1.14, .7)'), 'scale(1.14, .7)');
    assert.equal(simplifyCalc('calc(1em + 2px)'), 'calc(1em + 2px)');
  });

  test('too big moves are toned down, not lost', () => {
    assert.equal(clampTransform('translate(-2em, 0.1em) rotate(-45deg) scale(1.75)'), 'translate(-1em, 0.1em) rotate(-30deg) scale(1.5)');
    assert.equal(clampTransform('scale(-3, 0.2)'), 'scale(-1.5, 0.5)');
  });

  test('each letter gets its own filled-in copy of the keyframes', () => {
    const style = letters(3, [{ at: '50%', s: { transform: 'translateX(calc((1 - var(--i)) * 0.5em)) scale(1.14, .7)' } }])!;
    assert.deepEqual(style.runs.map((r) => r.v), [{ '--i': '0' }, { '--i': '1' }, { '--i': '2' }]);
    const css = keyframesCss(style);
    assert.equal(css.length, 3);
    assert.ok(css.some((c) => c.includes('translateX(0.5em)')));
    assert.ok(css.some((c) => c.includes('translateX(-0.5em)')));
    assert.ok(css.every((c) => !c.includes('var(')));
  });

  test('a value that fails for any letter is dropped', () => {
    const style = letters(2, [{ at: '50%', s: { transform: 'rotate(calc(var(--i) * 1em))', color: 'rgb(79, 248, 255)' } }])!;
    assert.deepEqual(Object.keys(style.kf!.k0![0]!.s), ['color']);
    assert.ok(!style.runs.some((r) => r.v)); // numbers nobody uses are not kept
  });

  test('only plain numbers, and no var() outside keyframes', () => {
    const bad = cleanNameStyle({ runs: [{ t: 'a', s: { color: 'var(--x)', 'animation-name': 'k0' }, v: { '--x': 'url(x)' } }], kf: { k0: [{ at: 'to', s: { color: 'var(--x)', transform: 'scale(var(--x, 9))' } }] } });
    assert.equal(bad, null);
  });
});

describe('pasted name styles: long per-letter names stay small', () => {
  test('alternating looks and per-letter sparks are stored once', () => {
    const grad = (c: string) => `radial-gradient(circle at 50% 58%, ${c} 0 40%, color-mix(in srgb, ${c} 42%, rgb(58, 0, 31)) 76%, color-mix(in srgb, ${c} 18%, rgb(20, 0, 10)) 100%)`;
    const spark = 'radial-gradient(circle, rgb(255, 255, 255) 0 7%, rgb(79, 248, 255) 14%, color-mix(in srgb, rgb(255, 79, 216) 50%, transparent) 26%, transparent 46%)';
    const name = 'abcdefghijklmnopqrstuvwxyzabcdef';
    const raw = {
      runs: Array.from(name, (t, i) => ({
        t,
        s: { color: 'transparent', 'background-image': grad(i % 2 ? '#4ff8ff' : '#ff4fd8'), 'background-clip': 'text', 'animation-name': 'k0', 'animation-duration': '3s', 'animation-delay': `${(i * 14) / 100}s` },
        l: [{ color: 'transparent', 'background-image': spark, opacity: '0', 'animation-name': 'k0', 'animation-duration': '3s', 'animation-delay': `${(i * 14) / 100}s` }],
      })),
      kf: { k0: [{ at: '0%', s: { opacity: '0' } }, { at: '8%', s: { opacity: '1' } }, { at: '20%, 100%', s: { opacity: '0.5' } }] },
    };
    const style = cleanNameStyle(raw)!;
    assert.ok(style, 'fits');
    assert.equal(style.d?.length, 2); // two alternating looks
    assert.equal(style.bl?.[0]?.['background-image'], spark); // the spark once
    assert.deepEqual(style.runs[3]!.l, [{ 'animation-delay': '0.42s' }]);
    assert.equal(runStyle(style, style.runs[1]!)['background-image'], grad('#4ff8ff'));
    assert.equal(runLayers(style, style.runs[3]!)![0]!['background-image'], spark);
    assert.deepEqual(parseNameStyle(serializeNameStyle(style), name), style);
  });
});
