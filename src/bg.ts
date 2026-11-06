// Фон «лава-лампа»: тёмно-синий градиент и аморфные шары,
// медленно всплывающие вверх и слегка отталкивающиеся от курсора
type Blob = {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  hue: number;
  phase: number;
  wob: number;
};

export function startLava(): void {
  const cv = document.createElement('canvas');
  cv.id = 'lava';
  document.body.prepend(cv);
  const c = cv.getContext('2d')!;

  let w = 0;
  let h = 0;
  const resize = (): void => {
    w = cv.width = window.innerWidth;
    h = cv.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const mouse = { x: -9999, y: -9999 };
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  const blobs: Blob[] = [];
  for (let i = 0; i < 12; i++) {
    blobs.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: 50 + Math.random() * 90,
      vy: -(10 + Math.random() * 18), // всплытие, px/с
      vx: (Math.random() - 0.5) * 8,
      hue: 205 + Math.random() * 55, // от голубого до фиолетового
      phase: Math.random() * Math.PI * 2,
      wob: 0.4 + Math.random() * 0.8,
    });
  }

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#070d2b');
    bg.addColorStop(0.6, '#0d1b4c');
    bg.addColorStop(1, '#101f5c');
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    c.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      // дрейф и всплытие
      b.phase += b.wob * dt;
      b.x += (b.vx + Math.sin(b.phase) * 12) * dt;
      b.y += b.vy * dt;

      // отталкивание от курсора
      const dx = b.x - mouse.x;
      const dy = b.y - mouse.y;
      const d = Math.hypot(dx, dy);
      const R = 170;
      if (d < R && d > 0.1) {
        const f = ((R - d) / R) * 260 * dt;
        b.x += (dx / d) * f;
        b.y += (dy / d) * f;
      }

      // всплыл — начинаем снизу
      if (b.y < -b.r) {
        b.y = h + b.r;
        b.x = Math.random() * w;
      }
      if (b.x < -b.r) b.x = w + b.r;
      if (b.x > w + b.r) b.x = -b.r;

      const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, `hsla(${b.hue}, 85%, 62%, 0.5)`);
      g.addColorStop(0.7, `hsla(${b.hue}, 80%, 50%, 0.18)`);
      g.addColorStop(1, 'hsla(220, 80%, 50%, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      c.fill();
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
