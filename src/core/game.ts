import type { Config, GameState, Placement, Ranking } from './types';

export type Rng = () => number;

export function createGame(config: Config): GameState {
  return {
    config,
    board: new Array(config.width * config.height).fill(0),
    current: 1,
    dice: null,
    idleTurns: 0,
    finished: false,
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

export function rollDie(rng: Rng = Math.random): number {
  return Math.floor(rng() * 6) + 1;
}

export function rollDice(state: GameState, rng: Rng = Math.random): GameState {
  return { ...state, dice: [rollDie(rng), rollDie(rng)] };
}

export function legalPlacements(
  state: GameState,
  player: number,
  a: number,
  b: number,
): Placement[] {
  const { width, height } = state.config;
  const { board } = state;
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
          for (let i = x; i < x + w; i++) {
            if (board[j * width + i] !== 0) {
              ok = false;
              break;
            }
            if (i === c.x && j === c.y) covers = true;
            if (owns && !touches) {
              if (
                (i > 0 && board[j * width + i - 1] === player) ||
                (i < width - 1 && board[j * width + i + 1] === player) ||
                (j > 0 && board[(j - 1) * width + i] === player) ||
                (j < height - 1 && board[(j + 1) * width + i] === player)
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
  if (!state.dice || state.finished) return [];
  return legalPlacements(state, state.current, state.dice[0], state.dice[1]);
}

function nextPlayer(state: GameState): number {
  return (state.current % state.config.players) + 1;
}

export function applyMove(state: GameState, p: Placement): GameState {
  const ok = currentMoves(state).some(
    (m) => m.x === p.x && m.y === p.y && m.w === p.w && m.h === p.h,
  );
  if (!ok) throw new Error('Недопустимый ход');

  const board = state.board.slice();
  for (let j = p.y; j < p.y + p.h; j++) {
    for (let i = p.x; i < p.x + p.w; i++) {
      board[j * state.config.width + i] = state.current;
    }
  }
  return { ...state, board, dice: null, idleTurns: 0, current: nextPlayer(state) };
}

// Вызывается, когда для выпавших кубиков нет ни одного места
export function skipTurn(state: GameState): GameState {
  if (currentMoves(state).length > 0) {
    throw new Error('Пропуск запрещён: есть допустимые ходы');
  }
  const idleTurns = state.idleTurns + 1;
  return {
    ...state,
    dice: null,
    idleTurns,
    finished: idleTurns >= state.config.players * 3,
    current: nextPlayer(state),
  };
}

export function ranking(state: GameState): Ranking {
  const n = state.config.players;
  const scores = new Array(n).fill(0);
  for (const cell of state.board) if (cell > 0) scores[cell - 1]++;
  const places = scores.map(
    (s) => 1 + scores.filter((o) => o > s).length,
  );
  return { scores, places, isDraw: places.filter((p) => p === 1).length > 1 };
}