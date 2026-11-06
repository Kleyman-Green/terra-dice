// Физические 3D-кубики: Three.js (рендер) + cannon-es (физика).
// Бросок просчитывается заранее невидимо, сколько угодно раз, пока кубики
// сами не лягут на нужные грани — затем найденное катание проигрывается
// покадрово. Никакой видимой докрутки: как упали, так и лежат.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type Frame = { p: [number, number, number]; q: [number, number, number, number] };

type LiveDie = {
  mesh: THREE.Mesh;
  frames: Frame[]; // записанная траектория
};

const DIE = 1.15; // размер кубика в мировых единицах
const SIM_DT = 1 / 60;
const MAX_SIM_FRAMES = 5 * 60; // не дольше 5 секунд симуляции
const MAX_ATTEMPTS = 400;

// локальная ось грани -> её значение
const AXES: [THREE.Vector3, number][] = [
  [new THREE.Vector3(0, 0, 1), 1], // front
  [new THREE.Vector3(0, 0, -1), 6], // back
  [new THREE.Vector3(1, 0, 0), 3], // right
  [new THREE.Vector3(-1, 0, 0), 4], // left
  [new THREE.Vector3(0, 1, 0), 5], // top
  [new THREE.Vector3(0, -1, 0), 2], // bottom
];

let layer: HTMLElement | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let world: CANNON.World | null = null;
let walls: CANNON.Body[] = [];
let dice: LiveDie[] = [];
let playStart = 0;
let raf = 0;
let bounds = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };

// ---------- текстуры граней ----------
const texCache = new Map<string, THREE.CanvasTexture>();

