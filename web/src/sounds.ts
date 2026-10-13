// Tiny synthesized UI sounds (no audio files): someone joins, leaves, you mute/unmute.

let ctx: AudioContext | null = null;

function tone(freqs: number[], step = 0.09, volume = 0.08) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
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
  join: () => tone([523, 784]), // rising
  leave: () => tone([784, 523]), // falling
  mute: () => tone([392], 0.06, 0.05),
  unmute: () => tone([587], 0.06, 0.05),
  message: () => tone([880], 0.05, 0.04),
};
