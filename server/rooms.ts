import { nanoid } from "nanoid";
import {
  DEFAULT_GAME_TYPE,
  DEFAULT_SETTINGS,
  GEO_DEFAULT_DURATION_SEC,
  isGameEnabled,
  type GameSettings,
  type GamePhase,
  type GameType,
  type RoomState,
  type PublicPlayer,
  type PublicRoomSummary,
  type RoomVisibility,
} from "../src/shared/types";
import { GEO_LOCATIONS, resolvePano } from "./geoLocations";
import {
  claimOrVerifyName,
  getSeenCounts,
  type FinishedGame,
} from "./supabase";

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

interface GeoGuess {
  lat: number;
  lng: number;
  distanceKm: number;
  points: number;
  timeMs: number;
}

interface GeoRound {
  id: string;
  locationId: string;
  // Answer coordinates (the panorama's actual location) + label. Never sent to
  // clients until the reveal phase.
  lat: number;
  lng: number;
  label: string;
  panoId: string;
  guesses: Map<string, GeoGuess>;
  startedAt: number;
  durationMs: number;
  closed: boolean;
}

interface Room {
  code: string;
  hostId: string;
  phase: GamePhase;
  gameType: GameType;
  // "public" lists the room in the games browser while it's an open lobby.
  visibility: RoomVisibility;
  // Whether the host competes. When false the host is a pure spectator (runs the
  // big screen) and is hidden from scoreboards, rankings, and persistence.
  hostPlaying: boolean;
  settings: GameSettings;
  players: Map<string, InternalPlayer>;
  photos: InternalPhoto[];
  rounds: InternalRound[];
  geoRounds: GeoRound[];
  currentRound: number;
  roundTimer?: ReturnType<typeof setTimeout>;
  // When the host is disconnected during a reveal, this timer advances the game
  // so the remaining players aren't stuck waiting on an absent host. Cancelled
  // if the host reconnects in time.
  autoAdvanceTimer?: ReturnType<typeof setTimeout>;
  createdAt: number;
  // Last time anything happened in this room. Drives the sweep, so an idle room
  // is reaped on how long it's been dead rather than how long ago it was made.
  lastActivityAt: number;
  persisted: boolean;
}

// How long to hold on a reveal before auto-advancing when the host is gone.
// Long enough for a brief network blip / page reload to recover control.
const HOST_ABSENT_REVEAL_MS = 15_000;

const MAX_GEO_POINTS = 5000;
// Distance (km) scale for the exponential score decay. Larger = more forgiving.
const GEO_SCORE_SCALE_KM = 1500;

