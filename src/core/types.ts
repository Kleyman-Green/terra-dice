export type Config = {
  width: number;
  height: number;
  players: number; // 2..4
  walls: boolean; // стены между клетками
  wallDensity: number; // доля внутренних граней со стеной, 0..0.5
  cards: boolean; // карточки усилений
  turnSeconds: number; // таймер хода, 0 = выключен
};

// При создании игры достаточно размеров и числа игроков, остальное по умолчанию
export type ConfigInput = Pick<Config, 'width' | 'height' | 'players'> & Partial<Config>;

export type Placement = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CardId = 'double' | 'thief' | 'third' | 'block';

// Отложенный эффект, ждущий своего хука на ходу цели
export type PendingEffect = {
  card: 'double' | 'third' | 'block';
  target: number; // игрок 1..players
};

export type PlayerInfo = {
  nick: string;
  color: string;
};

export type GameState = {
  config: Config;
  board: number[]; // 0 = свободно, 1..4 = номер игрока
  walls: number[]; // внутренние грани со стеной (кодировка в game.ts)
  bonus: number[]; // индексы бонусных клеток
  players: PlayerInfo[];
  hands: CardId[][]; // hands[i] — карты игрока i+1
  offer: CardId[] | null; // выбор 1 из 3 карт в начале хода
  pending: PendingEffect[];
  diceChoice: [number, number, number] | null; // «третий куб»: ждём выбор 2 из 3
  current: number; // чей сейчас ход (1..players)
  dice: [number, number] | null;
  idleTurns: number; // сколько ходов подряд никто не поставил блок
  finished: boolean;
  deadline: number | null; // метка времени конца хода (таймер)
};

export type Ranking = {
  scores: number[]; // индекс 0 = игрок 1
  places: number[]; // место каждого игрока
  isDraw: boolean; // несколько игроков делят 1-е место
};
