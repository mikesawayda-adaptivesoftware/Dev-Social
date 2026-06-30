import { nanoid } from "nanoid";
import {
  DEFAULT_SETTINGS,
  type GameSettings,
  type GamePhase,
  type RoomState,
  type PublicPlayer,
} from "../src/shared/types";
import type { FinishedGame } from "./supabase";

const PLAYER_COLORS = [
  "#f87171", // red
  "#fb923c", // orange
  "#facc15", // yellow
  "#4ade80", // green
  "#22d3ee", // cyan
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#f472b6", // pink
  "#34d399", // emerald
  "#e879f9", // fuchsia
];

interface InternalPlayer {
  id: string;
  name: string;
  color: string;
  score: number;
  isHost: boolean;
  connected: boolean;
  socketId?: string;
}

interface InternalPhoto {
  id: string;
  ownerId: string;
  dataUrl: string;
}

interface InternalGuess {
  choiceId: string | null;
  timeMs: number;
  correct: boolean;
  points: number;
}

interface InternalRound {
  id: string;
  photoId: string;
  ownerId: string;
  optionIds: string[];
  guesses: Map<string, InternalGuess>;
  startedAt: number;
  durationMs: number;
  closed: boolean;
}

interface Room {
  code: string;
  hostId: string;
  phase: GamePhase;
  settings: GameSettings;
  players: Map<string, InternalPlayer>;
  photos: InternalPhoto[];
  rounds: InternalRound[];
  currentRound: number;
  roundTimer?: ReturnType<typeof setTimeout>;
  createdAt: number;
  persisted: boolean;
}