function faceTexture(content: number | string): THREE.CanvasTexture {
  const key = String(content);
  const cached = texCache.get(key);
  if (cached) return cached;

  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;

  // перламутрово-синяя грань с объёмом: яркий центр, глубокие края
  const g = c.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#dde5ff');
  g.addColorStop(0.75, '#93a5ef');
  g.addColorStop(1, '#5e74c9');
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(0, 0, S, S, 30);
  c.fill();

  // внутренняя тень по краю — грань выглядит выпуклой
  const edge = c.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.75);
  edge.addColorStop(0, 'rgba(255,255,255,0)');
  edge.addColorStop(1, 'rgba(40,55,130,0.38)');
  c.fillStyle = edge;
  c.beginPath();
  c.roundRect(0, 0, S, S, 30);
  c.fill();

  // блик сверху слева
  const gl = c.createLinearGradient(0, 0, S * 0.7, S * 0.7);
  gl.addColorStop(0, 'rgba(255,255,255,0.5)');
  gl.addColorStop(0.4, 'rgba(255,255,255,0)');
  c.fillStyle = gl;
  c.beginPath();
  c.roundRect(6, 6, S - 12, S - 12, 26);
  c.fill();

  c.strokeStyle = 'rgba(50, 65, 150, 0.5)';
  c.lineWidth = 5;
  c.beginPath();
  c.roundRect(3, 3, S - 6, S - 6, 28);
  c.stroke();

  if (typeof content === 'string') {
    // удвоенный кубик (7..12): крупная оранжевая цифра
    c.fillStyle = '#ff7d1a';
    c.font = '800 130px Nunito, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(120, 40, 0, 0.4)';
    c.shadowBlur = 8;
    c.fillText(content, S / 2, S / 2 + 6);
  } else {
    const PIPS: Record<number, [number, number][]> = {
      1: [[0.5, 0.5]],
      2: [
        [0.28, 0.28],
        [0.72, 0.72],
      ],
      3: [
        [0.28, 0.28],
        [0.5, 0.5],
        [0.72, 0.72],
      ],
      4: [
        [0.28, 0.28],
        [0.72, 0.28],
        [0.28, 0.72],
        [0.72, 0.72],
      ],
      5: [
        [0.28, 0.28],
        [0.72, 0.28],
        [0.5, 0.5],
        [0.28, 0.72],
        [0.72, 0.72],
      ],
      6: [
        [0.28, 0.28],
        [0.72, 0.28],
        [0.28, 0.5],
        [0.72, 0.5],
        [0.28, 0.72],
        [0.72, 0.72],
      ],
    };
    for (const [px, py] of PIPS[content]) {
      const x = px * S;
      const y = py * S;
      const r = S * 0.088;
      // лунка: тёмный ободок снизу-справа, светлый сверху-слева
      c.fillStyle = 'rgba(60, 70, 140, 0.55)';
      c.beginPath();
      c.arc(x + 2.5, y + 3, r * 1.12, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255, 255, 255, 0.65)';
      c.beginPath();
      c.arc(x - 2, y - 2.5, r * 1.1, 0, Math.PI * 2);
      c.fill();
      // сама точка — светящийся оранжевый
      const pg = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      pg.addColorStop(0, '#ffc46b');
      pg.addColorStop(0.6, '#ff8a1e');
      pg.addColorStop(1, '#e05e00');
      c.shadowColor = 'rgba(255, 122, 20, 0.55)';
      c.shadowBlur = 10;
      c.fillStyle = pg;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// ---------- сцена ----------
function init(): void {
  if (renderer) return;

  layer = document.createElement('div');
  layer.id = 'diceLayer';
  document.body.appendChild(layer);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  layer.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 15, 10);
  camera.lookAt(0, 0, 0.8);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 14, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  scene.add(sun);

  // окружение для красивых отражений на глянце кубиков
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
  world.defaultContactMaterial.restitution = 0.35;
  world.defaultContactMaterial.friction = 0.15;

  // стол: видимая тень + физическая плоскость
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({ opacity: 0.28 }),
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  const floor = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(floor);

  const onResize = (): void => {
    if (!renderer || !camera) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    updateBounds();
  };
  window.addEventListener('resize', onResize);
  onResize();
}

// точка экрана -> точка на плоскости стола (y=0)
function screenToPlane(px: number, py: number): THREE.Vector3 {
  camera!.updateMatrixWorld(true);
  const v = new THREE.Vector3(
    (px / window.innerWidth) * 2 - 1,
    -(py / window.innerHeight) * 2 + 1,
    0.5,
  );
  v.unproject(camera!);
  const dir = v.sub(camera!.position).normalize();
  const t = -camera!.position.y / dir.y;
  return camera!.position.clone().add(dir.multiplyScalar(t));
}

// границы стола = границы доски на экране
function updateBounds(): void {
  const board = document.getElementById('board');
  if (!board || !camera || !world) return;
  const r = board.getBoundingClientRect();
  if (r.width === 0) return;
  // все четыре угла — берём min/max, чтобы не зависеть от порядка
  const pts = [
    screenToPlane(r.left, r.top),
    screenToPlane(r.right, r.top),
    screenToPlane(r.left, r.bottom),
    screenToPlane(r.right, r.bottom),
  ];
  bounds = {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  };

  // пересоздаём невидимые бортики по краям доски
  for (const w of walls) world.removeBody(w);
  walls = [];
  const H = 9; // высокие, чтобы кубики не перелетали
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const halfX = (bounds.maxX - bounds.minX) / 2;
  const halfZ = (bounds.maxZ - bounds.minZ) / 2;
  const defs: [number, number, number, number][] = [
    // [x, z, halfX, halfZ] — левый, правый, верхний, нижний борт
    [bounds.minX - 0.5, cz, 0.5, halfZ + 1],
    [bounds.maxX + 0.5, cz, 0.5, halfZ + 1],
    [cx, bounds.minZ - 0.5, halfX + 1, 0.5],
    [cx, bounds.maxZ + 0.5, halfX + 1, 0.5],
  ];
  for (const [x, z, hx, hz] of defs) {
    const wall = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(hx, H, hz)),
    });
    wall.position.set(x, H / 2, z);
    world.addBody(wall);
    walls.push(wall);
  }
}

function makeMesh(value: number): THREE.Mesh {
  // порядок материалов BoxGeometry: +x, -x, +y, -y, +z, -z
  const front: number | string = value > 6 ? String(value) : 1;
  const mats = [
    faceTexture(3),
    faceTexture(4),
    faceTexture(5),
    faceTexture(2),
    faceTexture(front),
    faceTexture(6),
  ].map(
    (map) =>
      new THREE.MeshPhysicalMaterial({
        map,
        roughness: 0.24,
        metalness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.16,
        envMapIntensity: 0.9,
      }),
  );
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(DIE, DIE, DIE, 5, 0.12), mats);
  mesh.castShadow = true;
  return mesh;
}

function makeBody(fromLeft: boolean): CANNON.Body {
  const body = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Box(new CANNON.Vec3(DIE / 2, DIE / 2, DIE / 2)),
    angularDamping: 0.12,
    linearDamping: 0.06,
  });
  const midZ = (bounds.minZ + bounds.maxZ) / 2;
  const spanZ = bounds.maxZ - bounds.minZ;
  body.position.set(
    fromLeft ? bounds.minX + DIE * 0.8 : bounds.maxX - DIE * 0.8,
    1.1 + Math.random() * 0.7,
    midZ + (Math.random() - 0.5) * spanZ * 0.5,
  );
  body.quaternion.setFromEuler(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  );
  const speed = 6 + Math.random() * 2.5;
  body.velocity.set(
    fromLeft ? speed : -speed,
    0.4 + Math.random() * 1.0,
    (Math.random() - 0.5) * 3,
  );
  body.angularVelocity.set(
    (Math.random() - 0.5) * 30,
    (Math.random() - 0.5) * 30,
    (Math.random() - 0.5) * 30,
  );
  return body;
}

