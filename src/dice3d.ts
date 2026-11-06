// Физические 3D-кубики: Three.js (рендер) + cannon-es (физика).
// Бросок просчитывается заранее невидимо, сколько угодно раз, пока кубики
// сами не лягут на нужные грани — затем найденное катание проигрывается
// покадрово. Никакой видимой докрутки: как упали, так и лежат.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { knock } from './sound';

type Frame = { p: [number, number, number]; q: [number, number, number, number] };
type Impact = { t: number; v: number }; // удар: время и сила

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
let impacts: Impact[] = [];
let impactIdx = 0;
let playStart = 0;
let raf = 0;
let bounds = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };

// ---------- текстуры граней ----------
const texCache = new Map<string, THREE.CanvasTexture>();

// детерминированный ГПСЧ, чтобы у каждой грани был свой мраморный узор
function mulberry(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// чёрно-красный мрамор с переливами + вдавленная золотая цифра
function faceTexture(value: number): THREE.CanvasTexture {
  const key = String(value);
  const cached = texCache.get(key);
  if (cached) return cached;

  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const rand = mulberry(value * 7919 + 13);

  // тёмная основа — почти чёрная с фиолетовинкой
  const base = c.createLinearGradient(0, 0, S, S);
  base.addColorStop(0, '#1c1420');
  base.addColorStop(0.5, '#120c16');
  base.addColorStop(1, '#1a0f14');
  c.fillStyle = base;
  c.fillRect(0, 0, S, S);

  // красные мраморные прожилки: толстые полупрозрачные мазки
  for (let i = 0; i < 7; i++) {
    const x0 = rand() * S;
    const y0 = rand() * S;
    c.strokeStyle = `rgba(${150 + rand() * 90}, ${18 + rand() * 30}, ${40 + rand() * 35}, ${0.1 + rand() * 0.16})`;
    c.lineWidth = 8 + rand() * 26;
    c.lineCap = 'round';
    c.shadowColor = 'rgba(200, 30, 60, 0.35)';
    c.shadowBlur = 14;
    c.beginPath();
    c.moveTo(x0, y0);
    c.bezierCurveTo(
      x0 + (rand() - 0.5) * S * 1.2,
      y0 + (rand() - 0.5) * S * 1.2,
      rand() * S,
      rand() * S,
      rand() * S,
      rand() * S,
    );
    c.stroke();
  }
  // пара ярких тонких жилок
  c.shadowBlur = 6;
  for (let i = 0; i < 3; i++) {
    c.strokeStyle = `rgba(255, ${70 + rand() * 60}, ${90 + rand() * 60}, ${0.25 + rand() * 0.2})`;
    c.lineWidth = 1.5 + rand() * 2.5;
    c.beginPath();
    c.moveTo(rand() * S, rand() * S);
    c.bezierCurveTo(rand() * S, rand() * S, rand() * S, rand() * S, rand() * S, rand() * S);
    c.stroke();
  }
  c.shadowBlur = 0;

  // объём грани: затемнение по краям, блик сверху
  const edge = c.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.75);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.5)');
  c.fillStyle = edge;
  c.fillRect(0, 0, S, S);
  const sheen = c.createLinearGradient(0, 0, S * 0.6, S * 0.6);
  sheen.addColorStop(0, 'rgba(255, 190, 200, 0.14)');
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
  c.fillStyle = sheen;
  c.fillRect(0, 0, S, S);

  // тонкий золотой ободок грани
  c.strokeStyle = 'rgba(212, 175, 55, 0.4)';
  c.lineWidth = 4;
  c.beginPath();
  c.roundRect(5, 5, S - 10, S - 10, 24);
  c.stroke();

  // вдавленная золотая цифра
  const label = String(value);
  c.font = `900 ${label.length > 1 ? 110 : 150}px Georgia, 'Times New Roman', serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const cx = S / 2;
  const cy = S / 2 + 8;
  // тень углубления (смещена вниз-вправо)
  c.fillStyle = 'rgba(0, 0, 0, 0.9)';
  c.fillText(label, cx + 3, cy + 4);
  // светлый край углубления (смещён вверх-влево)
  c.fillStyle = 'rgba(255, 226, 150, 0.75)';
  c.fillText(label, cx - 2, cy - 2.5);
  // золотое тело цифры с вертикальным переливом
  const gold = c.createLinearGradient(0, cy - 70, 0, cy + 70);
  gold.addColorStop(0, '#8a6a1f');
  gold.addColorStop(0.42, '#f6d97b');
  gold.addColorStop(0.58, '#d4af37');
  gold.addColorStop(1, '#7c5f18');
  c.fillStyle = gold;
  c.fillText(label, cx, cy);

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
  const front = value > 6 ? value : 1; // на front-грани цифра 7..12
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
        roughness: 0.3,
        metalness: 0.3,
        clearcoat: 0.7,
        clearcoatRoughness: 0.28,
        envMapIntensity: 1.1,
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
// и возвращаем записанные траектории вместе с моментами ударов
function simulate(values: [number, number]): { tracks: Frame[][]; impacts: Impact[] } | null {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const bodies = values.map((_, i) => makeBody(i % 2 === 0));
    for (const b of bodies) world!.addBody(b);

    const tracks: Frame[][] = bodies.map(() => []);
    const impacts: Impact[] = [];
    let lastImpactAt = -1;
    const onCollide = (e: { contact: CANNON.ContactEquation }): void => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const t = tracks[0].length * SIM_DT;
      if (v > 1.2 && t - lastImpactAt > 0.07) {
        impacts.push({ t, v });
        lastImpactAt = t;
      }
    };
    world!.addEventListener('collide', onCollide);

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

    world!.removeEventListener('collide', onCollide);
    const ok = settled && facesMatch(bodies, values);
    for (const b of bodies) world!.removeBody(b);
    if (ok) return { tracks, impacts };
  }
  return null;
}

function loop(): void {
  raf = requestAnimationFrame(loop);

  if (dice.length) {
    const pt = (performance.now() - playStart) / 1000;
    const f = pt / SIM_DT;
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
    // звуки ударов точно в моменты столкновений
    while (impactIdx < impacts.length && impacts[impactIdx].t <= pt) {
      knock(impacts[impactIdx].v / 6);
      impactIdx++;
    }
  }

  renderer?.render(scene!, camera!);
}

export function throwDice(values: [number, number]): void {
  init();
  clearDice(true);
  updateBounds();

  const sim = simulate(values);
  if (!sim) return; // почти невозможно, но пусть тогда просто не будет анимации
  const { tracks } = sim;
  impacts = sim.impacts;
  impactIdx = 0;

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