export class RoomError extends Error {}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeCode(existing: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion
  let code = "";
  do {
    code = Array.from(
      { length: 4 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  } while (existing.has(code));
  return code;
}

/**
 * In-memory store of all active rooms. This is the single piece to swap out
 * when migrating realtime/state to Supabase. The socket layer only ever calls
 * these methods and re-broadcasts the resulting views.
 */
export class RoomStore {
  private rooms = new Map<string, Room>();

  // Notifier injected by the socket layer so logic can request a broadcast
  // (e.g. when a round auto-closes on its timer).
  onRoomChanged: (code: string) => void = () => {};

  // Fired once when a game reaches its final phase, so the socket layer can
  // persist results to Supabase without coupling game logic to the database.
  onGameFinished: (code: string) => void = () => {};

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  private requireRoom(code: string): Room {
    const room = this.getRoom(code);
    if (!room) {
      throw new RoomError("Room not found. Double-check the code.");
    }
    return room;
  }

  private requireHost(room: Room, playerId: string) {
    if (room.hostId !== playerId) {
      throw new RoomError("Only the host can do that.");
    }
  }

  createRoom(name: string): { code: string; playerId: string } {
    const code = makeCode(new Set(this.rooms.keys()));
    const playerId = nanoid(10);
    const room: Room = {
      code,
      hostId: playerId,
      phase: "lobby",
      settings: { ...DEFAULT_SETTINGS },
      players: new Map(),
      photos: [],
      rounds: [],
      currentRound: 0,
      createdAt: Date.now(),
      persisted: false,
    };
    room.players.set(playerId, {
      id: playerId,
      name: cleanName(name) || "Host",
      color: PLAYER_COLORS[0],
      score: 0,
      isHost: true,
      connected: true,
    });
    this.rooms.set(code, room);
    return { code, playerId };
  }

  joinRoom(code: string, name: string): { code: string; playerId: string } {
    const room = this.requireRoom(code);
    if (room.phase !== "lobby") {
      throw new RoomError("This game has already started.");
    }
    if (room.players.size >= PLAYER_COLORS.length) {
      throw new RoomError("This room is full.");
    }
    const playerId = nanoid(10);
    const color = PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];
    room.players.set(playerId, {
      id: playerId,
      name: cleanName(name) || "Player",
      color,
      score: 0,
      isHost: false,
      connected: true,
    });
    this.touch(room);
    return { code: room.code, playerId };
  }

  rejoin(code: string, playerId: string, socketId: string): Room {
    const room = this.requireRoom(code);
    const player = room.players.get(playerId);
    if (!player) {
      throw new RoomError("You are no longer part of this room.");
    }
    player.connected = true;
    player.socketId = socketId;
    this.touch(room);
    return room;
  }

  attachSocket(code: string, playerId: string, socketId: string) {
    const player = this.getRoom(code)?.players.get(playerId);
    if (player) {
      player.socketId = socketId;
      player.connected = true;
    }
  }

  markDisconnected(socketId: string): string[] {
    const changed: string[] = [];
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) {
          player.connected = false;
          player.socketId = undefined;
          changed.push(room.code);
        }
      }
    }
    return changed;
  }

  startSubmission(code: string, playerId: string) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== "lobby") {
      throw new RoomError("Submissions can only start from the lobby.");
    }
    room.phase = "submission";
    this.touch(room);
  }

  submitPhoto(
    code: string,
    playerId: string,
    content: string,
    photoId: string = nanoid(8)
  ) {
    const room = this.requireRoom(code);
    if (room.phase !== "submission") {
      throw new RoomError("Photo submissions are closed.");
    }
    if (!room.players.has(playerId)) {
      throw new RoomError("You are not in this room.");
    }
    const isDataUrl = content.startsWith("data:image/");
    const isHttpUrl = /^https?:\/\//.test(content);
    if (!isDataUrl && !isHttpUrl) {
      throw new RoomError("That doesn't look like an image.");
    }
    // Guard against oversized inline payloads (base64 of ~1.5MB image).
    if (isDataUrl && content.length > 2_500_000) {
      throw new RoomError("That image is too large. Try a smaller photo.");
    }
    // `dataUrl` holds either an inline data URL (local mode) or a Storage URL.
    room.photos.push({ id: photoId, ownerId: playerId, dataUrl: content });
    this.touch(room);
  }

  clearMyPhotos(code: string, playerId: string) {
    const room = this.requireRoom(code);
    if (room.phase !== "submission") {
      return;
    }
    room.photos = room.photos.filter((p) => p.ownerId !== playerId);
    this.touch(room);
  }

  startGame(code: string, playerId: string) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== "submission") {
      throw new RoomError("You can only start the game from submissions.");
    }
    const owners = new Set(room.photos.map((p) => p.ownerId));
    if (owners.size < 2) {
      throw new RoomError(
        "Need photos from at least 2 different people to play."
      );
    }

    const allPlayerIds = [...room.players.keys()];
    room.rounds = shuffle(room.photos).map((photo) => {
      const decoyPool = shuffle(
        allPlayerIds.filter((id) => id !== photo.ownerId)
      );
      const decoys = decoyPool.slice(0, Math.max(1, room.settings.maxOptions - 1));
      const optionIds = shuffle([photo.ownerId, ...decoys]);
      return {
        id: nanoid(8),
        photoId: photo.id,
        ownerId: photo.ownerId,
        optionIds,
        guesses: new Map<string, InternalGuess>(),
        startedAt: 0,
        durationMs: room.settings.roundDurationSec * 1000,
        closed: false,
      } satisfies InternalRound;
    });
    room.currentRound = 0;
    for (const p of room.players.values()) {
      p.score = 0;
    }
    this.beginRound(room);
  }

  private beginRound(room: Room) {
    room.phase = "playing";
    const round = room.rounds[room.currentRound];
    round.startedAt = Date.now();
    round.closed = false;
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
    }
    room.roundTimer = setTimeout(() => {
      this.closeRound(room);
      this.onRoomChanged(room.code);
    }, round.durationMs + 500);
    this.touch(room);
  }

  submitGuess(code: string, playerId: string, choiceId: string) {
    const room = this.requireRoom(code);
    if (room.phase !== "playing") {
      throw new RoomError("There's nothing to guess right now.");
    }
    const round = room.rounds[room.currentRound];
    if (round.ownerId === playerId) {
      throw new RoomError("That's your photo — sit this one out!");
    }
    if (round.guesses.has(playerId)) {
      return; // already answered; ignore
    }
    if (!round.optionIds.includes(choiceId)) {
      throw new RoomError("Invalid choice.");
    }
    const elapsed = Date.now() - round.startedAt;
    const correct = choiceId === round.ownerId;
    const remainingFraction = Math.max(
      0,
      Math.min(1, 1 - elapsed / round.durationMs)
    );
    const points = correct ? 100 + Math.round(remainingFraction * 100) : 0;
    round.guesses.set(playerId, {
      choiceId,
      timeMs: elapsed,
      correct,
      points,
    });

    // Auto-close once everyone eligible has answered.
    const eligible = [...room.players.keys()].filter(
      (id) => id !== round.ownerId
    );
    if (eligible.every((id) => round.guesses.has(id))) {
      this.closeRound(room);
    }
    this.touch(room);
  }

  private closeRound(room: Room) {
    const round = room.rounds[room.currentRound];
    if (round.closed) {
      return;
    }
    round.closed = true;
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = undefined;
    }
    for (const [playerId, guess] of round.guesses) {
      const player = room.players.get(playerId);
      if (player) {
        player.score += guess.points;
      }
    }
    room.phase = "reveal";
  }

  nextRound(code: string, playerId: string) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== "reveal") {
      throw new RoomError("Finish revealing first.");
    }
    if (room.currentRound + 1 >= room.rounds.length) {
      room.phase = "final";
      this.touch(room);
      this.onGameFinished(room.code);
      return;
    }
    room.currentRound += 1;
    this.beginRound(room);
  }

  playAgain(code: string, playerId: string) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = undefined;
    }
    room.phase = "lobby";
    room.photos = [];
    room.rounds = [];
    room.currentRound = 0;
    room.persisted = false;
    for (const p of room.players.values()) {
      p.score = 0;
    }
    this.touch(room);
  }

  /**
   * Returns a one-time snapshot of a finished game for persistence, or null if
   * the game isn't final or has already been persisted. Marks it persisted so
   * results are only written once even if `nextRound` is somehow re-triggered.
   */
  takeFinishedGame(code: string): FinishedGame | null {
    const room = this.getRoom(code);
    if (!room || room.phase !== "final" || room.persisted) {
      return null;
    }
    room.persisted = true;
    const host = room.players.get(room.hostId);
    const ranked = [...room.players.values()].sort(
      (a, b) => b.score - a.score
    );
    return {
      code: room.code,
      gameType: "photo_guessr",
      hostName: host?.name ?? "Host",
      roundCount: room.rounds.length,
      players: ranked.map((p, i) => ({
        name: p.name,
        color: p.color,
        score: p.score,
        placement: i + 1,
        isHost: p.isHost,
      })),
    };
  }

  private touch(room: Room) {
    // Hook for future persistence; currently a no-op besides existence.
    void room;
  }

  /** Build the client-facing, role-aware view of a room for one player. */
  viewFor(code: string, viewerId: string): RoomState {
    const room = this.requireRoom(code);
    const photoCounts = new Map<string, number>();
    for (const photo of room.photos) {
      photoCounts.set(photo.ownerId, (photoCounts.get(photo.ownerId) ?? 0) + 1);
    }

    const players: PublicPlayer[] = [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      isHost: p.isHost,
      connected: p.connected,
      photoCount: photoCounts.get(p.id) ?? 0,
    }));

    const state: RoomState = {
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      players,
      settings: room.settings,
    };

    if (room.phase === "submission") {
      state.submission = {
        myPhotoCount: photoCounts.get(viewerId) ?? 0,
        totalPhotos: room.photos.length,
        submittedPlayerIds: [...photoCounts.keys()],
        minPhotosPerPlayer: 1,
      };
    }

    if (room.phase === "playing") {
      const round = room.rounds[room.currentRound];
      const photo = room.photos.find((p) => p.id === round.photoId)!;
      const myGuess = round.guesses.get(viewerId);
      state.round = {
        index: room.currentRound,
        total: room.rounds.length,
        photoDataUrl: photo.dataUrl,
        optionIds: round.optionIds,
        endsAt: round.startedAt + round.durationMs,
        answeredCount: round.guesses.size,
        myGuess: myGuess?.choiceId ?? undefined,
        iAmOwner: round.ownerId === viewerId,
      };
    }

    if (room.phase === "reveal") {
      const round = room.rounds[room.currentRound];
      const photo = room.photos.find((p) => p.id === round.photoId)!;
      state.reveal = {
        index: room.currentRound,
        total: room.rounds.length,
        photoDataUrl: photo.dataUrl,
        ownerId: round.ownerId,
        results: [...round.guesses.entries()].map(([pid, g]) => ({
          playerId: pid,
          choiceId: g.choiceId,
          correct: g.correct,
          points: g.points,
        })),
      };
    }

    if (room.phase === "final") {
      state.final = {
        ranking: [...room.players.values()]
          .sort((a, b) => b.score - a.score)
          .map((p) => ({ playerId: p.id, score: p.score })),
      };
    }

    return state;
  }

  /** Remove rooms older than the TTL with no connected players. */
  sweep(ttlMs = 1000 * 60 * 60 * 6) {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const anyConnected = [...room.players.values()].some((p) => p.connected);
      if (!anyConnected && now - room.createdAt > ttlMs) {
        if (room.roundTimer) {
          clearTimeout(room.roundTimer);
        }
        this.rooms.delete(code);
      }
    }
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, 20);
}
