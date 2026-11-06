export interface Config {
  width: number;
  height: number;
  players: number; // 2..4
}

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GameState {
  config: Config;
  board: number[]; // 0 = свободно, 1..4 = номер игрока
  current: number; // чей сейчас ход (1..players)
  dice: [number, number] | null;
  idleTurns: number; // сколько ходов подряд никто не поставил блок
  finished: boolean;
}

export interface Ranking {
  scores: number[]; // индекс 0 = игрок 1
  places: number[]; // место каждого игрока
  isDraw: boolean; // несколько игроков делят 1-е место
}