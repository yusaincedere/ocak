/** The child-voice effect (see child-voice-worklet.js); also usable outside the audio thread, for tests. */
export declare class ChildVoice {
  constructor(sampleRate: number, opts?: { frame?: number; overlap?: number });
  /** the speaker's own pitch as heard so far (Hz), 0 until heard */
  pitch: number;
  /** current pitch and formant factors */
  shift: number;
  formant: number;
  /** whether the current sound is a vowel (pitch-shifted) or noise like s/f/sh (not) */
  voiced: boolean;
  /** delay added, in samples */
  latency: number;
  process(input: Float32Array, output: Float32Array): void;
}
