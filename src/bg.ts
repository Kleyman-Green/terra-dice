// Фон «лава-лампа»: настоящие метаболы. Рисуем поле пузырей
// в маленький буфер, пороговым фильтром по альфе получаем чёткие края,
// растягиваем на весь экран. Каждый пузырь — не шар, а амёба из
// нескольких долей, которые медленно «перетекают» друг в друга.
// Пузыри разных размеров и скоростей всплывают снизу вверх, сливаются
// и отталкиваются от курсора.
type Lobe = {
  dist: number; // доля радиуса — дальность доли от центра
  size: number; // доля радиуса — размер доли
  angle: number; // текущий угол орбиты доли
  speed: number; // скорость обхода (рад/с), бывает отрицательной
};

type Blob = {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  color: string;
  squash: number; // вертикальное сплющивание, медленно дышит
  squashSpeed: number;
  phase: number;
  lobes: Lobe[];
};

// тёплые и светлые пятна на глубоком синем
const PALETTE = ['#e6c396', '#de4c71', '#5f7cff', '#f0d9b0'];
const SCALE = 3; // буфер в 3 раза меньше экрана
const THRESHOLD = 128; // порог альфы для «тела» пузыря

export function startLava(): void {
  const cv = document.createElement('canvas');
  cv.id = 'lava';
  document.body.prepend(cv);
  const ctx = cv.getContext('2d')!;

  const low = document.createElement('canvas');
  const lctx = low.getContext('2d', { willReadFrequently: true })!;

  let w = 0;
  let h = 0;
  const resize = (): void => {
    w = cv.width = window.innerWidth;
    h = cv.height = window.innerHeight;
    low.width = Math.ceil(w / SCALE);
    low.height = Math.ceil(h / SCALE);
  };
  resize();
  window.addEventListener('resize', resize);

  const mouse = { x: -9999, y: -9999 };
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  const makeLobes = (): Lobe[] => {
    const n = 3 + Math.floor(Math.random() * 2); // 3–4 доли
    const lobes: Lobe[] = [];
    for (let i = 0; i < n; i++) {
      lobes.push({
        dist: 0.35 + Math.random() * 0.35,
        size: 0.5 + Math.random() * 0.35,
        angle: (i / n) * Math.PI * 2 + Math.random(),
        speed: (0.15 + Math.random() * 0.35) * (Math.random() < 0.5 ? -1 : 1),
      });
    }
    return lobes;
  };

  const spawn = (anywhereY: boolean): Blob => {
    const r = 22 + Math.random() * 58; // разные размеры
    return {
      x: Math.random() * w,
      y: anywhereY ? Math.random() * h : h + r * 2,
      r,
      vy: -(7 + Math.random() * 20) * (80 / (r + 40)), // маленькие быстрее
      vx: (Math.random() - 0.5) * 6,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      squash: 0.75 + Math.random() * 0.35,
      squashSpeed: (0.2 + Math.random() * 0.4) * (Math.random() < 0.5 ? -1 : 1),
      phase: Math.random() * Math.PI * 2,
      lobes: makeLobes(),
    };
  };

  const blobs: Blob[] = [];
  for (let i = 0; i < 22; i++) blobs.push(spawn(true));

  // рисуем одну «долю» пузыря в поле
  const drawLobe = (x: number, y: number, r: number, color: string): void => {
    const g = lctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(0.55, color + 'cc');
    g.addColorStop(1, color + '00');
    lctx.fillStyle = g;
    lctx.beginPath();
    lctx.arc(x, y, r, 0, Math.PI * 2);
    lctx.fill();
  };

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    lctx.clearRect(0, 0, low.width, low.height);

    for (const b of blobs) {
      b.phase += dt;
      b.squash += b.squashSpeed * dt * 0.25;
      if (b.squash < 0.62 || b.squash > 1.2) b.squashSpeed *= -1;
      b.x += (b.vx + Math.sin(b.phase * 0.7) * 8) * dt;
      b.y += b.vy * dt;

      // отталкивание от курсора
      const dx = b.x - mouse.x;
      const dy = b.y - mouse.y;
      const d = Math.hypot(dx, dy);
      const R = 150 + b.r;
      if (d < R && d > 0.1) {
        const f = ((R - d) / R) * 190 * dt;
        b.x += (dx / d) * f;
        b.y += (dy / d) * f;
      }

      if (b.y < -b.r * 2.2) Object.assign(b, spawn(false));
      if (b.x < -b.r * 2) b.x = w + b.r * 2;
      if (b.x > w + b.r * 2) b.x = -b.r * 2;

      // ядро
      const lr = (b.r * 1.15) / SCALE;
      drawLobe(b.x / SCALE, b.y / SCALE, lr, b.color);
      // доли, ползающие вокруг ядра — отсюда аморфная форма
      for (const l of b.lobes) {
        l.angle += l.speed * dt;
        const ox = Math.cos(l.angle) * b.r * l.dist;
        const oy = Math.sin(l.angle) * b.r * l.dist * b.squash;
        drawLobe((b.x + ox) / SCALE, (b.y + oy) / SCALE, (b.r * l.size) / SCALE, b.color);
      }
    }

    // пороговый фильтр: альфа выше порога — тело пузыря с чётким краем
    const img = lctx.getImageData(0, 0, low.width, low.height);
    const data = img.data;
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i];
      data[i] = a <= THRESHOLD - 22 ? 0 : a >= THRESHOLD + 22 ? 255 : ((a - (THRESHOLD - 22)) / 44) * 255;
    }
    lctx.putImageData(img, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(low, 0, 0, w, h);

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