/** Great-circle distance between two lat/lng points, in kilometers. */
function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371; // Earth radius, km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function geoPoints(distanceKm: number): number {
  return Math.round(MAX_GEO_POINTS * Math.exp(-distanceKm / GEO_SCORE_SCALE_KM));
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

  /**
   * Rooms to show in the public games browser: public, still an open lobby, not
   * full, and with someone actually sitting in them.
   *
   * The "someone connected" check matters. A room outlives every player's
   * connection (see `sweep`), which nobody noticed while rooms were only
   * reachable by code — you can't stumble onto a room you were never given. A
   * browser surfaces them, so an abandoned lobby would show up as a joinable
   * game that nobody is in. Newest first.
   */
  listPublicRooms(): PublicRoomSummary[] {
    const summaries: PublicRoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== "public" || room.phase !== "lobby") {
        continue;
      }
      if (room.players.size >= PLAYER_COLORS.length) {
        continue;
      }
      if (![...room.players.values()].some((p) => p.connected)) {
        continue;
      }
      summaries.push({
        code: room.code,
        hostName: room.players.get(room.hostId)?.name ?? "Host",
        gameType: room.gameType,
        playerCount: room.players.size,
        maxPlayers: PLAYER_COLORS.length,
        createdAt: room.createdAt,
      });
    }
    return summaries.sort((a, b) => b.createdAt - a.createdAt);
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

  /** A player who is in the room but not competing (a non-playing host). */
  private isSpectator(room: Room, playerId: string): boolean {
    return playerId === room.hostId && !room.hostPlaying;
  }

  async createRoom(
    name: string,
    pin: string,
    visibility: RoomVisibility = "private"
  ): Promise<{ code: string; playerId: string }> {
    validatePin(pin);
    const claim = await claimOrVerifyName(cleanName(name) || "Host", pin);
    if (!claim.ok) {
      throw new RoomError(claim.reason);
    }
    const code = makeCode(new Set(this.rooms.keys()));
    const playerId = nanoid(10);
    const now = Date.now();
    const room: Room = {
      code,
      hostId: playerId,
      phase: "lobby",
      gameType: DEFAULT_GAME_TYPE,
      visibility: visibility === "public" ? "public" : "private",
      hostPlaying: false,
      settings: { ...DEFAULT_SETTINGS },
      players: new Map(),
      photos: [],
      rounds: [],
      geoRounds: [],
      currentRound: 0,
      createdAt: now,
      lastActivityAt: now,
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

  async joinRoom(
    code: string,
    name: string,
    pin: string
  ): Promise<{ code: string; playerId: string }> {
    const room = this.requireRoom(code);
    if (room.phase !== "lobby") {
      throw new RoomError("This game has already started.");
    }
    if (room.players.size >= PLAYER_COLORS.length) {
      throw new RoomError("This room is full.");
    }
    validatePin(pin);
    const claim = await claimOrVerifyName(cleanName(name) || "Player", pin);
    if (!claim.ok) {
      throw new RoomError(claim.reason);
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
    // If the host is coming back, cancel any pending host-absent auto-advance so
    // they resume control of the reveal.
    if (player.id === room.hostId && room.autoAdvanceTimer) {
      clearTimeout(room.autoAdvanceTimer);
      room.autoAdvanceTimer = undefined;
    }
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

  /**
   * Host-only, lobby-only. Records which game the host has selected.
   *
   * This is server state rather than local UI state so that `gameType` is always
   * true of the room — everyone in the lobby sees the choice, the public games
   * list can show it, and the start paths below can't inherit a stale value.
   */
  setGameType(code: string, playerId: string, gameType: GameType) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== "lobby") {
      throw new RoomError("You can only change the game from the lobby.");
    }
    if (gameType !== "photo_guessr" && gameType !== "geo_guessr") {
      throw new RoomError("That isn't a game we know.");
    }
    if (!isGameEnabled(gameType)) {
      throw new RoomError("That game isn't available right now.");
    }
    room.gameType = gameType;
    this.touch(room);
  }

  startSubmission(code: string, playerId: string) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (!isGameEnabled("photo_guessr")) {
      throw new RoomError("Photo Guessr isn't available right now.");
    }
    if (room.phase !== "lobby") {
      throw new RoomError("Submissions can only start from the lobby.");
    }
    // This is the Photo Guessr path, so say so. Without this the room could
    // enter submission still carrying "geo_guessr" from an earlier game, and
    // `viewFor` would take its geo branch and never build a submission view.
    room.gameType = "photo_guessr";
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

  /**
   * Host-only. Start a Real GeoGuessr game from the lobby. Picks a fresh set of
   * curated locations, resolves each to a Street View panorama id (so the answer
   * coordinates never reach the browser), and begins the first round. Async
   * because panorama resolution may hit the metadata API on first use.
   */
  async startGeoGame(
    code: string,
    playerId: string,
    roundDurationSec: number,
    hostPlaying: boolean
  ) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (!isGameEnabled("geo_guessr")) {
      throw new RoomError("Real GeoGuessr isn't available right now.");
    }
    if (room.phase !== "lobby") {
      throw new RoomError("You can only start a game from the lobby.");
    }
    if (room.players.size < 2) {
      throw new RoomError("Need at least 2 players to start.");
    }
    // At least one competitor is required (if the host sits out, someone else
    // must be playing).
    const competitors = hostPlaying
      ? room.players.size
      : room.players.size - 1;
    if (competitors < 1) {
      throw new RoomError("Need at least one player besides the host.");
    }
    const duration = Number.isFinite(roundDurationSec)
      ? Math.max(30, Math.min(300, Math.round(roundDurationSec)))
      : GEO_DEFAULT_DURATION_SEC;
    const count = Math.max(1, room.settings.geoRoundCount);

    // Soft-prefer locations the current competitors haven't seen before. We
    // shuffle first (random tie-break), then stable-sort by how many of them
    // have already seen each spot. This never blocks: once everyone has seen
    // everything, it simply falls back to the least-seen locations.
    const competitorNames = [...room.players.values()]
      .filter((p) => !this.isSpectator(room, p.id))
      .map((p) => p.name);
    const seenCounts = await getSeenCounts(competitorNames);
    const pool = shuffle(GEO_LOCATIONS).sort(
      (a, b) => (seenCounts.get(a.id) ?? 0) - (seenCounts.get(b.id) ?? 0)
    );
    const rounds: GeoRound[] = [];
    for (const loc of pool) {
      if (rounds.length >= count) {
        break;
      }
      const resolved = await resolvePano(loc);
      if (!resolved) {
        continue;
      }
      rounds.push({
        id: nanoid(8),
        locationId: loc.id,
        lat: resolved.lat,
        lng: resolved.lng,
        label: loc.label,
        panoId: resolved.panoId,
        guesses: new Map<string, GeoGuess>(),
        startedAt: 0,
        durationMs: duration * 1000,
        closed: false,
      });
    }

    if (rounds.length === 0) {
      throw new RoomError(
        "Couldn't load any Street View locations. Check that a Google Maps API key is configured for the server."
      );
    }

    room.gameType = "geo_guessr";
    room.hostPlaying = hostPlaying;
    room.settings.roundDurationSec = duration;
    room.geoRounds = rounds;
    room.rounds = [];
    room.photos = [];
    room.currentRound = 0;
    for (const p of room.players.values()) {
      p.score = 0;
    }
    this.beginRound(room);
  }

  submitGeoGuess(code: string, playerId: string, lat: number, lng: number) {
    const room = this.requireRoom(code);
    if (room.gameType !== "geo_guessr" || room.phase !== "playing") {
      throw new RoomError("There's nothing to guess right now.");
    }
    if (!room.players.has(playerId)) {
      throw new RoomError("You are not in this room.");
    }
    if (this.isSpectator(room, playerId)) {
      throw new RoomError("You're spectating this game — sit back and watch!");
    }
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new RoomError("That doesn't look like a valid spot on the map.");
    }
    const round = room.geoRounds[room.currentRound];
    if (round.guesses.has(playerId)) {
      return; // already answered; ignore
    }
    const elapsed = Date.now() - round.startedAt;
    const distanceKm = haversineKm(lat, lng, round.lat, round.lng);
    round.guesses.set(playerId, {
      lat,
      lng,
      distanceKm,
      points: geoPoints(distanceKm),
      timeMs: elapsed,
    });

    // Auto-close once every connected competitor has locked in a guess.
    // Disconnected players are not waited on — otherwise a single dropout would
    // force every round to run out its full timer.
    if (this.allConnectedGuessed(room, round)) {
      this.closeRound(room);
    }
    this.touch(room);
  }

  /**
   * True when at least one connected competitor exists and all of them have
   * submitted a guess for `round`. Used to decide when a round can close early.
   * Works for both geo and photo rounds (both key `guesses` by playerId).
   */
  private allConnectedGuessed(
    room: Room,
    round: { guesses: Map<string, unknown> }
  ): boolean {
    const connected = [...room.players.values()].filter(
      (p) => p.connected && !this.isSpectator(room, p.id)
    );
    return connected.length > 0 && connected.every((p) => round.guesses.has(p.id));
  }

  /**
   * Called after a player disconnects. If that leaves the current round in a
   * state where all remaining connected players have already guessed, close it
   * early; if the host dropped during a reveal, schedule an auto-advance so the
   * game doesn't stall.
   */
  handleDisconnect(code: string) {
    const room = this.getRoom(code);
    if (!room) {
      return;
    }
    if (room.phase === "playing") {
      const round =
        room.gameType === "geo_guessr"
          ? room.geoRounds[room.currentRound]
          : room.rounds[room.currentRound];
      if (round && !round.closed && this.allConnectedGuessed(room, round)) {
        this.closeRound(room);
      }
    } else if (room.phase === "reveal") {
      this.maybeScheduleHostAbsentAdvance(room);
    }
  }

  /**
   * If the host is currently disconnected, arm a timer to advance the game past
   * the reveal on their behalf. No-op when the host is connected. Safe to call
   * repeatedly — it only ever keeps one pending timer.
   */
  private maybeScheduleHostAbsentAdvance(room: Room) {
    if (room.phase !== "reveal") {
      return;
    }
    const host = room.players.get(room.hostId);
    if (host?.connected) {
      return;
    }
    if (room.autoAdvanceTimer) {
      return; // already armed
    }
    room.autoAdvanceTimer = setTimeout(() => {
      room.autoAdvanceTimer = undefined;
      // Re-check: the host may have reconnected, or the phase moved on.
      if (room.phase !== "reveal") {
        return;
      }
      if (room.players.get(room.hostId)?.connected) {
        return;
      }
      this.advanceRound(room);
      this.onRoomChanged(room.code);
    }, HOST_ABSENT_REVEAL_MS);
  }

  private beginRound(room: Room) {
    room.phase = "playing";
    const round =
      room.gameType === "geo_guessr"
        ? room.geoRounds[room.currentRound]
        : room.rounds[room.currentRound];
    round.startedAt = Date.now();
    round.closed = false;
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
    }
    if (room.autoAdvanceTimer) {
      clearTimeout(room.autoAdvanceTimer);
      room.autoAdvanceTimer = undefined;
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

    // Auto-close once every connected eligible player has answered.
    // Disconnected players aren't waited on, so one dropout can't force the
    // round to run out its full timer.
    const eligible = [...room.players.values()].filter(
      (p) => p.connected && p.id !== round.ownerId
    );
    if (eligible.length > 0 && eligible.every((p) => round.guesses.has(p.id))) {
      this.closeRound(room);
    }
    this.touch(room);
  }

  private closeRound(room: Room) {
    if (room.gameType === "geo_guessr") {
      const round = room.geoRounds[room.currentRound];
      if (!round || round.closed) {
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
      this.maybeScheduleHostAbsentAdvance(room);
      return;
    }

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
    this.maybeScheduleHostAbsentAdvance(room);
  }

  nextRound(code: string, playerId: string) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== "reveal") {
      throw new RoomError("Finish revealing first.");
    }
    this.advanceRound(room);
  }

  /**
   * Move past the current reveal — to the next round, or to the final scoreboard
   * if this was the last one. Shared by the host's `nextRound` action and the
   * host-absent auto-advance timer, so neither carries the host permission check.
   */
  private advanceRound(room: Room) {
    if (room.autoAdvanceTimer) {
      clearTimeout(room.autoAdvanceTimer);
      room.autoAdvanceTimer = undefined;
    }
    const total =
      room.gameType === "geo_guessr"
        ? room.geoRounds.length
        : room.rounds.length;
    if (room.currentRound + 1 >= total) {
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
    if (room.autoAdvanceTimer) {
      clearTimeout(room.autoAdvanceTimer);
      room.autoAdvanceTimer = undefined;
    }
    room.phase = "lobby";
    room.photos = [];
    room.rounds = [];
    room.geoRounds = [];
    room.currentRound = 0;
    room.persisted = false;
    room.hostPlaying = false;
    // Back to the default the lobby picker opens on. Leaving the finished game's
    // type here would desync the room from a host who then picks the other game.
    room.gameType = DEFAULT_GAME_TYPE;
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
    const ranked = [...room.players.values()]
      .filter((p) => !this.isSpectator(room, p.id))
      .sort((a, b) => b.score - a.score);
    const roundCount =
      room.gameType === "geo_guessr"
        ? room.geoRounds.length
        : room.rounds.length;
    return {
      code: room.code,
      gameType: room.gameType,
      hostName: host?.name ?? "Host",
      roundCount,
      players: ranked.map((p, i) => ({
        name: p.name,
        color: p.color,
        score: p.score,
        placement: i + 1,
        isHost: p.isHost,
      })),
      geoLocationIds:
        room.gameType === "geo_guessr"
          ? room.geoRounds.map((r) => r.locationId)
          : undefined,
    };
  }

  private touch(room: Room) {
    // Hook for future persistence; for now it just keeps the idle clock honest.
    room.lastActivityAt = Date.now();
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
      spectator: this.isSpectator(room, p.id),
    }));

    const state: RoomState = {
      code: room.code,
      phase: room.phase,
      gameType: room.gameType,
      hostId: room.hostId,
      visibility: room.visibility,
      players,
      settings: room.settings,
    };

    if (room.gameType === "geo_guessr") {
      const competitorCount = [...room.players.keys()].filter(
        (id) => !this.isSpectator(room, id)
      ).length;

      if (room.phase === "playing") {
        const round = room.geoRounds[room.currentRound];
        const myGuess = round.guesses.get(viewerId);
        state.geoRound = {
          index: room.currentRound,
          total: room.geoRounds.length,
          panoId: round.panoId,
          endsAt: round.startedAt + round.durationMs,
          answeredCount: round.guesses.size,
          guessCount: competitorCount,
          iGuessed: round.guesses.has(viewerId),
          myGuess: myGuess ? { lat: myGuess.lat, lng: myGuess.lng } : undefined,
          isHost: viewerId === room.hostId,
          spectating: this.isSpectator(room, viewerId),
        };
      }

      if (room.phase === "reveal") {
        const round = room.geoRounds[room.currentRound];
        const results = [...room.players.values()]
          .filter((p) => !this.isSpectator(room, p.id))
          .map((p) => {
            const g = round.guesses.get(p.id);
            return {
              playerId: p.id,
              guess: g ? { lat: g.lat, lng: g.lng } : null,
              distanceKm: g ? g.distanceKm : null,
              points: g ? g.points : 0,
            };
          });
        state.geoReveal = {
          index: room.currentRound,
          total: room.geoRounds.length,
          panoId: round.panoId,
          answer: { lat: round.lat, lng: round.lng, label: round.label },
          results,
        };
      }

      if (room.phase === "final") {
        state.final = {
          ranking: [...room.players.values()]
            .filter((p) => !this.isSpectator(room, p.id))
            .sort((a, b) => b.score - a.score)
            .map((p) => ({ playerId: p.id, score: p.score })),
        };
      }

      return state;
    }

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
          .filter((p) => !this.isSpectator(room, p.id))
          .sort((a, b) => b.score - a.score)
          .map((p) => ({ playerId: p.id, score: p.score })),
      };
    }

    return state;
  }

  /**
   * Remove idle rooms nobody is connected to.
   *
   * Two TTLs, because the two cases are worth very different grace periods. An
   * abandoned *lobby* holds nothing — no scores, no rounds — so it goes after
   * `emptyLobbyTtlMs`; keeping it around just leaks memory and (now) clutters
   * the games browser. A room that got past the lobby holds a real game, and
   * everyone dropping at once usually means a shared network blip rather than
   * everyone quitting, so it keeps the long TTL to protect the rejoin flow.
   *
   * Both measure from last activity, not creation: a game still going after the
   * TTL shouldn't be reaped the moment its players briefly drop.
   */
  sweep(ttlMs = 1000 * 60 * 60 * 6, emptyLobbyTtlMs = 1000 * 60 * 10) {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const anyConnected = [...room.players.values()].some((p) => p.connected);
      const ttl = room.phase === "lobby" ? emptyLobbyTtlMs : ttlMs;
      if (!anyConnected && now - room.lastActivityAt > ttl) {
        if (room.roundTimer) {
          clearTimeout(room.roundTimer);
        }
        if (room.autoAdvanceTimer) {
          clearTimeout(room.autoAdvanceTimer);
        }
        this.rooms.delete(code);
      }
    }
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, 20);
}

/** PINs are 4-6 digits. Throws a user-facing RoomError when malformed. */
function validatePin(pin: string): void {
  if (!/^\d{4,6}$/.test(pin ?? "")) {
    throw new RoomError("Your PIN must be 4 to 6 digits.");
  }
}
