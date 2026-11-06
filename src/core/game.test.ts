import { describe, expect, it } from 'vitest';
import {
  applyMove,
  chooseDice,
  createGame,
  currentMoves,
  edgeCells,
  generateWalls,
  inSafeZone,
  legalPlacements,
  mulberry32,
  pickOffer,
  playCard,
  ranking,
  rollDice,
  skipTurn,
  wallH,
  wallV,
  wallsConnected,
} from './game';
import type { GameState } from './types';

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
    const g = { ...createGame(cfg), board: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
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

describe('стены', () => {
  const wcfg = { width: 4, height: 1, players: 2, walls: true, wallDensity: 0.5 };
  const wall01 = wallV(0, 0, 4); // стена между клетками 0 и 1

  it('блок нельзя ставить через стену', () => {
    const g: GameState = { ...createGame(wcfg), board: [1, 0, 0, 0], walls: [wall01] };
    expect(legalPlacements(g, 1, 3, 1)).toEqual([]);
    expect(legalPlacements(g, 1, 3, 1).length).toBe(0);
    const g2 = { ...g, walls: [] };
    expect(legalPlacements(g2, 1, 3, 1)).toEqual([{ x: 1, y: 0, w: 3, h: 1 }]);
  });

  it('прилегание через стену не считается', () => {
    const g: GameState = { ...createGame(wcfg), board: [1, 0, 0, 0], walls: [wall01] };
    expect(legalPlacements(g, 1, 1, 1)).toEqual([]);
    const g2 = { ...g, walls: [] };
    expect(legalPlacements(g2, 1, 1, 1)).toEqual([{ x: 1, y: 0, w: 1, h: 1 }]);
  });

  it('изолированная зона не проходит проверку связности', () => {
    const c = { ...createGame({ width: 3, height: 3, players: 2 }).config };
    // кольцо стен вокруг центральной клетки (1,1)
    const ring = [wallV(0, 1, 3), wallV(1, 1, 3), wallH(1, 0, 3, 3), wallH(1, 1, 3, 3)];
    expect(wallsConnected(c, ring)).toBe(false);
    expect(wallsConnected(c, [])).toBe(true);
  });

  it('генерация всегда даёт связное поле', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const c = { width: 10, height: 10, players: 3, walls: true, wallDensity: 0.25 };
      const walls = generateWalls({ ...createGame(c).config }, mulberry32(seed));
      expect(wallsConnected({ ...createGame(c).config }, walls)).toBe(true);
    }
  });

  it('стены не заходят в безопасную зону 5×5 у углов', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const c = { width: 12, height: 12, players: 4, walls: true, wallDensity: 0.3 };
      const config = { ...createGame(c).config };
      const walls = generateWalls(config, mulberry32(seed));
      expect(walls.length).toBeGreaterThan(0);
      for (const w of walls) {
        const [x, y, nx, ny] = edgeCells(w, config.width, config.height);
        expect(inSafeZone(config, x, y) && inSafeZone(config, nx, ny)).toBe(false);
      }
    }
  });
});

