// 3D-кубики, «брошенные на стол»: CSS-куб + Web Animations API
const SIZE = 56;
const HALF = SIZE / 2;

// как развернуть куб, чтобы нужная грань смотрела на игрока
const FACE_ROT: Record<number, string> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(90deg)',
  3: 'rotateY(-90deg)',
  4: 'rotateY(90deg)',
  5: 'rotateX(-90deg)',
  6: 'rotateY(180deg)',
};

const PIPS: Record<number, string[]> = {
  1: ['c'],
  2: ['tl', 'br'],
  3: ['tl', 'c', 'br'],
  4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'c', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};

// размещение граней куба
const FACE_POS: [number, string][] = [
  [1, 'rotateY(0deg)'],
  [6, 'rotateY(180deg)'],
  [3, 'rotateY(90deg)'],
  [4, 'rotateY(-90deg)'],
  [5, 'rotateX(90deg)'],
  [2, 'rotateX(-90deg)'],
];

let layer: HTMLElement | null = null;

function getLayer(): HTMLElement {
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'diceLayer';
    document.body.appendChild(layer);
  }
  return layer;
}

function buildCube(value: number): HTMLElement {
  const cube = document.createElement('div');
  cube.className = 'cube3d';
  for (const [faceValue, pos] of FACE_POS) {
    const face = document.createElement('div');
    face.className = 'face3d';
    face.style.transform = `${pos} translateZ(${HALF}px)`;
    if (faceValue === 1 && value > 6) {
      // грань удвоенного кубика — просто крупная цифра
      const n = document.createElement('span');
      n.className = 'face-num';
      n.textContent = String(value);
      face.appendChild(n);
    } else {
      for (const cls of PIPS[faceValue]) {
        const pip = document.createElement('span');
        pip.className = `pip ${cls}`;
        face.appendChild(pip);
      }
    }
    cube.appendChild(face);
  }
  return cube;
}

export function throwDice(values: [number, number]): void {
  clearDice(true);
  const host = getLayer();
  const board = document.getElementById('board');
  const r = board?.getBoundingClientRect();

  values.forEach((v, i) => {
    const cube = buildCube(v);
    host.appendChild(cube);

    const areaW = (r?.width ?? 300) - SIZE - 24;
    const areaH = (r?.height ?? 300) - SIZE - 24;
    const lx = (r ? r.left : window.innerWidth / 2 - 150) + 12 + Math.random() * areaW;
    const ly = (r ? r.top : window.innerHeight / 2 - 150) + 12 + Math.random() * areaH;

    const base = v <= 6 ? FACE_ROT[v] : 'rotateX(0deg) rotateY(0deg)';
    const sx = 720 + Math.floor(Math.random() * 3) * 360;
    const sy = 720 + Math.floor(Math.random() * 3) * 360;
    const tilt = Math.random() * 30 - 15;
    const orient = `rotateZ(${tilt}deg) ${base} rotateX(${sx}deg) rotateY(${sy}deg)`;

    const x0 = lx + (Math.random() * 240 - 120);
    const y0 = -160 - i * 70;

    cube.animate(
      [
        { transform: `translate(${x0}px, ${y0}px)`, opacity: 0.5 },
        { transform: `translate(${lx}px, ${ly}px) ${orient} scale(1.12, 0.85)`, offset: 0.72 },
        { transform: `translate(${lx}px, ${ly - 26}px) ${orient}`, offset: 0.86 },
        { transform: `translate(${lx}px, ${ly}px) ${orient}` },
      ],
      {
        duration: 950 + i * 140,
        easing: 'cubic-bezier(.2,.7,.3,1)',
        fill: 'forwards',
      },
    );
  });
}

export function clearDice(instant = false): void {
  if (!layer) return;
  for (const el of [...layer.children]) {
    if (instant) {
      el.remove();
    } else {
      const a = (el as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 350,
        fill: 'forwards',
      });
      a.onfinish = () => el.remove();
    }
  }
}
