import type {
  CardId,
  Config,
  ConfigInput,
  GameState,
  PendingEffect,
  Placement,
  Ranking,
} from './types';

export type Rng = () => number;

export const DEFAULT_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];

export const ALL_CARDS: CardId[] = [
  'double',
  'thief',
  'third',
  'block',
  'reroll',
  'extra',
  'weaken',
  'plus',
  'silence',
];

export const CARD_INFO: Record<CardId, { name: string; text: string; needsTarget: boolean }> = {
  double: {
    name: 'Удвоение',
    text: 'У выбранного игрока при следующем броске один кубик ×2',
    needsTarget: true,
  },
  thief: {
    name: 'Вор',
    text: 'Укради случайную карту у выбранного соперника',
    needsTarget: true,
  },
  third: {
    name: 'Третий куб',
    text: 'Брось три кубика и выбери два',
    needsTarget: false,
  },
  block: {
    name: 'Блок',
    text: 'Соперник на следующем ходу не сможет поворачивать прямоугольник',
    needsTarget: true,
  },
  reroll: {
    name: 'Переброс',
    text: 'Перебрось оба кубика заново (играется после броска)',
    needsTarget: false,
  },
  extra: {
    name: 'Двойной ход',
    text: 'После постановки блока ты ходишь ещё раз',
    needsTarget: false,
  },
  weaken: {
    name: 'Обрезка',
    text: 'У соперника при следующем броске один кубик станет 1',
    needsTarget: true,
  },
  plus: {
    name: 'Плюс один',
    text: 'При твоём следующем броске один кубик +1',
    needsTarget: false,
  },
  silence: {
    name: 'Тишина',
    text: 'Соперник не сможет играть карты на следующем ходу',
    needsTarget: true,
  },
};

// Детерминированный генератор случайных чисел (для тестов и повторов)
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeConfig(c: ConfigInput): Config {
  return {
    walls: false,
    wallDensity: 0.15,
    cards: false,
    turnSeconds: 0,
    ...c,
  };
}

export function corner(config: Config, player: number): { x: number; y: number } {
  const r = config.width - 1;
  const b = config.height - 1;
  return [
    { x: 0, y: 0 },
    { x: r, y: b },
    { x: r, y: 0 },
    { x: 0, y: b },
  ][player - 1];
}

// ---------- стены ----------
// Вертикальная стена — грань справа от клетки (x, y), x < width-1.
// Горизонтальная стена — грань снизу от клетки (x, y), y < height-1.
export function wallV(x: number, y: number, width: number): number {
  return y * (width - 1) + x;
}

export function wallH(x: number, y: number, width: number, height: number): number {
  return (width - 1) * height + y * width + x;
}

// Есть ли стена между соседними клетками
export function wallBetween(
  walls: Set<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
): boolean {
  if (nx === x + 1) return walls.has(wallV(x, y, width));
  if (nx === x - 1) return walls.has(wallV(nx, ny, width));
  if (ny === y + 1) return walls.has(wallH(x, y, width, height));
  return walls.has(wallH(nx, ny, width, height));
}

function allInternalEdges(width: number, height: number): number[] {
  const edges: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width - 1; x++) edges.push(wallV(x, y, width));
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width; x++) edges.push(wallH(x, y, width, height));
  return edges;
}

