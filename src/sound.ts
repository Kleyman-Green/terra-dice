// Простые синтезированные звуки через WebAudio, без файлов
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean): void {
  muted = m;
}

export function isMuted(): boolean {
  return muted;
}

function beep(freq: number, dur: number, type: OscillatorType = 'sine', delay = 0, gain = 0.07): void {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur);
  } catch {
    // звук недоступен — не мешаем игре
  }
}

export const sounds = {
  roll(): void {
    beep(500, 0.07, 'square');
    beep(700, 0.07, 'square', 0.08);
    beep(950, 0.09, 'square', 0.16);
  },
  place(): void {
    beep(220, 0.12, 'triangle');
    beep(330, 0.14, 'triangle', 0.07);
  },
  error(): void {
    beep(150, 0.18, 'sawtooth', 0, 0.04);
  },
  card(): void {
    beep(880, 0.08);
    beep(1174, 0.12, 'sine', 0.08);
  },
  win(): void {
    [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.18, 'triangle', i * 0.13));
  },
};
