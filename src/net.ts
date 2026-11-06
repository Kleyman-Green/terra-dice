import { joinRoom } from 'trystero';
import type { CardId, GameState, Placement } from './core/types';

export type ClientMsg =
  | { t: 'hello'; nick: string; color: string }
  | { t: 'pick'; card: CardId }
  | { t: 'roll' }
  | { t: 'choose'; drop: number }
  | { t: 'place'; p: Placement }
  | { t: 'play'; card: CardId; target?: number };
export type HostMsg =
  | { t: 'welcome'; seat: number }
  | { t: 'state'; state: GameState; message: string }
  | { t: 'full' };

const APP_ID = 'terra-dice';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const WELCOME_TIMEOUT_MS = 20000;

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function roomId(code: string): string {
  return `terradice-${code}`;
}

export interface HostHandlers {
  onOpen: () => void;
  onSeatJoined: (seat: number, total: number) => void;
  onSeatLeft: (seat: number) => void;
  onAction: (seat: number, msg: ClientMsg) => void;
  onError: (err: string) => void;
}

export interface HostLink {
  broadcast: (msg: HostMsg) => void;
  sendTo: (seat: number, msg: HostMsg) => void;
  destroy: () => void;
}

export function createHost(code: string, players: number, h: HostHandlers): HostLink {
  const room = joinRoom({ appId: APP_ID }, roomId(code), {
    onJoinError: (e) => h.onError(e.error),
  });
  // Два «канала» сообщений: хозяин -> гости и гости -> хозяин
  const hostAction = room.makeAction<HostMsg>('h2c');
  const clientAction = room.makeAction<ClientMsg>('c2h');

  // место (2..players) <-> peerId гостя
  const peerBySeat = new Map<number, string>();
  const seatByPeer = new Map<string, number>();

  // Комната создана локально, подключение к релеям идёт в фоне
  queueMicrotask(() => h.onOpen());

  room.onPeerJoin = (peerId) => {
    let seat = 0;
    for (let s = 2; s <= players; s++) {
      if (!peerBySeat.has(s)) {
        seat = s;
        break;
      }
    }
    if (!seat) {
      void hostAction.send({ t: 'full' } satisfies HostMsg, { target: peerId });
      return;
    }
    peerBySeat.set(seat, peerId);
    seatByPeer.set(peerId, seat);
    void hostAction.send({ t: 'welcome', seat } satisfies HostMsg, { target: peerId });
    h.onSeatJoined(seat, peerBySeat.size);
  };

  room.onPeerLeave = (peerId) => {
    const seat = seatByPeer.get(peerId);
    if (seat === undefined) return;
    seatByPeer.delete(peerId);
    peerBySeat.delete(seat);
    h.onSeatLeft(seat);
  };

  clientAction.onMessage = (msg, { peerId }) => {
    const seat = seatByPeer.get(peerId);
    if (seat !== undefined) h.onAction(seat, msg);
  };

  return {
    broadcast: (msg) => {
      void hostAction.send(msg);
    },
    sendTo: (seat, msg) => {
      const peerId = peerBySeat.get(seat);
      if (peerId) void hostAction.send(msg, { target: peerId });
    },
    destroy: () => {
      void room.leave();
    },
  };
}

export interface GuestHandlers {
  onOpen: () => void;
  onMsg: (msg: HostMsg) => void;
  onClose: () => void;
  onError: (err: string) => void;
}

export interface GuestLink {
  send: (msg: ClientMsg) => void;
  destroy: () => void;
}

export function createGuest(code: string, h: GuestHandlers): GuestLink {
  const room = joinRoom({ appId: APP_ID }, roomId(code), {
    onJoinError: (e) => h.onError(e.error),
  });
  const hostAction = room.makeAction<HostMsg>('h2c');
  const clientAction = room.makeAction<ClientMsg>('c2h');

  let hostId: string | null = null;
  let opened = false;

  // Если за 20 секунд хозяин не ответил — комнаты с таким кодом нет
  const welcomeTimer = setTimeout(() => {
    if (!opened) {
      void room.leave();
      h.onError('peer-unavailable');
    }
  }, WELCOME_TIMEOUT_MS);

  hostAction.onMessage = (msg, { peerId }) => {
    // Первый, кто прислал сообщение хозяина, и есть хозяин
    if (hostId === null) hostId = peerId;
    if (peerId !== hostId) return;
    if (!opened) {
      opened = true;
      clearTimeout(welcomeTimer);
      h.onOpen();
    }
    h.onMsg(msg);
    if (msg.t === 'full') {
      // Даём сообщению уйти и освобождаем комнату
      setTimeout(() => void room.leave(), 1000);
    }
  };

  room.onPeerLeave = (peerId) => {
    if (peerId === hostId) {
      clearTimeout(welcomeTimer);
      h.onClose();
    }
  };

  return {
    send: (msg) => {
      if (hostId) void clientAction.send(msg, { target: hostId });
    },
    destroy: () => {
      clearTimeout(welcomeTimer);
      void room.leave();
    },
  };
}