describe('карточки', () => {
  const ccfg = { width: 6, height: 6, players: 2, cards: true };

  it('в начале хода предлагается 1 из 3 карт', () => {
    const g = createGame(ccfg, mulberry32(1));
    expect(g.offer).not.toBeNull();
    expect(g.offer!.length).toBe(3);
    expect(new Set(g.offer!).size).toBe(3);
    expect(() => rollDice(g)).toThrow();
    const g2 = pickOffer(g, g.offer![0]);
    expect(g2.offer).toBeNull();
    expect(g2.hands[0]).toEqual([g.offer![0]]);
  });

  it('третий куб: бросаем три, выбираем два', () => {
    let g: GameState = {
      ...createGame(ccfg, mulberry32(2)),
      offer: null,
      hands: [['third'], []],
    };
    g = playCard(g, 'third');
    expect(g.pending).toEqual([{ card: 'third', target: 1 }]);
    g = rollDice(g, mulberry32(3));
    expect(g.dice).toBeNull();
    expect(g.diceChoice).not.toBeNull();
    const [a, b, c] = g.diceChoice!;
    g = chooseDice(g, 0);
    expect(g.dice).toEqual([b, c]);
    expect(g.diceChoice).toBeNull();
    expect(a >= 1 && a <= 6).toBe(true);
  });

  it('удвоение: один кубик цели ×2', () => {
    let g: GameState = {
      ...createGame(ccfg),
      offer: null,
      hands: [['double'], []],
    };
    g = playCard(g, 'double', 1);
    g = rollDice(g, () => 0.99); // оба кубика 6, удвоение бьёт по второму
    expect(g.dice).toEqual([6, 12]);
    expect(g.pending).toEqual([]);
  });

  it('блок: соперник не может поворачивать прямоугольник', () => {
    const g: GameState = {
      ...createGame(ccfg),
      current: 2,
      dice: [2, 3],
      pending: [{ card: 'block', target: 2 }],
    };
    const moves = currentMoves(g);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.w === 2 && m.h === 3)).toBe(true);
    const free = currentMoves({ ...g, pending: [] });
    expect(free.length).toBeGreaterThan(moves.length);
  });

  it('вор: крадёт случайную карту у соперника', () => {
    const g: GameState = {
      ...createGame(ccfg),
      offer: null,
      hands: [['thief'], ['double', 'third']],
    };
    const g2 = playCard(g, 'thief', 2, () => 0);
    expect(g2.hands[0]).toEqual(['double']);
    expect(g2.hands[1]).toEqual(['third']);
  });

  it('захват бонусной клетки даёт карту', () => {
    let g: GameState = {
      ...createGame({ width: 3, height: 1, players: 2, cards: true }),
      offer: null,
      bonus: [1],
      dice: [2, 1],
    };
    g = applyMove(g, { x: 0, y: 0, w: 2, h: 1 }, mulberry32(4));
    expect(g.bonus).toEqual([]);
    expect(g.hands[0].length).toBe(1);
  });

  it('карту нельзя разыграть после броска', () => {
    const g: GameState = {
      ...createGame(ccfg),
      offer: null,
      hands: [['double'], []],
      dice: [2, 3],
    };
    expect(() => playCard(g, 'double', 2)).toThrow();
  });

  it('выбор карт даётся каждому игроку только один раз', () => {
    let g = createGame(ccfg, mulberry32(7));
    expect(g.offer).not.toBeNull(); // первый ход игрока 1
    g = pickOffer(g, g.offer![0]);
    g = { ...g, dice: [2, 2] };
    g = applyMove(g, { x: 0, y: 0, w: 2, h: 2 }, mulberry32(8));
    expect(g.current).toBe(2);
    expect(g.offer).not.toBeNull(); // первый ход игрока 2
    g = pickOffer(g, g.offer![0]);
    g = { ...g, dice: [2, 2] };
    g = applyMove(g, { x: 4, y: 4, w: 2, h: 2 }, mulberry32(9));
    expect(g.current).toBe(1);
    expect(g.offer).toBeNull(); // второй ход игрока 1 — без выбора
  });

  it('переброс: новые кубики после броска', () => {
    let g: GameState = {
      ...createGame(ccfg),
      offer: null,
      hands: [['reroll'], []],
      dice: [1, 1],
    };
    g = playCard(g, 'reroll', undefined, () => 0.99);
    expect(g.dice).toEqual([6, 6]);
    expect(g.hands[0]).toEqual([]);
  });

  it('плюс один: кубик +1', () => {
    let g: GameState = {
      ...createGame(ccfg),
      offer: null,
      hands: [['plus'], []],
    };
    g = playCard(g, 'plus');
    g = rollDice(g, () => 0.4); // кубики 3 и 3, плюс бьёт по первому
    expect(g.dice).toEqual([4, 3]);
  });

  it('обрезка: кубик соперника становится 1', () => {
    let g: GameState = {
      ...createGame(ccfg),
      offer: null,
      hands: [['weaken'], []],
    };
    g = playCard(g, 'weaken', 2);
    g = { ...g, current: 2 };
    g = rollDice(g, () => 0.99); // кубики 6 и 6, обрезка бьёт по второму
    expect(g.dice).toEqual([6, 1]);
  });

  it('тишина: соперник не может играть карты', () => {
    let g: GameState = {
      ...createGame(ccfg),
      offer: null,
      hands: [
        ['silence'],
        ['double'],
      ],
    };
    g = playCard(g, 'silence', 2);
    g = { ...g, current: 2 };
    expect(() => playCard(g, 'double', 1)).toThrow('Тишина');
  });

  it('двойной ход: игрок ходит ещё раз', () => {
    let g: GameState = {
      ...createGame(ccfg),
      offer: null,
      hands: [['extra'], []],
    };
    g = playCard(g, 'extra');
    g = { ...g, dice: [2, 2] };
    g = applyMove(g, { x: 0, y: 0, w: 2, h: 2 }, mulberry32(10));
    expect(g.current).toBe(1); // ход не перешёл
    expect(g.pending).toEqual([]); // эффект израсходован
  });
});

describe('таймер хода', () => {
  it('дедлайн ставится в начале каждого хода', () => {
    const tcfg = { width: 6, height: 6, players: 2, turnSeconds: 30 };
    const g = createGame(tcfg, mulberry32(1), 1000);
    expect(g.deadline).toBe(1000 + 30000);
    let g2: GameState = { ...g, dice: [2, 2] };
    g2 = applyMove(g2, { x: 0, y: 0, w: 2, h: 2 }, mulberry32(1), 5000);
    expect(g2.deadline).toBe(5000 + 30000);
  });

  it('без таймера дедлайна нет', () => {
    const g = createGame(cfg);
    expect(g.deadline).toBeNull();
  });
});

describe('полная партия', () => {
  it('боты доигрывают до конца без зависаний (все режимы включены)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const rng = mulberry32(seed * 1000);
      let g = createGame(
        { width: 8, height: 8, players: 3, walls: true, wallDensity: 0.2, cards: true, turnSeconds: 30 },
        rng,
        0,
      );
      let steps = 0;
      while (!g.finished && steps < 3000) {
        steps++;
        if (g.offer) {
          g = pickOffer(g, g.offer[Math.floor(rng() * g.offer.length)]);
          continue;
        }
        if (g.diceChoice) {
          g = chooseDice(g, Math.floor(rng() * 3), rng);
          continue;
        }
        if (!g.dice) {
          // иногда разыгрываем карту
          const hand = g.hands[g.current - 1];
          if (hand.length && rng() < 0.3) {
            const card = hand[Math.floor(rng() * hand.length)];
            const target = 1 + Math.floor(rng() * g.config.players);
            try {
              g = playCard(g, card, card === 'third' ? undefined : target, rng);
              continue;
            } catch {
              // цель не подошла — просто бросаем
            }
          }
          g = rollDice(g, rng);
          continue;
        }
        const moves = currentMoves(g);
        if (moves.length === 0) {
          g = skipTurn(g, rng, steps * 1000);
        } else {
          g = applyMove(g, moves[Math.floor(rng() * moves.length)], rng, steps * 1000);
        }
      }
      expect(g.finished).toBe(true);
      const r = ranking(g);
      expect(r.scores.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }
  });
});
