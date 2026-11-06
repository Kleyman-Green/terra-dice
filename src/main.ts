import './style.css';
import {
  CARD_INFO,
  DEFAULT_COLORS,
  applyMove,
  chooseDice,
  createGame,
  currentMoves,
  pickOffer,
  playCard,
  ranking,
  rollDice,
  setPlayerInfo,
  skipTurn,
} from './core/game';
import type { CardId, ConfigInput, GameState, Placement } from './core/types';
import { createGuest, createHost, makeCode } from './net';
import type { ClientMsg, GuestLink, HostLink, HostMsg } from './net';
import { isMuted, setMuted, sounds } from './sound';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;

type Mode = 'local' | 'host' | 'guest';
let mode: Mode = 'local';
let mySeat = 0;
let started = false;
let hostLink: HostLink | null = null;
let guestLink: GuestLink | null = null;
let hostConfig: ConfigInput = { width: 12, height: 12, players: 2 };

let state: GameState;
let cell = 40;
let rotated = false;
let hover: { x: number; y: number } | null = null;
let message = '';

let myNick = '';
let myColor = DEFAULT_COLORS[0];
let joinColor = DEFAULT_COLORS[1];
let selectedCard: CardId | null = null;

let botEnabled = false;
let botTimer: number | null = null;
let ratingSaved = false;
let diceKey = '';
let diceAnimTimer: number | null = null;

let roomCode: string | null = null;
let roomFull = false;
let reconnectTimer: number | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
}

function myTurn(): boolean {
  return started && !state.finished && (mode === 'local' || state.current === mySeat);
}

function noRotateNow(): boolean {
  return state.pending.some((e) => e.card === 'block' && e.target === state.current);
}

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

function same(a: Placement, b: Placement): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function isLegal(p: Placement): boolean {
  return currentMoves(state).some((m) => same(m, p));
}

