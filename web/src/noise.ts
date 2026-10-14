// Microphone noise reduction (keyboard, fans, background hum) with RNNoise, a small
// open-source neural network that runs in the browser (WebAssembly in an AudioWorklet).
// It plugs into LiveKit as a track processor: the mic goes in, the cleaned-up audio is
// what gets sent. Nothing leaves the device for this.
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

export const NOISE_PROCESSOR = 'ocak-rnnoise';

/** Thrown when the browser won't run audio processing until the user clicks something. */
export class AudioNotAllowedYet extends Error {}

let wasm: Promise<ArrayBuffer> | null = null;
const loadWasm = () =>
  (wasm ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((err: unknown) => {
    wasm = null; // try again next time
    throw err;
  }));

export class NoiseReduction implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = NOISE_PROCESSOR;
  processedTrack?: MediaStreamTrack;

  // RNNoise works on 48 kHz audio, so it gets its own context at that rate.
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: RnnoiseWorkletNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;

  async init(opts: AudioProcessorOptions) {
    await this.connect(opts.track);
  }

  async restart(opts: AudioProcessorOptions) {
    this.disconnect();
    await this.connect(opts.track);
  }

  async destroy() {
    this.disconnect();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private async connect(track: MediaStreamTrack) {
    const wasmBinary = await loadWasm();
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(workletUrl);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    // A suspended context would send silence instead of your voice: better to not process at all.
    if (this.ctx.state !== 'running') {
      await this.destroy();
      throw new AudioNotAllowedYet('audio context not running');
    }
    try {
      // (Firefox refuses a mic at another sample rate here; then we simply don't process.)
      this.source = this.ctx.createMediaStreamSource(new MediaStream([track]));
      this.node = new RnnoiseWorkletNode(this.ctx, { wasmBinary, maxChannels: 1 });
      this.dest = this.ctx.createMediaStreamDestination();
      this.source.connect(this.node).connect(this.dest);
      this.processedTrack = this.dest.stream.getAudioTracks()[0];
    } catch (err) {
      await this.destroy();
      throw err;
    }
  }

  private disconnect() {
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.destroy();
    this.processedTrack?.stop();
    this.source = this.node = this.dest = null;
    this.processedTrack = undefined;
  }
}
