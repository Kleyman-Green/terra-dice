import { describe, expect, it } from 'vitest';
import { applyMove, createGame, currentMoves, legalPlacements, ranking, skipTurn } from './game';

const cfg = { width: 6, height: 6, players: 2 };

describe('первый блок', () => {
  it('обязан занимать угол', () => {
    const g = createGame(cfg);
    const moves = legalPlacements(g, 1, 3, 4);
    expect(moves.length).toBe(2);
    expect(moves.every((m) => m.x === 0 && m.y === 0)).toBe(true);
  });
  it('игрок 2 стартует в противоположном углу', () => {
    const g = createGame(cfg);
    const moves = legalPlacements(g, 2, 2, 2);
    expect(moves).toEqual([{ x: 4, y: 4, w: 2, h: 2 }]);
  });
});

describe('прилегание', () => {
  it('по углу нельзя, по стороне можно', () => {
    let g = createGame(cfg);
    g = { ...g, dice: [2, 2] };
    g = applyMove(g, { x: 0, y: 0, w: 2, h: 2 });
    const moves = legalPlacements(g, 1, 2, 2);
    expect(moves.some((m) => m.x === 2 && m.y === 2)).toBe(false);
    expect(moves.some((m) => m.x === 2 && m.y === 0)).toBe(true);
    expect(moves.some((m) => m.x === 0 && m.y === 2)).toBe(true);
  });
});

describe('пропуск и конец игры', () => {
  it('пропуск запрещён, если есть ходы', () => {
    const g = { ...createGame(cfg), dice: [1, 1] as [number, number] };
    expect(() => skipTurn(g)).toThrow();
  });
  it('3 полных круга без ходов заканчивают игру', () => {
    let g = createGame({ width: 2, height: 2, players: 2 });
    g = { ...g, board: [1, 2, 2, 2] };
    for (let k = 0; k < 6; k++) {
      expect(g.finished).toBe(false);
      g = { ...g, dice: [6, 6] };
      expect(currentMoves(g).length).toBe(0);
      g = skipTurn(g);
    }
    expect(g.finished).toBe(true);
  });
});

describe('итоги', () => {
  it('ничья при равных очках', () => {
    const g = { ...createGame(cfg), board: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const r = ranking(g);
    expect(r.isDraw).toBe(true);
    expect(r.places).toEqual([1, 1]);
  });
  it('места при 4 игроках с общим вторым', () => {
    const g = createGame({ width: 4, height: 1, players: 4 });
    const r = ranking({ ...g, board: [1, 1, 2, 3] });
    expect(r.places).toEqual([1, 2, 2, 4]);
  });
});