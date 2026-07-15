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
  // Also keep a durable, cross-tab recovery record so a player who fully drops
  // (tab closed, browser crash, phone evicts the tab) can still get back in.
  saveRecentSeat(identity);
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

// --- Durable recent-seat store (localStorage) for reconnecting after a drop ---
//
// The active identity above lives in sessionStorage so multiple players sharing
// one browser (two windows on a laptop, host + a phone) keep isolated seats.
// But sessionStorage dies when the tab closes / the browser crashes / a phone
// evicts the tab — the common "I got dropped" cases. So we ALSO record the seat
// in localStorage, keyed by room code, purely as a recovery hint.
//
// Crucial: we NEVER silently auto-rejoin from this store. It only powers an
// explicit "Rejoin as <name>?" prompt the user must tap. That preserves the
// multi-window guarantee (a second window can't inherit the first's live seat)
// while still giving a one-tap path back into an in-progress game. Last write
// per code wins; the prompt shows the name so the user can decline if it isn't
// theirs.

export interface RecentSeat extends Identity {
  savedAt: number;
}

const RECENT_KEY = "devsocial:recent-seats";
// Don't offer to rejoin stale games. The server sweeps rooms after ~6h, so a
// seat older than that can't be recovered anyway.
const RECENT_SEAT_TTL_MS = 1000 * 60 * 60 * 6;

function local(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readRecentSeats(): Record<string, RecentSeat> {
  try {
    const raw = local()?.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, RecentSeat>) : {};
    return pruneRecentSeats(parsed);
  } catch {
    return {};
  }
}

function pruneRecentSeats(
  seats: Record<string, RecentSeat>
): Record<string, RecentSeat> {
  const now = Date.now();
  const out: Record<string, RecentSeat> = {};
  for (const [code, seat] of Object.entries(seats)) {
    if (
      seat &&
      typeof seat.savedAt === "number" &&
      now - seat.savedAt < RECENT_SEAT_TTL_MS
    ) {
      out[code] = seat;
    }
  }
  return out;
}

export function saveRecentSeat(identity: Identity) {
  try {
    const seats = readRecentSeats();
    seats[identity.code.toUpperCase()] = { ...identity, savedAt: Date.now() };
    local()?.setItem(RECENT_KEY, JSON.stringify(seats));
  } catch {
    // ignore
  }
}

export function loadRecentSeat(code: string): RecentSeat | null {
  return readRecentSeats()[code.toUpperCase()] ?? null;
}

export function clearRecentSeat(code: string) {
  try {
    const seats = readRecentSeats();
    if (seats[code.toUpperCase()]) {
      delete seats[code.toUpperCase()];
      local()?.setItem(RECENT_KEY, JSON.stringify(seats));
    }
  } catch {
    // ignore
  }
}
