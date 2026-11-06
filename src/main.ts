import './style.css';
import { applyMove, createGame, currentMoves, ranking, rollDice, skipTurn } from './core/game';
import type { GameState, Placement } from './core/types';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;

let state: GameState;
let cell = 40;
let rotated = false;
let hover: { x: number; y: number } | null = null;
let message = '';

function diceSize(): { w: number; h: number } | null {
  if (!state.dice) return null;
  const [a, b] = state.dice;
  return rotated ? { w: b, h: a } : { w: a, h: b };
}

function previewPlacement(): Placement | null {
  const s = diceSize();
  if (!s || !hover) return null;
  const { width, height } = state.config;
  const x = Math.min(Math.max(hover.x, 0), width - s.w);
  const y = Math.min(Math.max(hover.y, 0), height - s.h);
  if (x < 0 || y < 0) return null;
  return { x, y, w: s.w, h: s.h };
}

function isLegal(p: Placement): boolean {
  return currentMoves(state).some(
    (m) => m.x === p.x && m.y === p.y && m.w === p.w && m.h === p.h,
  );
}

function draw(): void {
  const { width, height } = state.config;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const v = state.board[j * width + i];
      if (v) {
        ctx.fillStyle = COLORS[v - 1];
        ctx.fillRect(i * cell, j * cell, cell, cell);
      }
    }
  }

  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= width; i++) {
    ctx.moveTo(i * cell + 0.5, 0);
    ctx.lineTo(i * cell + 0.5, height * cell);
  }
  for (let j = 0; j <= height; j++) {
    ctx.moveTo(0, j * cell + 0.5);
    ctx.lineTo(width * cell, j * cell + 0.5);
  }
  ctx.stroke();

  const p = previewPlacement();
  if (p && !state.finished) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = isLegal(p) ? COLORS[state.current - 1] : '#444';
    ctx.fillRect(p.x * cell, p.y * cell, p.w * cell, p.h * cell);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x * cell, p.y * cell, p.w * cell, p.h * cell);
  }
}

function updateUI(): void {
  const r = ranking(state);
  const scores = r.scores.map((s, i) => `Игрок ${i + 1}: ${s}`).join(' | ');
  let text: string;

  if (state.finished) {
    if (r.isDraw) {
      text = 'Игра окончена: НИЧЬЯ';
    } else {
      text = `Игра окончена: ПОБЕДА ИГРОКА ${r.places.indexOf(1) + 1}`;
    }
    if (state.config.players > 2) {
      text += ' (места: ' + r.places.map((p, i) => `И${i + 1} — ${p}`).join(', ') + ')';
    }
  } else {
    const dice = state.dice ? ` | Кубики: ${state.dice[0]} и ${state.dice[1]}` : '';
    text = `Ход игрока ${state.current}${dice}`;
  }

  $('status').innerHTML = `${text}<br><small>${scores} | без постановок подряд: ${state.idleTurns}</small>`;
  $('message').textContent = message;
  $<HTMLButtonElement>('btnRoll').disabled = state.finished || state.dice !== null;
  $<HTMLButtonElement>('btnRotate').disabled =
    state.finished || !state.dice || state.dice[0] === state.dice[1];
  draw();
}

function startGame(): void {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v || lo, lo), hi);
  const width = clamp(parseInt($<HTMLInputElement>('inW').value), 4, 40);
  const height = clamp(parseInt($<HTMLInputElement>('inH').value), 4, 40);
  const players = parseInt($<HTMLSelectElement>('inP').value);

  state = createGame({ width, height, players });
  cell = Math.max(10, Math.min(40, Math.floor(640 / Math.max(width, height))));
  canvas.width = width * cell;
  canvas.height = height * cell;
  rotated = false;
  hover = null;
  message = '';

  $('setup').hidden = true;
  $('game').hidden = false;
  updateUI();
}

function onRoll(): void {
  state = rollDice(state);
  rotated = false;
  if (currentMoves(state).length === 0) {
    const [a, b] = state.dice!;
    message = `Игроку ${state.current} выпало ${a}×${b} — места нет, ход переходит дальше`;
    state = skipTurn(state);
  } else {
    message = '';
  }
  updateUI();
}

function onRotate(): void {
  if (!state.dice || state.finished) return;
  rotated = !rotated;
  draw();
}

function cellFromEvent(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) * canvas.width) / rect.width;
  const py = ((e.clientY - rect.top) * canvas.height) / rect.height;
  return { x: Math.floor(px / cell), y: Math.floor(py / cell) };
}

canvas.addEventListener('pointermove', (e) => {
  hover = cellFromEvent(e);
  draw();
});

canvas.addEventListener('pointerdown', (e) => {
  if (state.finished || !state.dice) return;
  hover = cellFromEvent(e);
  const p = previewPlacement();
  if (p && isLegal(p)) {
    state = applyMove(state, p);
    message = '';
    updateUI();
  } else {
    message = 'Сюда блок поставить нельзя';
    updateUI();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'к') onRotate();
});

$('btnStart').addEventListener('click', startGame);
$('btnRoll').addEventListener('click', onRoll);
$('btnRotate').addEventListener('click', onRotate);
$('btnNew').addEventListener('click', () => {
  $('game').hidden = true;
  $('setup').hidden = false;
});