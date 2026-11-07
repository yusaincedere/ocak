import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChildVoice } from '../src/audio/child-voice-worklet.js';

const SR = 48000;

/** A sung vowel: harmonics of f0, shaped by three formants. */
function vowel(f0: number, seconds = 3) {
  const formants = [[700, 110], [1220, 120], [2600, 160]] as const;
  const amp = (f: number) => formants.reduce((a, [c, bw]) => a + Math.exp(-(((f - c) / bw) ** 2)), 0.02);
  const s = new Float32Array(SR * seconds);
  for (let h = 1; h * f0 < 6000; h++) {
    const a = amp(h * f0) * 0.05;
    for (let i = 0; i < s.length; i++) s[i] += a * Math.sin((2 * Math.PI * h * f0 * i) / SR + h);
  }
  return s;
}

function run(input: Float32Array) {
  const voice = new ChildVoice(SR);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) voice.process(input.subarray(i, i + 128), out.subarray(i, i + 128));
  return { voice, out };
}

/** Strength of one frequency over the last second. */
function level(x: Float32Array, hz: number) {
  let re = 0;
  let im = 0;
  for (let i = x.length - SR; i < x.length; i++) {
    re += x[i]! * Math.cos((2 * Math.PI * hz * i) / SR);
    im += x[i]! * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return Math.hypot(re, im) / SR;
}

const peak = (x: Float32Array) => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
const rms = (x: Float32Array) => Math.sqrt(x.slice(-SR).reduce((a, v) => a + v * v, 0) / SR);

for (const [who, f0] of [['a deep voice', 115], ['a higher voice', 200]] as const) {
  test(`${who} (${f0} Hz) ends up at a child's pitch, as loud as before`, () => {
    const input = vowel(f0);
    const { voice, out } = run(input);
    assert.ok(Math.abs(voice.pitch - f0) < 5, `heard ${voice.pitch}`);
    const target = f0 * voice.shift;
    assert.ok(target > 240 && target < 300, `moved to ${target}`);
    // the new fundamental is there; the old one is gone
    assert.ok(level(out, target) > 5 * level(out, f0), 'new pitch is the strong one');
    assert.ok(voice.formant > 1.1 && voice.formant <= 1.32, `formants x${voice.formant}`);
    const loudness = rms(out) / rms(input);
    assert.ok(loudness > 0.8 && loudness < 1.25, `loudness x${loudness}`);
    assert.ok(peak(out) < 1, 'never clips');
  });
}

test('adds only a short delay, and silence stays silent', () => {
  const { voice, out } = run(new Float32Array(SR));
  assert.ok((voice.latency / SR) * 1000 < 25);
  assert.equal(peak(out), 0);
});
