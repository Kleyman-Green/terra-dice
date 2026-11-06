// Фон «лава-лампа»: настоящие метаболы. Рисуем поле пузырей
// в маленький буфер, пороговым фильтром по альфе получаем чёткие края,
// растягиваем на весь экран. Пузыри разных размеров и скоростей
// всплывают снизу вверх, сливаются и отталкиваются от курсора.
type Blob = {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  color: string;
  phase: number;
  wob: number;
};

const PALETTE = ['#e6c396', '#de4c71', '#4a5aff'];
const SCALE = 3; // буфер в 3 раза меньше экрана
const THRESHOLD = 130; // порог альфы для «тела» пузыря

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

  const spawn = (anywhereY: boolean): Blob => {
    const r = 14 + Math.random() * 52; // разные размеры
    return {
      x: Math.random() * w,
      y: anywhereY ? Math.random() * h : h + r * 2,
      r,
      vy: -(8 + Math.random() * 22) * (70 / (r + 30)), // маленькие быстрее
      vx: (Math.random() - 0.5) * 5,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      phase: Math.random() * Math.PI * 2,
      wob: 0.3 + Math.random() * 0.8,
    };
  };

  const blobs: Blob[] = [];
  for (let i = 0; i < 20; i++) blobs.push(spawn(true));

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    lctx.clearRect(0, 0, low.width, low.height);

    for (const b of blobs) {
      b.phase += b.wob * dt;
      b.x += (b.vx + Math.sin(b.phase) * 9) * dt;
      b.y += b.vy * dt;

      // отталкивание от курсора
      const dx = b.x - mouse.x;
      const dy = b.y - mouse.y;
      const d = Math.hypot(dx, dy);
      const R = 140 + b.r;
      if (d < R && d > 0.1) {
        const f = ((R - d) / R) * 190 * dt;
        b.x += (dx / d) * f;
        b.y += (dy / d) * f;
      }

      if (b.y < -b.r * 2.2) Object.assign(b, spawn(false));
      if (b.x < -b.r * 2) b.x = w + b.r * 2;
      if (b.x > w + b.r * 2) b.x = -b.r * 2;

      // поле пузыря: ядро плотное, хвост длинный — для слияния
      const lx = b.x / SCALE;
      const ly = b.y / SCALE;
      const lr = (b.r * 1.6) / SCALE;
      const g = lctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
      g.addColorStop(0, b.color);
      g.addColorStop(0.6, b.color + 'bb');
      g.addColorStop(1, b.color + '00');
      lctx.fillStyle = g;
      lctx.beginPath();
      lctx.arc(lx, ly, lr, 0, Math.PI * 2);
      lctx.fill();
    }

    // пороговый фильтр: альфа выше порога — тело пузыря с чётким краем
    const img = lctx.getImageData(0, 0, low.width, low.height);
    const data = img.data;
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i];
      data[i] = a <= THRESHOLD - 25 ? 0 : a >= THRESHOLD + 25 ? 255 : ((a - (THRESHOLD - 25)) / 50) * 255;
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