// значение верхней грани по кватерниону покоя
function topValue(q: CANNON.Quaternion): number {
  const tq = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  let best = 0;
  let by = -2;
  const d = new THREE.Vector3();
  for (const [axis, val] of AXES) {
    d.copy(axis).applyQuaternion(tq);
    if (d.y > by) {
      by = d.y;
      best = val;
    }
  }
  return best;
}

// легла ли пара кубиков на нужные грани.
// Порядок не важен: фишка a×b — прямоугольник, ему всё равно,
// какой кубик показал длину, а какой ширину.
function facesMatch(bodies: CANNON.Body[], values: [number, number]): boolean {
  const need = values.map((v) => (v > 6 ? 1 : v)).sort(); // цифра 7..12 живёт на front-грани
  const got = bodies.map((b) => topValue(b.quaternion)).sort();
  return need[0] === got[0] && need[1] === got[1];
}

// прогоняем невидимую симуляцию, пока бросок сам не ляжет как надо,
// и возвращаем записанные траектории
function simulate(values: [number, number]): Frame[][] | null {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const bodies = values.map((_, i) => makeBody(i % 2 === 0));
    for (const b of bodies) world!.addBody(b);

    const tracks: Frame[][] = bodies.map(() => []);
    let stillFrames = 0;
    let settled = false;

    for (let f = 0; f < MAX_SIM_FRAMES; f++) {
      world!.step(SIM_DT);
      bodies.forEach((b, i) => {
        tracks[i].push({
          p: [b.position.x, b.position.y, b.position.z],
          q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
        });
      });
      const still = bodies.every(
        (b) => b.velocity.length() < 0.12 && b.angularVelocity.length() < 0.12,
      );
      stillFrames = still ? stillFrames + 1 : 0;
      if (stillFrames > 18) {
        settled = true;
        break;
      }
    }

    const ok = settled && facesMatch(bodies, values);
    for (const b of bodies) world!.removeBody(b);
    if (ok) return tracks;
  }
  return null;
}

function loop(): void {
  raf = requestAnimationFrame(loop);

  if (dice.length) {
    const f = (performance.now() - playStart) / 1000 / SIM_DT;
    for (const die of dice) {
      const last = die.frames.length - 1;
      const i = Math.min(Math.floor(f), last);
      const k = i >= last ? 0 : Math.min(1, f - i);
      const a = die.frames[i];
      const b = die.frames[Math.min(i + 1, last)];
      die.mesh.position.set(
        a.p[0] + (b.p[0] - a.p[0]) * k,
        a.p[1] + (b.p[1] - a.p[1]) * k,
        a.p[2] + (b.p[2] - a.p[2]) * k,
      );
      die.mesh.quaternion
        .set(a.q[0], a.q[1], a.q[2], a.q[3])
        .slerp(new THREE.Quaternion(b.q[0], b.q[1], b.q[2], b.q[3]), k);
    }
  }

  renderer?.render(scene!, camera!);
}

export function throwDice(values: [number, number]): void {
  init();
  clearDice(true);
  updateBounds();

  const tracks = simulate(values);
  if (!tracks) return; // почти невозможно, но пусть тогда просто не будет анимации

  // привязываем текстуры к траекториям: финальная верхняя грань трека
  // должна совпадать со значением на кубике (порядок значений не важен)
  const tops = tracks.map((t) => {
    const q = t[t.length - 1].q;
    return topValue(new CANNON.Quaternion(q[0], q[1], q[2], q[3]));
  });
  const free = [0, 1];
  dice = values.map((v) => {
    const need = v > 6 ? 1 : v;
    const ti = free.find((i) => tops[i] === need)!;
    free.splice(free.indexOf(ti), 1);
    const mesh = makeMesh(v);
    const first = tracks[ti][0];
    mesh.position.set(...first.p);
    mesh.quaternion.set(...first.q);
    scene!.add(mesh);
    return { mesh, frames: tracks[ti] };
  });

  playStart = performance.now();
  if (!raf) loop();
}

export function clearDice(instant = false): void {
  for (const die of dice) {
    if (instant) {
      scene?.remove(die.mesh);
    } else {
      // быстрое растворение
      const mesh = die.mesh;
      const start = performance.now();
      const fade = (): void => {
        const t = (performance.now() - start) / 300;
        mesh.scale.setScalar(Math.max(0.001, 1 - t));
        if (t < 1) {
          requestAnimationFrame(fade);
        } else {
          scene?.remove(mesh);
        }
      };
      fade();
    }
  }
  dice = [];
}