// Обход из углов всех игроков через грани без стен.
// Поле валидно, если нет зон, недостижимых ни для одного игрока.
export function wallsConnected(config: Config, walls: number[]): boolean {
  const { width, height, players } = config;
  const w = new Set(walls);
  const seen = new Set<number>();
  for (let p = 1; p <= players; p++) {
    const c = corner(config, p);
    const start = c.y * width + c.x;
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      const dirs: [number, number][] = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of dirs) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const j = ny * width + nx;
        if (seen.has(j)) continue;
        if (wallBetween(w, width, height, x, y, nx, ny)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === width * height;
}

// Расшифровка кода грани: [x, y, nx, ny] — две клетки, которые она разделяет
export function edgeCells(
  w: number,
  width: number,
  height: number,
): [number, number, number, number] {
  const vCount = (width - 1) * height;
  if (w < vCount) {
    const x = w % (width - 1);
    const y = Math.floor(w / (width - 1));
    return [x, y, x + 1, y];
  }
  const hId = w - vCount;
  const x = hId % width;
  const y = Math.floor(hId / width);
  return [x, y, x, y + 1];
}

// Безопасная зона у углов игроков: квадрат до 5×5 без стен,
// чтобы стартовать было легко
export function inSafeZone(config: Config, x: number, y: number): boolean {
  const z = Math.min(5, Math.floor(Math.min(config.width, config.height) / 2));
  if (z < 1) return false;
  for (let p = 1; p <= config.players; p++) {
    const c = corner(config, p);
    if (Math.abs(x - c.x) < z && Math.abs(y - c.y) < z) return true;
  }
  return false;
}

export function generateWalls(config: Config, rng: Rng = Math.random): number[] {
  if (!config.walls) return [];
  // стены не ставим внутри безопасных зон у углов
  const edges = allInternalEdges(config.width, config.height).filter((e) => {
    const [x, y, nx, ny] = edgeCells(e, config.width, config.height);
    return !(inSafeZone(config, x, y) && inSafeZone(config, nx, ny));
  });
  if (!edges.length) return [];
  for (let attempt = 0; attempt < 60; attempt++) {
    const walls = edges.filter(() => rng() < config.wallDensity);
    if (walls.length > 0 && wallsConnected(config, walls)) return walls.sort((a, b) => a - b);
  }
  return []; // не удалось — играем без стен
}

// ---------- создание игры ----------
export function createGame(
  input: ConfigInput,
  rng: Rng = Math.random,
  now: number = Date.now(),
): GameState {
  const config = normalizeConfig(input);
  const walls = generateWalls(config, rng);

  let bonus: number[] = [];
  if (config.cards) {
    const total = config.width * config.height;
    // не ставим бонусы на стартовые углы
    const corners = new Set<number>();
    for (let p = 1; p <= config.players; p++) {
      const c = corner(config, p);
      corners.add(c.y * config.width + c.x);
    }
    const free = Array.from({ length: total }, (_, i) => i).filter((i) => !corners.has(i));
    const count = Math.min(free.length, Math.min(8, Math.max(2, Math.floor(total * 0.05))));
    for (let k = 0; k < count; k++) {
      const idx = Math.floor(rng() * free.length);
      bonus.push(free.splice(idx, 1)[0]);
    }
    bonus.sort((a, b) => a - b);
  }

  const state: GameState = {
    config,
    board: new Array(config.width * config.height).fill(0),
    walls,
    bonus,
    players: Array.from({ length: config.players }, (_, i) => ({
      nick: `Игрок ${i + 1}`,
      color: DEFAULT_COLORS[i],
    })),
    hands: Array.from({ length: config.players }, () => []),
    dealt: [],
    offer: null,
    pending: [],
    diceChoice: null,
    current: 1,
    dice: null,
    idleTurns: 0,
    finished: false,
    deadline: null,
  };
  return beginTurn(state, rng, now);
}

// Начало хода игрока state.current: стартовый выбор карт (один раз за игру) и таймер
function beginTurn(state: GameState, rng: Rng, now: number): GameState {
  let offer: CardId[] | null = null;
  let dealt = state.dealt;
  if (state.config.cards && !dealt.includes(state.current)) {
    offer = drawOffer(rng);
    dealt = [...dealt, state.current];
  }
  const deadline = state.config.turnSeconds > 0 ? now + state.config.turnSeconds * 1000 : null;
  return { ...state, offer, dealt, deadline };
}

function drawOffer(rng: Rng): CardId[] {
  const pool = [...ALL_CARDS];
  const offer: CardId[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(rng() * pool.length);
    offer.push(pool.splice(idx, 1)[0]);
  }
  return offer;
}

// ---------- кубики ----------
export function rollDie(rng: Rng = Math.random): number {
  return Math.floor(rng() * 6) + 1;
}

export function rollDice(state: GameState, rng: Rng = Math.random): GameState {
  if (state.finished) throw new Error('Игра окончена');
  if (state.offer) throw new Error('Сначала выберите карту из предложенных');
  if (state.dice || state.diceChoice) throw new Error('Кубики уже брошены');

  const mine = state.pending.filter((e) => e.target === state.current);
  const rest = state.pending.filter((e) => e.target !== state.current);

  // Хук «третий куб»: бросаем три, игрок выберет два через chooseDice
  const third = mine.find((e) => e.card === 'third');
  if (third) {
    return {
      ...state,
      pending: rest.concat(mine.filter((e) => e !== third)),
      diceChoice: [rollDie(rng), rollDie(rng), rollDie(rng)],
    };
  }

  const dice: [number, number] = [rollDie(rng), rollDie(rng)];
  return applyRollEffects({ ...state, dice, pending: rest.concat(mine) }, rng);
}

// Хуки после броска: «плюс один» (+1), «удвоение» (×2), «обрезка» (=1)
function applyRollEffects(state: GameState, rng: Rng): GameState {
  if (!state.dice) return state;
  let { dice, pending } = state;
  const mine = pending.filter((e) => e.target === state.current);
  const apply = (card: 'plus' | 'double' | 'weaken', f: (v: number) => number): void => {
    const eff = mine.find((e) => e.card === card);
    if (!eff) return;
    const idx = rng() < 0.5 ? 0 : 1;
    dice = [...dice];
    dice[idx] = f(dice[idx]);
    pending = pending.filter((e) => e !== eff);
  };
  apply('plus', (v) => v + 1);
  apply('double', (v) => v * 2);
  apply('weaken', () => 1);
  return { ...state, dice, pending };
}

// Выбор двух кубиков из трёх: drop — индекс лишнего (0..2)
export function chooseDice(state: GameState, drop: number, rng: Rng = Math.random): GameState {
  if (!state.diceChoice) throw new Error('Сейчас нечего выбирать');
  if (drop < 0 || drop > 2) throw new Error('Неверный индекс кубика');
  const kept = state.diceChoice.filter((_, i) => i !== drop) as [number, number];
  return applyRollEffects({ ...state, dice: kept, diceChoice: null }, rng);
}

// ---------- размещение ----------
export function legalPlacements(
  state: GameState,
  player: number,
  a: number,
  b: number,
): Placement[] {
  const { width, height } = state.config;
  const { board } = state;
  const walls = new Set(state.walls);
  const owns = board.includes(player);
  const c = corner(state.config, player);
  const sizes: [number, number][] = a === b ? [[a, b]] : [[a, b], [b, a]];
  const result: Placement[] = [];

  for (const [w, h] of sizes) {
    for (let y = 0; y + h <= height; y++) {
      for (let x = 0; x + w <= width; x++) {
        let ok = true;
        let touches = false;
        let covers = false;
        for (let j = y; j < y + h && ok; j++) {
          for (let i = x; i < x + w && ok; i++) {
            if (board[j * width + i] !== 0) {
              ok = false;
              break;
            }
            // блок нельзя ставить через стену: все внутренние грани без стен
            if (i < x + w - 1 && walls.has(wallV(i, j, width))) {
              ok = false;
              break;
            }
            if (j < y + h - 1 && walls.has(wallH(i, j, width, height))) {
              ok = false;
              break;
            }
            if (i === c.x && j === c.y) covers = true;
            if (owns && !touches) {
              // прилегание считается только через грань без стены
              if (
                (i > 0 &&
                  board[j * width + i - 1] === player &&
                  !walls.has(wallV(i - 1, j, width))) ||
                (i < width - 1 &&
                  board[j * width + i + 1] === player &&
                  !walls.has(wallV(i, j, width))) ||
                (j > 0 &&
                  board[(j - 1) * width + i] === player &&
                  !walls.has(wallH(i, j - 1, width, height))) ||
                (j < height - 1 &&
                  board[(j + 1) * width + i] === player &&
                  !walls.has(wallH(i, j, width, height)))
              ) {
                touches = true;
              }
            }
          }
        }
        if (ok && (owns ? touches : covers)) result.push({ x, y, w, h });
      }
    }
  }
  return result;
}

export function currentMoves(state: GameState): Placement[] {
  if (!state.dice || state.finished || state.diceChoice) return [];
  const [a, b] = state.dice;
  let moves = legalPlacements(state, state.current, a, b);
  // Хук «блок»: цель не может поворачивать прямоугольник
  const blocked = state.pending.some((e) => e.card === 'block' && e.target === state.current);
  if (blocked && a !== b) moves = moves.filter((m) => m.w === a && m.h === b);
  return moves;
}

function nextPlayer(state: GameState): number {
  return (state.current % state.config.players) + 1;
}

function randomCard(rng: Rng): CardId {
  return ALL_CARDS[Math.floor(rng() * ALL_CARDS.length)];
}

export function applyMove(
  state: GameState,
  p: Placement,
  rng: Rng = Math.random,
  now: number = Date.now(),
): GameState {
  const ok = currentMoves(state).some(
    (m) => m.x === p.x && m.y === p.y && m.w === p.w && m.h === p.h,
  );
  if (!ok) throw new Error('Недопустимый ход');

  const { width } = state.config;
  const board = state.board.slice();
  const hands = state.hands.map((h) => [...h]);
  let bonus = state.bonus;

  for (let j = p.y; j < p.y + p.h; j++) {
    for (let i = p.x; i < p.x + p.w; i++) {
      const idx = j * width + i;
      board[idx] = state.current;
      // захват бонусной клетки даёт случайную карту
      const bi = bonus.indexOf(idx);
      if (bi >= 0) {
        hands[state.current - 1].push(randomCard(rng));
        bonus = bonus.filter((b) => b !== idx);
      }
    }
  }

  // эффекты, навешанные на завершившего ход игрока, сгорают
  // (сюда входит и «двойной ход» — он расходуется этой постановкой)
  const pending = state.pending.filter((e) => e.target !== state.current);

  // «двойной ход»: игрок остаётся текущим и ходит ещё раз
  const extra = state.pending.some((e) => e.card === 'extra' && e.target === state.current);
  const next = extra ? state.current : nextPlayer(state);

  return beginTurn(
    {
      ...state,
      board,
      bonus,
      hands,
      pending,
      dice: null,
      idleTurns: 0,
      current: next,
    },
    rng,
    now,
  );
}

// Вызывается, когда для выпавших кубиков нет ни одного места
export function skipTurn(
  state: GameState,
  rng: Rng = Math.random,
  now: number = Date.now(),
): GameState {
  if (state.diceChoice) throw new Error('Сначала выберите два кубика из трёх');
  if (currentMoves(state).length > 0) {
    throw new Error('Пропуск запрещён: есть допустимые ходы');
  }
  const idleTurns = state.idleTurns + 1;
  const pending = state.pending.filter((e) => e.target !== state.current);
  return beginTurn(
    {
      ...state,
      pending,
      dice: null,
      diceChoice: null,
      idleTurns,
      finished: idleTurns >= state.config.players * 3,
      current: nextPlayer(state),
    },
    rng,
    now,
  );
}

// ---------- карточки ----------
// Взять одну из трёх предложенных карт в начале хода
export function pickOffer(state: GameState, card: CardId): GameState {
  if (!state.offer) throw new Error('Сейчас нет выбора карт');
  if (!state.offer.includes(card)) throw new Error('Такой карты нет среди предложенных');
  const hands = state.hands.map((h) => [...h]);
  hands[state.current - 1].push(card);
  return { ...state, hands, offer: null };
}

// Разыграть карту из руки. Большинство карт — до броска, «переброс» — после.
export function playCard(
  state: GameState,
  card: CardId,
  target?: number,
  rng: Rng = Math.random,
): GameState {
  if (state.finished) throw new Error('Игра окончена');
  if (state.offer) throw new Error('Сначала выберите карту из предложенных');

  const me = state.current;
  if (state.pending.some((e) => e.card === 'silence' && e.target === me)) {
    throw new Error('Тишина: в этом ходу карты играть нельзя');
  }
  if (card === 'reroll') {
    if (!state.dice || state.diceChoice) {
      throw new Error('Переброс играется после броска кубиков');
    }
  } else if (state.dice || state.diceChoice) {
    throw new Error('Эта карта играется до броска кубиков');
  }

  const hand = state.hands[me - 1];
  const idx = hand.indexOf(card);
  if (idx < 0) throw new Error('Такой карты нет в руке');

  if (CARD_INFO[card].needsTarget) {
    if (target === undefined || target < 1 || target > state.config.players) {
      throw new Error('Нужно выбрать цель');
    }
    if (card !== 'double' && target === me) {
      throw new Error('Эту карту нельзя разыграть на себя');
    }
  }

  const hands = state.hands.map((h) => [...h]);
  hands[me - 1].splice(idx, 1);

  if (card === 'thief') {
    const victim = hands[target! - 1];
    if (victim.length === 0) throw new Error('У соперника нет карт');
    const stolen = victim.splice(Math.floor(rng() * victim.length), 1)[0];
    hands[me - 1].push(stolen);
    return { ...state, hands };
  }

  if (card === 'reroll') {
    return { ...state, hands, dice: [rollDie(rng), rollDie(rng)] };
  }

  const effect: PendingEffect = { card, target: CARD_INFO[card].needsTarget ? target! : me };
  return { ...state, hands, pending: [...state.pending, effect] };
}

// Ник и цвет игрока (при подключении по сети)
export function setPlayerInfo(state: GameState, seat: number, nick: string, color: string): GameState {
  const players = state.players.map((p) => ({ ...p }));
  const taken = players.some((p, i) => i !== seat - 1 && p.color === color);
  players[seat - 1] = {
    nick: nick.trim().slice(0, 16) || `Игрок ${seat}`,
    color: taken ? (DEFAULT_COLORS.find((c) => !players.some((p) => p.color === c)) ?? color) : color,
  };
  return { ...state, players };
}

// ---------- итоги ----------
export function ranking(state: GameState): Ranking {
  const n = state.config.players;
  const scores = new Array(n).fill(0);
  for (const cell of state.board) if (cell > 0) scores[cell - 1]++;
  const places = scores.map((s) => 1 + scores.filter((o) => o > s).length);
  return { scores, places, isDraw: places.filter((p) => p === 1).length > 1 };
}