// ---------- отрисовка ----------
function draw(): void {
  if (!started) return;
  const { width, height } = state.config;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // бонусные клетки
  ctx.font = `${Math.floor(cell * 0.6)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d4a017';
  for (const idx of state.bonus) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    ctx.fillText('★', x * cell + cell / 2, y * cell + cell / 2 + 1);
  }

  // территории
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const v = state.board[j * width + i];
      if (v) {
        ctx.fillStyle = state.players[v - 1].color;
        ctx.fillRect(i * cell, j * cell, cell, cell);
      }
    }
  }

  // сетка
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

  // стены — жирные грани
  if (state.walls.length) {
    const vCount = (width - 1) * height;
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = Math.max(3, Math.floor(cell * 0.14));
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const w of state.walls) {
      if (w < vCount) {
        const x = w % (width - 1);
        const y = Math.floor(w / (width - 1));
        ctx.moveTo((x + 1) * cell, y * cell + 2);
        ctx.lineTo((x + 1) * cell, (y + 1) * cell - 2);
      } else {
        const hId = w - vCount;
        const x = hId % width;
        const y = Math.floor(hId / width);
        ctx.moveTo(x * cell + 2, (y + 1) * cell);
        ctx.lineTo((x + 1) * cell - 2, (y + 1) * cell);
      }
    }
    ctx.stroke();
  }

  // предпросмотр блока
  const p = myTurn() && state.dice ? previewPlacement() : null;
  if (p) {
    const legal = isLegal(p);
    const color = state.players[state.current - 1].color;
    ctx.globalAlpha = legal ? 0.55 : 0.2;
    ctx.fillStyle = legal ? color : '#444';
    ctx.fillRect(p.x * cell, p.y * cell, p.w * cell, p.h * cell);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    if (legal) {
      ctx.strokeStyle = color;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = '#d33';
      ctx.setLineDash([6, 4]);
    }
    ctx.strokeRect(p.x * cell, p.y * cell, p.w * cell, p.h * cell);
    ctx.setLineDash([]);
  }
}

// ---------- интерфейс ----------
function loadRating(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('terra-dice-rating') ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function saveWin(nick: string): void {
  const r = loadRating();
  r[nick] = (r[nick] ?? 0) + 1;
  localStorage.setItem('terra-dice-rating', JSON.stringify(r));
}

function ratingText(): string {
  const top = Object.entries(loadRating())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (!top.length) return '';
  return 'Рейтинг побед: ' + top.map(([n, w]) => `${esc(n)} — ${w}`).join(', ');
}

function animateDice(final: [number, number]): void {
  const d1 = $('die1');
  const d2 = $('die2');
  if (diceAnimTimer) clearInterval(diceAnimTimer);
  d1.classList.add('rolling');
  d2.classList.add('rolling');
  sounds.roll();
  let ticks = 0;
  diceAnimTimer = window.setInterval(() => {
    d1.textContent = String(Math.floor(Math.random() * 6) + 1);
    d2.textContent = String(Math.floor(Math.random() * 6) + 1);
    if (++ticks >= 8) {
      clearInterval(diceAnimTimer!);
      diceAnimTimer = null;
      d1.classList.remove('rolling');
      d2.classList.remove('rolling');
      d1.textContent = String(final[0]);
      d2.textContent = String(final[1]);
    }
  }, 70);
}

function updateTimer(): void {
  const el = $('timer');
  if (!state?.deadline || state.finished) {
    el.textContent = '';
    el.classList.remove('low');
    return;
  }
  const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  el.textContent = `⏱ ${left}с`;
  el.classList.toggle('low', left <= 5);
}

function cardButton(card: CardId, label: string, onClick: () => void): HTMLElement {
  const div = document.createElement('div');
  div.className = 'card';
  const info = CARD_INFO[card];
  div.innerHTML = `<b>${info.name}</b><span>${info.text}</span>`;
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  div.appendChild(btn);
  return div;
}

function updatePanels(): void {
  // выбор 1 из 3 карт в начале хода
  const offer = $('offer');
  offer.innerHTML = '';
  if (state.offer && myTurn() && !state.finished) {
    offer.hidden = false;
    offer.append('Выберите карту:');
    for (const c of state.offer) {
      offer.appendChild(cardButton(c, 'Взять', () => onPick(c)));
    }
  } else {
    offer.hidden = true;
  }

  // выбор 2 из 3 кубиков («третий куб»)
  const choice = $('choice');
  choice.innerHTML = '';
  if (state.diceChoice && myTurn() && !state.finished) {
    choice.hidden = false;
    choice.append('Третий куб: уберите лишний —');
    state.diceChoice.forEach((v, i) => {
      const b = document.createElement('button');
      b.textContent = `Убрать ${v}`;
      b.addEventListener('click', () => onChoose(i));
      choice.appendChild(b);
    });
  } else {
    choice.hidden = true;
  }

  // рука карт
  const hand = $('hand');
  hand.innerHTML = '';
  const seat = mode === 'local' ? state.current : mySeat;
  const cards = state.hands[seat - 1] ?? [];
  const canPlay = myTurn() && !state.offer && !state.dice && !state.diceChoice && !state.finished;
  for (const c of cards) {
    const div = cardButton(c, 'Сыграть', () => {
      if (CARD_INFO[c].needsTarget) {
        selectedCard = c;
        updatePanels();
      } else {
        onPlay(c);
      }
    });
    div.querySelector('button')!.disabled = !canPlay;
    hand.appendChild(div);
  }

  // выбор цели для карты
  const targets = $('targets');
  targets.innerHTML = '';
  if (selectedCard && canPlay) {
    targets.hidden = false;
    targets.append(`${CARD_INFO[selectedCard].name} — цель:`);
    for (let s = 1; s <= state.config.players; s++) {
      if (selectedCard !== 'double' && s === state.current) continue;
      if (selectedCard === 'thief' && state.hands[s - 1].length === 0) continue;
      const b = document.createElement('button');
      const p = state.players[s - 1];
      b.textContent = p.nick;
      b.style.borderColor = p.color;
      b.addEventListener('click', () => {
        const card = selectedCard!;
        selectedCard = null;
        onPlay(card, s);
      });
      targets.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.textContent = 'Отмена';
    cancel.addEventListener('click', () => {
      selectedCard = null;
      updatePanels();
    });
    targets.appendChild(cancel);
  } else {
    targets.hidden = true;
  }
}

function updateUI(): void {
  const r = ranking(state);
  const scores = state.players
    .map((p, i) => `<b style="background:${p.color}">${esc(p.nick)}</b>: ${r.scores[i]}`)
    .join(' | ');

  let text: string;
  if (state.finished) {
    if (!ratingSaved) {
      ratingSaved = true;
      sounds.win();
      if (!r.isDraw) saveWin(state.players[r.places.indexOf(1)].nick);
    }
    text = r.isDraw
      ? 'Игра окончена: НИЧЬЯ'
      : `Игра окончена: победа — ${esc(state.players[r.places.indexOf(1)].nick)}`;
    if (state.config.players > 2) {
      text +=
        ' (места: ' +
        r.places.map((p, i) => `${esc(state.players[i].nick)} — ${p}`).join(', ') +
        ')';
    }
    const rt = ratingText();
    if (rt) text += `<br><small>${rt}</small>`;
  } else {
    const p = state.players[state.current - 1];
    text = `Ход: <b style="color:${p.color}">${esc(p.nick)}</b>`;
  }
  const you = mode === 'local' ? '' : ` | Вы — ${esc(state.players[mySeat - 1]?.nick ?? '?')}${myTurn() ? ' (ваш ход)' : ''}`;

  $('status').innerHTML = `${text}${you}<br><small class="scores">${scores} | без постановок подряд: ${state.idleTurns}</small>`;
  $('message').textContent = message;

  // кубики
  const d1 = $('die1');
  const d2 = $('die2');
  if (state.dice) {
    d1.hidden = false;
    d2.hidden = false;
    const key = state.dice.join(',');
    if (key !== diceKey) {
      diceKey = key;
      animateDice(state.dice);
    } else if (!diceAnimTimer) {
      d1.textContent = String(state.dice[0]);
      d2.textContent = String(state.dice[1]);
    }
  } else {
    diceKey = '';
    d1.hidden = true;
    d2.hidden = true;
  }

  updateTimer();
  updatePanels();

  $<HTMLButtonElement>('btnRoll').disabled =
    !myTurn() || state.dice !== null || state.offer !== null || state.diceChoice !== null;
  $<HTMLButtonElement>('btnRotate').disabled =
    !myTurn() || !state.dice || state.dice[0] === state.dice[1] || noRotateNow();
  draw();
}

function publish(): void {
  rotated = false;
  selectedCard = null;
  updateUI();
  if (mode === 'host') hostLink?.broadcast({ t: 'state', state, message });
  scheduleBot();
}

// ---------- ходы (локально и хозяин) ----------
function attempt(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    message = (e as Error).message;
    sounds.error();
    updateUI();
  }
}

function afterRoll(): void {
  if (!state.diceChoice && currentMoves(state).length === 0) {
    const [a, b] = state.dice!;
    message = `${state.players[state.current - 1].nick}: выпало ${a}×${b} — места нет, ход переходит дальше`;
    state = skipTurn(state);
  } else {
    message = '';
  }
}

function doRoll(): void {
  state = rollDice(state);
  afterRoll();
  publish();
}

function doChoose(drop: number): void {
  state = chooseDice(state, drop);
  afterRoll();
  publish();
}

function doPlace(p: Placement): void {
  state = applyMove(state, p);
  message = '';
  sounds.place();
  publish();
}

function doPick(card: CardId): void {
  state = pickOffer(state, card);
  sounds.card();
  message = '';
  publish();
}

function doPlay(card: CardId, target?: number): void {
  state = playCard(state, card, target);
  sounds.card();
  message = card === 'thief' ? 'Карта украдена!' : '';
  publish();
}

// гостевые обёртки: отправляем действие хозяину
function onRoll(): void {
  if (!myTurn() || state.dice || state.offer || state.diceChoice) return;
  if (mode === 'guest') guestLink?.send({ t: 'roll' });
  else attempt(doRoll);
}

function onChoose(drop: number): void {
  if (mode === 'guest') guestLink?.send({ t: 'choose', drop });
  else attempt(() => doChoose(drop));
}

function onPick(card: CardId): void {
  if (mode === 'guest') guestLink?.send({ t: 'pick', card });
  else attempt(() => doPick(card));
}

function onPlay(card: CardId, target?: number): void {
  if (mode === 'guest') guestLink?.send({ t: 'play', card, target });
  else attempt(() => doPlay(card, target));
}

function onRotate(): void {
  if (!myTurn() || !state.dice || noRotateNow()) return;
  rotated = !rotated;
  draw();
}

// ---------- бот ----------
function greedy(moves: Placement[]): Placement {
  const { width } = state.config;
  let best = moves[0];
  let bestScore = -1;
  for (const m of moves) {
    let score = Math.random() * 0.5;
    for (let j = m.y; j < m.y + m.h; j++)
      for (let i = m.x; i < m.x + m.w; i++) if (state.bonus.includes(j * width + i)) score += 2;
    score += m.w * m.h * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

function scheduleBot(): void {
  if (botTimer) {
    clearTimeout(botTimer);
    botTimer = null;
  }
  if (mode !== 'local' || !botEnabled || !started || state.finished || state.current !== 2) return;
  botTimer = window.setTimeout(botStep, 800);
}

function botStep(): void {
  if (!(mode === 'local' && botEnabled && started && !state.finished && state.current === 2)) return;
  attempt(() => {
    if (state.offer) {
      doPick(state.offer[Math.floor(Math.random() * state.offer.length)]);
      return;
    }
    if (!state.dice && !state.diceChoice) {
      const hand = state.hands[1];
      if (hand.includes('third')) doPlay('third');
      else if (hand.includes('double')) doPlay('double', 2);
      else if (hand.includes('block')) doPlay('block', 1);
      else if (hand.includes('thief') && state.hands[0].length > 0) doPlay('thief', 1);
      else doRoll();
      return;
    }
    if (state.diceChoice) {
      doChoose(Math.floor(Math.random() * 3));
      return;
    }
    const moves = currentMoves(state);
    if (moves.length) doPlace(greedy(moves));
  });
}

// ---------- таймер хода (источник истины — хозяин/локально) ----------
function forceTimeout(): void {
  const nick = state.players[state.current - 1].nick;
  attempt(() => {
    if (state.offer) doPick(state.offer[Math.floor(Math.random() * state.offer.length)]);
    else if (state.diceChoice) doChoose(Math.floor(Math.random() * 3));
    else if (!state.dice) doRoll();
    else {
      const moves = currentMoves(state);
      if (moves.length) doPlace(greedy(moves));
    }
  });
  message = message ? `${message} (у ${nick} вышло время)` : `У ${nick} вышло время — ход автоматически`;
  publish();
}

setInterval(() => {
  if (!started || !state || state.finished) return;
  updateTimer();
  if (mode !== 'guest' && state.deadline && Date.now() >= state.deadline) forceTimeout();
}, 500);

// ---------- онлайн: хозяин ----------
function startHosting(): void {
  mode = 'host';
  mySeat = 1;
  hostConfig = readConfig();
  const code = makeCode();
  const link = `${location.origin}${location.pathname}?room=${code}`;
  const pendingNicks = new Map<number, { nick: string; color: string }>();

  $('setup').hidden = true;
  $('lobby').hidden = false;
  $<HTMLInputElement>('linkField').value = link;
  $('lobbyStatus').textContent = 'Создаём комнату…';

  hostLink = createHost(code, hostConfig.players, {
    onOpen: () => {
      $('lobbyStatus').textContent = `Ждём игроков: 1 из ${hostConfig.players}`;
    },
    onSeatJoined: (seat, total) => {
      if (started) {
        hostLink?.sendTo(seat, { t: 'state', state, message });
        message = `${state.players[seat - 1].nick} подключился`;
        publish();
      } else {
        $('lobbyStatus').textContent = `Ждём игроков: ${total + 1} из ${hostConfig.players}`;
        if (total === hostConfig.players - 1) {
          state = createGame(hostConfig);
          state = setPlayerInfo(state, 1, myNick, myColor);
          for (const [s, info] of pendingNicks) {
            state = setPlayerInfo(state, s, info.nick, info.color);
          }
          message = '';
          setupBoard();
          publish();
        }
      }
    },
    onSeatLeft: (seat) => {
      if (started) {
        message = `${state.players[seat - 1].nick} отключился. Он может вернуться по той же ссылке`;
        publish();
      } else {
        $('lobbyStatus').textContent = 'Игрок вышел, ждём подключения…';
      }
    },
    onAction: (seat: number, msg: ClientMsg) => {
      if (msg.t === 'hello') {
        pendingNicks.set(seat, { nick: msg.nick, color: msg.color });
        if (started) {
          state = setPlayerInfo(state, seat, msg.nick, msg.color);
          publish();
        }
        return;
      }
      if (!started || state.finished || seat !== state.current) return;
      attempt(() => {
        if (msg.t === 'roll' && !state.dice && !state.diceChoice && !state.offer) doRoll();
        else if (msg.t === 'pick' && state.offer) doPick(msg.card);
        else if (msg.t === 'choose' && state.diceChoice) doChoose(msg.drop);
        else if (msg.t === 'place' && state.dice && isLegal(msg.p)) doPlace(msg.p);
        else if (msg.t === 'play') doPlay(msg.card, msg.target);
      });
    },
    onError: (err) => {
      $('lobbyStatus').textContent = `Ошибка сети: ${err}`;
    },
  });
}

// ---------- онлайн: гость ----------
function connectGuest(): void {
  guestLink = createGuest(roomCode!, {
    onOpen: () => {
      if (!started) $('info').textContent = 'Подключено, ждём начала игры…';
    },
    onMsg: (msg: HostMsg) => {
      if (msg.t === 'welcome') {
        mySeat = msg.seat;
        guestLink?.send({ t: 'hello', nick: myNick, color: joinColor });
        if (!started) $('info').textContent = `Вы на месте ${mySeat}. Ждём остальных игроков…`;
      } else if (msg.t === 'full') {
        roomFull = true;
        $('info').textContent = 'В комнате нет свободных мест';
      } else if (msg.t === 'state') {
        state = msg.state;
        message = msg.message;
        if (!started) setupBoard();
        rotated = false;
        selectedCard = null;
        updateUI();
      }
    },
    onClose: () => {
      if (roomFull) return;
      if (started && !state.finished) {
        message = 'Соединение с хозяином потеряно — переподключаемся…';
        $('message').textContent = message;
      } else if (!started) {
        $('info').textContent = 'Соединение потеряно — переподключаемся…';
      }
      scheduleReconnect();
    },
    onError: (err) => {
      $('info').textContent =
        err === 'peer-unavailable' ? 'Комната не найдена — проверьте ссылку' : `Ошибка сети: ${err}`;
    },
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer || roomFull) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    guestLink?.destroy();
    connectGuest();
  }, 3000);
}

function joinAsGuest(): void {
  myNick = $<HTMLInputElement>('joinNick').value.trim();
  $('join').hidden = true;
  mode = 'guest';
  const info = $('info');
  info.hidden = false;
  info.textContent = 'Подключаемся к комнате…';
  connectGuest();
}

// ---------- локальная игра ----------
function startLocal(): void {
  mode = 'local';
  botEnabled = $<HTMLInputElement>('inBot').checked && parseInt($<HTMLSelectElement>('inP').value) === 2;
  state = createGame(readConfig());
  state = setPlayerInfo(state, 1, myNick, myColor);
  if (botEnabled) state = setPlayerInfo(state, 2, 'Бот 🤖', DEFAULT_COLORS[1]);
  message = '';
  setupBoard();
  publish();
}

// ---------- общее ----------
function setupBoard(): void {
  const { width, height } = state.config;
  cell = Math.max(10, Math.min(40, Math.floor(640 / Math.max(width, height))));
  canvas.width = width * cell;
  canvas.height = height * cell;
  rotated = false;
  hover = null;
  started = true;
  ratingSaved = false;
  diceKey = '';
  $('setup').hidden = true;
  $('join').hidden = true;
  $('lobby').hidden = true;
  $('info').hidden = true;
  $('game').hidden = false;
}

function readConfig(): ConfigInput {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v || lo, lo), hi);
  return {
    width: clamp(parseInt($<HTMLInputElement>('inW').value), 4, 40),
    height: clamp(parseInt($<HTMLInputElement>('inH').value), 4, 40),
    players: parseInt($<HTMLSelectElement>('inP').value),
    walls: $<HTMLInputElement>('inWalls').checked,
    wallDensity: parseFloat($<HTMLSelectElement>('inDensity').value),
    cards: $<HTMLInputElement>('inCards').checked,
    turnSeconds: parseInt($<HTMLSelectElement>('inTimer').value),
  };
}

// ---------- выбор цвета ----------
function buildColors(containerId: string, initial: string, onPick: (c: string) => void): void {
  const box = $(containerId);
  for (const c of DEFAULT_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.title = c;
    if (c === initial) b.classList.add('sel');
    b.addEventListener('click', () => {
      box.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      onPick(c);
    });
    box.appendChild(b);
  }
}

buildColors('myColors', myColor, (c) => {
  myColor = c;
});
buildColors('joinColors', joinColor, (c) => {
  joinColor = c;
});

// ---------- ввод ----------
function cellFromEvent(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) * canvas.width) / rect.width;
  const py = ((e.clientY - rect.top) * canvas.height) / rect.height;
  return { x: Math.floor(px / cell), y: Math.floor(py / cell) };
}

canvas.addEventListener('pointermove', (e) => {
  if (!started) return;
  hover = cellFromEvent(e);
  draw();
});

canvas.addEventListener('pointerdown', (e) => {
  if (!myTurn() || !state.dice) return;
  hover = cellFromEvent(e);
  const p = previewPlacement();
  if (p && isLegal(p)) {
    if (mode === 'guest') guestLink?.send({ t: 'place', p });
    else attempt(() => doPlace(p));
  } else {
    message = 'Сюда блок поставить нельзя';
    sounds.error();
    updateUI();
  }
});

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'r' || k === 'к') onRotate();
});

$('btnStart').addEventListener('click', () => {
  myNick = $<HTMLInputElement>('inNick').value.trim();
  startLocal();
});
$('btnHost').addEventListener('click', () => {
  myNick = $<HTMLInputElement>('inNick').value.trim();
  startHosting();
});
$('btnJoin').addEventListener('click', joinAsGuest);
$('btnRoll').addEventListener('click', onRoll);
$('btnRotate').addEventListener('click', onRotate);
$('btnNew').addEventListener('click', () => {
  location.href = location.origin + location.pathname;
});
$('btnCopy').addEventListener('click', () => {
  void navigator.clipboard.writeText($<HTMLInputElement>('linkField').value);
  $('btnCopy').textContent = 'Скопировано';
});
$('btnMute').addEventListener('click', () => {
  setMuted(!isMuted());
  $('btnMute').textContent = isMuted() ? '🔇' : '🔊';
});

const room = new URLSearchParams(location.search).get('room');
if (room) {
  roomCode = room;
  $('setup').hidden = true;
  $('join').hidden = false;
}
