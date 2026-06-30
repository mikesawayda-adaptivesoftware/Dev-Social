import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@/shared/types";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (!socket) {
    const url =
      process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "http://localhost:3001";
    socket = io(url, {
      autoConnect: true,
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

// --- Persisted identity so a player can refresh / reconnect to their room ---

export interface Identity {
  code: string;
  playerId: string;
  isHost: boolean;
  name: string;
}

const STORAGE_KEY = "devsocial:identity";

// Use sessionStorage (per tab/window), NOT localStorage. Multiple players often
// join from the same browser (two windows on one laptop, host + a phone, etc.).
// localStorage is shared across all tabs of an origin, so a second window would
// auto-rejoin as the first player's identity and hijack their realtime seat.
// sessionStorage keeps each window's identity isolated while still surviving a
// same-tab refresh for reconnects.
function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity) {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

export function loadIdentity(): Identity | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export function clearIdentity() {
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
