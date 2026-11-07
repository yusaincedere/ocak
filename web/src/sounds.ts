// Tiny synthesized UI sounds for call and message events, and the door knock an admin can send.
import knockUrl from './assets/door-knock.m4a?url';

let ctx: AudioContext | null = null;

function tone(freqs: number[], step = 0.09, volume = 0.08, type: OscillatorType = 'sine') {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const start = t0 + i * step;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + step * 1.8);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + step * 2);
    });
  } catch {
    /* audio not available */
  }
}

export const sounds = {
  rouletteTick: () => tone([720], 0.018, 0.025, 'triangle'),
  rouletteWin: () => tone([523, 659, 784, 1047], 0.11, 0.07, 'triangle'),
  join: () => tone([523, 784]), // rising
  leave: () => tone([784, 523]), // falling
  connectionLost: () => tone([440, 330, 220], 0.13, 0.07, 'triangle'),
  connectionRestored: () => tone([440, 587, 880], 0.11, 0.07, 'triangle'),
  mute: () => tone([392], 0.06, 0.05),
  unmute: () => tone([587], 0.06, 0.05),
  // A soft two-note "pop": noticeable without being annoying.
  message: () => tone([740, 1110], 0.07, 0.07, 'triangle'),
  privateMessage: () => tone([659, 880, 659], 0.085, 0.075, 'sine'),
};

/** Volume of the door knock: a quarter of the recording's, so it's subtle (peaks ~-14 dB). */
const KNOCK_VOLUME = 0.25;
let knockBuffer: Promise<AudioBuffer> | null = null;

/** Someone knocking on a door (a binaural recording: on headphones it sounds like it's in the room). */
export function playKnock() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const audio = ctx;
    knockBuffer ??= fetch(knockUrl)
      .then((res) => res.arrayBuffer())
      .then((bytes) => audio.decodeAudioData(bytes));
    knockBuffer
      .then((buffer) => {
        const source = audio.createBufferSource();
        const gain = audio.createGain();
        source.buffer = buffer;
        gain.gain.value = KNOCK_VOLUME;
        source.connect(gain).connect(audio.destination);
        source.start();
      })
      .catch(() => {
        knockBuffer = null; // try loading again next time
      });
  } catch {
    /* audio not available */
  }
}
