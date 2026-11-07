// The "child voice" effect, run on the microphone inside an AudioWorklet (plain JS: it is loaded
// as-is by the browser's audio thread).
//
// A child's voice differs from an adult's in two ways, and both are changed here:
//   - pitch: children speak at about 280-320 Hz (adult men ~110 Hz, women ~210 Hz), with a
//     livelier melody
//   - formants: a smaller throat and mouth put every vowel resonance higher (up to ~1.5x a man's)
// Just speeding the sound up moves both by the same amount, which sounds like a chipmunk.
// Instead this is a phase vocoder (overlapping FFT frames) that separates each frame into its
// spectral envelope (the formants, via "true envelope" cepstral smoothing) and its fine
// structure (the harmonics), raises the harmonics by the pitch factor and the envelope by a
// smaller formant factor, and puts them back together. Each harmonic moves as one piece with
// its neighbouring bins (phase locking), which keeps it from sounding metallic.
// The pitch factor adapts to the speaker: their own pitch is measured and smoothed over about
// a second, so a deep and a high voice both end up at a child's pitch.

const TARGET_PITCH = 300; // Hz, a young child's speaking pitch
const MIN_SHIFT = 1.2;
const MAX_SHIFT = 2.6;
/** Formants: a little higher for everyone, plus part of the pitch change; at most 1.5x. */
const FORMANT_BASE = 1.08;
const FORMANT_FOLLOW = 0.3;
const MAX_FORMANT = 1.5;
/** How much the speaker's own melody is exaggerated (children's voices go up and down more). */
const MELODY = 0.3;

/** In-place radix-2 complex FFT. */
class FFT {
  constructor(n) {
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** inverse: unnormalized (the caller scales) */
  run(re, im, inverse) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step];
          const s = sign * this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

export class ChildVoice {
  /**
   * @param {number} sampleRate
   * @param {{ frame?: number, overlap?: number }} [opts]
   */
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    // ~43 ms frames at 48 kHz (long enough to tell a deep voice's harmonics apart), 8x overlap
    const n = opts.frame ?? (sampleRate > 32000 ? 2048 : 1024);
    const osamp = opts.overlap ?? 8;
    this.n = n;
    this.half = n / 2;
    this.osamp = osamp;
    this.hop = n / osamp;
    this.latency = n - this.hop;
    this.fft = new FFT(n);
    this.window = new Float64Array(n);
    for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

    this.inFifo = new Float64Array(n);
    this.outFifo = new Float64Array(n);
    this.accum = new Float64Array(2 * n);
    this.rover = this.latency;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.cre = new Float64Array(n);
    this.cim = new Float64Array(n);
    const bins = this.half + 1;
    this.lastPhase = new Float64Array(bins);
    this.outPhase = new Float64Array(bins);
    this.synPhase = new Float64Array(bins);
    this.peaks = new Uint32Array(bins);
    this.mag = new Float64Array(bins);
    this.freq = new Float64Array(bins);
    this.env = new Float64Array(bins);
    this.synMag = new Float64Array(bins);

    // cepstral smoothing: keep quefrencies below ~1 ms (formants), drop the harmonics
    this.lifter = Math.max(8, Math.round(sampleRate / 800));
    // pitch is found on the last ~85 ms, at a quarter of the sample rate (plenty for a voice)
    this.history = new Float64Array(4096 * Math.max(1, Math.round(sampleRate / 48000)));
    this.down = 4;
    this.dec = new Float64Array(this.history.length / this.down);
    const decRate = sampleRate / this.down;
    this.minLag = Math.floor(decRate / 420);
    this.maxLag = Math.ceil(decRate / 70);

    this.frames = 0;
    this.gain = 1;
    this.inPower = 0;
    this.outPower = 0;
    this.smooth = Math.exp(-1 / (0.15 * sampleRate));
    this.pitch = 0; // the speaker's own pitch (Hz), 0 until heard
    this.now = 0; // the pitch right now (Hz)
    this.voiced = false; // vowels; noisy sounds (s, f, sh) are not
    this.lowBins = Math.round((1500 * n) / sampleRate);
    this.frameShift = 1; // this frame's factor, changing smoothly
    this.shift = 1.6;
    this.formant = Math.min(MAX_FORMANT, FORMANT_BASE + (this.shift - 1) * FORMANT_FOLLOW);
  }

