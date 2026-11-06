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

export function knock(strength = 1): void {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    const vol = Math.min(1, Math.max(0, strength));

    // шумовой щелчок — удар пластика
    const dur = 0.06;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100 + vol * 700 + Math.random() * 500;
    f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = Math.min(0.22, 0.025 + vol * 0.06);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t0);

    // низкий глухой стук о стол
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170 + vol * 40, t0);
    o.frequency.exponentialRampToValueAtTime(65, t0 + 0.08);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(Math.min(0.16, 0.02 + vol * 0.05), t0);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    o.connect(g2).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.1);
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
