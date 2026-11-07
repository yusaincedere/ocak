// Microphone noise reduction (keyboard, fans, background hum) with RNNoise, a small
// open-source neural network that runs in the browser (WebAssembly in an AudioWorklet).
// It runs in the microphone chain (mic.ts): the mic goes in, the cleaned-up audio is what gets
// sent. Nothing leaves the device for this.
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';

/** Thrown when the browser won't run audio processing until the user clicks something. */
export class AudioNotAllowedYet extends Error {}

let wasm: Promise<ArrayBuffer> | null = null;
const loadWasm = () =>
  (wasm ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((err: unknown) => {
    wasm = null; // try again next time
    throw err;
  }));

const loaded = new WeakSet<AudioContext>();
/** Loads the RNNoise worklet into this (48 kHz) audio context, once. */
export async function loadNoiseWorklet(ctx: AudioContext) {
  if (loaded.has(ctx)) return;
  await ctx.audioWorklet.addModule(workletUrl);
  loaded.add(ctx);
}

export type NoiseNode = RnnoiseWorkletNode;
/** A noise-reduction node for one mono voice (see mic.ts for where it goes). */
export async function createNoiseNode(ctx: AudioContext): Promise<NoiseNode> {
  return new RnnoiseWorkletNode(ctx, { wasmBinary: await loadWasm(), maxChannels: 1 });
}
