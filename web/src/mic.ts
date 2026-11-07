// Everything done to your microphone before it is sent: optional noise reduction (RNNoise, see
// noise.ts) and, when an admin set it, the child-voice effect (audio/child-voice-worklet.js).
// One LiveKit track processor holds both in one audio graph, and can be rewired while the call
// goes on (turning noise reduction or the effect on/off doesn't restart the microphone).
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import voiceWorkletUrl from './audio/child-voice-worklet.js?url';
import { AudioNotAllowedYet, createNoiseNode, loadNoiseWorklet, type NoiseNode } from './noise';

export const MIC_PROCESSOR = 'ocak-mic';

export interface MicOptions {
  noise: boolean;
  voice: 'child' | null;
}

export class MicChain implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = MIC_PROCESSOR;
  processedTrack?: MediaStreamTrack;

  // 48 kHz: what RNNoise needs, and fine for the voice effect.
  private ctx: AudioContext | null = null;
  private track: MediaStreamTrack | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private noise: NoiseNode | null = null;
  private voice: AudioWorkletNode | null = null;
  private voiceLoaded = false;

  constructor(private opts: MicOptions) {}

  async init(o: AudioProcessorOptions) {
    this.track = o.track;
    await this.build();
  }

  async restart(o: AudioProcessorOptions) {
    this.teardown();
    this.track = o.track;
    await this.build();
  }

  async destroy() {
    this.teardown();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** Turns parts on or off on the running chain. */
  async update(opts: MicOptions) {
    this.opts = opts;
    if (this.source) await this.wire();
  }

  private async build() {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    // A suspended context would send silence instead of your voice: better to not process at all.
    if (this.ctx.state !== 'running') {
      await this.destroy();
      throw new AudioNotAllowedYet('audio context not running');
    }
    try {
      // (Firefox refuses a mic at another sample rate here; then we simply don't process.)
      this.source = this.ctx.createMediaStreamSource(new MediaStream([this.track!]));
      this.dest = this.ctx.createMediaStreamDestination();
      this.processedTrack = this.dest.stream.getAudioTracks()[0];
      await this.wire();
    } catch (err) {
      await this.destroy();
      throw err;
    }
  }

  /** mic → (noise reduction) → (child voice) → what is sent */
  private async wire() {
    const ctx = this.ctx!;
    if (this.opts.noise && !this.noise) {
      await loadNoiseWorklet(ctx);
      this.noise = await createNoiseNode(ctx);
    }
    if (this.opts.voice === 'child' && !this.voice) {
      if (!this.voiceLoaded) {
        await ctx.audioWorklet.addModule(voiceWorkletUrl);
        this.voiceLoaded = true;
      }
      this.voice = new AudioWorkletNode(ctx, 'ocak-child-voice', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    }
    this.source!.disconnect();
    this.noise?.disconnect();
    this.voice?.disconnect();
    if (!this.opts.noise && this.noise) {
      this.noise.destroy();
      this.noise = null;
    }
    if (this.opts.voice !== 'child' && this.voice) this.voice = null; // a fresh one next time
    let last: AudioNode = this.source!;
    for (const node of [this.noise, this.voice]) if (node) last = last.connect(node);
    last.connect(this.dest!);
  }

  private teardown() {
    this.source?.disconnect();
    this.noise?.disconnect();
    this.noise?.destroy();
    this.voice?.disconnect();
    this.processedTrack?.stop();
    this.source = this.dest = this.noise = this.voice = null;
    this.processedTrack = undefined;
  }
}