  /** Processes one block; input and output may be any length (the same). */
  process(input, output) {
    const { n, hop, latency } = this;
    const a = this.smooth;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      this.inFifo[this.rover] = x;
      const y = this.outFifo[this.rover - latency];
      // same loudness as the real voice (measured over ~150 ms), never clipping
      this.inPower = this.inPower * a + x * x * (1 - a);
      this.outPower = this.outPower * a + y * y * (1 - a);
      const want = this.outPower > 1e-10 ? Math.min(1.5, Math.max(0.25, Math.sqrt(this.inPower / this.outPower))) : 1;
      this.gain += (want - this.gain) * 0.001;
      const z = y * this.gain;
      output[i] = z > 0.8 ? 0.8 + 0.2 * Math.tanh((z - 0.8) / 0.2) : z < -0.8 ? -0.8 - 0.2 * Math.tanh((-z - 0.8) / 0.2) : z;
      this.rover++;
      if (this.rover >= n) {
        this.rover = latency;
        this.frame();
        for (let k = 0; k < hop; k++) this.outFifo[k] = this.accum[k];
        this.accum.copyWithin(0, hop, hop + n);
        this.accum.fill(0, n, 2 * n);
        this.inFifo.copyWithin(0, hop, n);
      }
    }
  }

  frame() {
    const { n, half, osamp, re, im, mag, freq, env, synMag } = this;
    const expect = (2 * Math.PI * this.hop) / n;

    for (let k = 0; k < n; k++) {
      re[k] = this.inFifo[k] * this.window[k];
      im[k] = 0;
    }
    this.fft.run(re, im, false);

    // analysis: magnitude and true frequency (in bins) of each bin
    let energy = 0;
    for (let k = 0; k <= half; k++) {
      const m = 2 * Math.hypot(re[k], im[k]);
      const phase = Math.atan2(im[k], re[k]);
      let d = phase - this.lastPhase[k];
      this.lastPhase[k] = phase;
      d -= k * expect;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      mag[k] = m;
      freq[k] = k + (osamp * d) / (2 * Math.PI);
      energy += m * m;
    }

    this.envelope();
    const h = this.history;
    h.copyWithin(0, this.hop);
    h.set(this.inFifo.subarray(n - this.hop, n), h.length - this.hop);
    if (++this.frames % 2 === 0 && energy > 1e-3) this.detectPitch();
    // Vowels have most of their energy low, noisy sounds (s, f, sh) high up; with some
    // hysteresis, so it doesn't flicker within a sound.
    let low = 0;
    for (let k = 0; k < this.lowBins; k++) low += mag[k] * mag[k];
    const lowShare = energy > 0 ? low / energy : 0;
    if (lowShare > 0.5) this.voiced = true;
    else if (lowShare < 0.25) this.voiced = false;

    // Fine structure up by the pitch factor, one harmonic at a time: each spectral peak and the
    // bins around it move together, keeping their phases relative to the peak ("phase locking"),
    // which avoids the metallic, phasey sound of moving every bin on its own.
    // This frame's pitch factor: the speaker's own, with a bit of their melody on top; noisy
    // sounds (s, f, sh) keep their pitch, shifting noise only garbles it.
    let want = 1;
    if (this.voiced) {
      want = this.shift;
      if (this.pitch && this.now) want *= Math.pow(Math.min(1.6, Math.max(0.6, this.now / this.pitch)), MELODY);
    }
    // glide to it (a jump would scatter the harmonics), except into a consonant, which is sudden
    this.frameShift = want === 1 ? 1 : this.frameShift === 1 ? want : this.frameShift + (want - this.frameShift) * 0.15;
    const shift = this.frameShift;
    const { peaks, outPhase, synPhase, lastPhase } = this;
    synMag.fill(0);
    let count = 0;
    let loudest = 0;
    for (let k = 0; k <= half; k++) if (mag[k] > loudest) loudest = mag[k];
    const floor = loudest * 1e-3;
    for (let k = 1; k < half; k++) if (mag[k] > floor && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) peaks[count++] = k;
    for (let j = 0; j < count; j++) {
      const k0 = peaks[j];
      const lo = j > 0 ? ((peaks[j - 1] + k0) >> 1) + 1 : 0;
      const hi = j < count - 1 ? (k0 + peaks[j + 1]) >> 1 : half;
      const to = Math.round(k0 * shift);
      if (to > half) break;
      // the peak's phase moves on from where this output bin was, at its new frequency
      const peakPhase = outPhase[to] + (2 * Math.PI * this.hop * freq[k0] * shift) / n;
      for (let k = lo; k <= hi; k++) {
        const t = to + (k - k0);
        if (t < 0 || t > half) continue;
        const excitation = mag[k] / env[k];
        if (excitation <= synMag[t]) continue;
        synMag[t] = excitation;
        synPhase[t] = peakPhase + (lastPhase[k] - lastPhase[k0]);
      }
    }
    // envelope up by the (smaller) formant factor
    const f = this.formant;
    for (let k = 0; k <= half; k++) {
      const from = k / f;
      const i = Math.floor(from);
      const t = from - i;
      const e = i + 1 <= half ? env[i] * (1 - t) + env[i + 1] * t : env[half];
      synMag[k] *= e;
    }

    // synthesis: back to the time domain, overlap-add
    for (let k = 0; k <= half; k++) {
      // empty bins keep turning at their own frequency, ready for a harmonic to land there
      const phase = synMag[k] > 0 ? synPhase[k] : outPhase[k] + k * expect;
      outPhase[k] = phase % (2 * Math.PI);
      re[k] = synMag[k] * Math.cos(phase);
      im[k] = synMag[k] * Math.sin(phase);
    }
    for (let k = half + 1; k < n; k++) {
      re[k] = 0;
      im[k] = 0;
    }
    this.fft.run(re, im, true);
    const scale = 2 / (half * osamp);
    for (let k = 0; k < n; k++) this.accum[k] += this.window[k] * re[k] * scale;
  }

  /**
   * Smoothed spectral envelope (formants) into `env`, via the cepstrum: only its low
   * quefrencies are kept, which drops the harmonics' ripple and leaves the resonances.
   */
  envelope() {
    const { n, half, cre, cim, mag, env } = this;
    const logMag = this.logMag ?? (this.logMag = new Float64Array(half + 1));
    for (let k = 0; k <= half; k++) logMag[k] = Math.log(mag[k] + 1e-9);
    // "True envelope": smooth, then lift the spectrum to the smooth curve where it dips (between
    // harmonics) and smooth again; a few rounds and the curve follows the harmonic peaks.
    for (let round = 0; round < 4; round++) {
      for (let k = 0; k <= half; k++) {
        cre[k] = round === 0 ? logMag[k] : Math.max(logMag[k], env[k]);
        cim[k] = 0;
      }
      for (let k = half + 1; k < n; k++) {
        cre[k] = cre[n - k];
        cim[k] = 0;
      }
      this.fft.run(cre, cim, true);
      const L = this.lifter;
      for (let q = 0; q < n; q++) {
        cre[q] = q > L && q < n - L ? 0 : cre[q] / n;
        cim[q] = 0;
      }
      this.fft.run(cre, cim, false);
      for (let k = 0; k <= half; k++) env[k] = cre[k];
    }
    for (let k = 0; k <= half; k++) env[k] = Math.exp(env[k]) + 1e-9;
  }

  /**
   * The speaker's pitch in this frame: normalized autocorrelation over voice-like periods. The
   * shortest period that is nearly as good as the best one wins (avoids an octave too low).
   */
  detectPitch() {
    const { history: h, dec, down } = this;
    for (let i = 0; i < dec.length; i++) {
      let sum = 0;
      for (let j = 0; j < down; j++) sum += h[i * down + j];
      dec[i] = sum / down;
    }
    const n = dec.length;
    const minLag = this.minLag;
    const maxLag = this.maxLag;
    const corr = this.corr ?? (this.corr = new Float64Array(maxLag + 2));
    let best = 0;
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let c = 0;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i + lag < n; i++) {
        c += dec[i] * dec[i + lag];
        e1 += dec[i] * dec[i];
        e2 += dec[i + lag] * dec[i + lag];
      }
      corr[lag] = c / (Math.sqrt(e1 * e2) + 1e-12);
      if (lag <= maxLag && corr[lag] > best) best = corr[lag];
    }
    if (best < 0.6) return; // no clear pitch
    for (let lag = minLag + 1; lag <= maxLag; lag++)
      if (corr[lag] >= best * 0.9 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
        // refine between samples (parabola through the peak)
        const a = corr[lag - 1];
        const b = corr[lag];
        const c = corr[lag + 1];
        const off = (a - c) / (2 * (a - 2 * b + c) || 1);
        return this.heard((this.sr / down) / (lag + off));
      }
  }

  /** A pitch was heard: the speaker's pitch moves slowly toward it, and the shift follows. */
  heard(hz) {
    if (hz < 70 || hz > 420) return;
    this.now = this.now ? this.now + (hz - this.now) * 0.2 : hz;
    this.pitch = this.pitch ? Math.exp(Math.log(this.pitch) * 0.97 + Math.log(hz) * 0.03) : hz;
    const want = Math.min(MAX_SHIFT, Math.max(MIN_SHIFT, TARGET_PITCH / this.pitch));
    this.shift += (want - this.shift) * 0.1;
    this.formant = Math.min(MAX_FORMANT, FORMANT_BASE + (this.shift - 1) * FORMANT_FOLLOW);
  }
}

// In the browser's audio thread: one mono voice in, one out.
if (typeof registerProcessor === 'function') {
  registerProcessor(
    'ocak-child-voice',
    class extends AudioWorkletProcessor {
      constructor() {
        super();
        this.voice = new ChildVoice(sampleRate);
      }
      process(inputs, outputs) {
        const input = inputs[0]?.[0];
        const output = outputs[0]?.[0];
        if (!output) return true;
        if (input) this.voice.process(input, output);
        else output.fill(0);
        for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(output);
        return true;
      }
    },
  );
}
