import { nanoid } from "nanoid";
import {
  DEFAULT_GAME_TYPE,
  DEFAULT_SETTINGS,
  GEO_DEFAULT_DURATION_SEC,
  MAX_PLAYERS_PER_ROOM,
  DRAW_CANVAS_UNITS,
  DRAW_COLORS,
  DRAW_DEFAULT_DURATION_SEC,
  DRAW_MAX_ROUNDS,
  DRAW_PICK_SECONDS,
  DRAW_WIDTHS,
  WORD_CHAIN_DEFAULT_DURATION_SEC,
  WORD_CHAIN_DEFAULT_LENGTH,
  isGameEnabled,
  isKnownGameType,
  type GameSettings,
  type GamePhase,
  type GameType,
  type RoomState,
  type PublicPlayer,
  type PublicRoomSummary,
  type RoomVisibility,
  type DrawChatLine,
  type DrawDifficultyChoice,
  type DrawGuessResult,
  type DrawStroke,
  type WordChainDifficulty,
  type WordChainDifficultyChoice,
  type WordChainGuessResult,
  type WordChainStanding,
} from "../src/shared/types";
import { DRAW_WORDS, maskWord, normalizeGuess, type DrawWord } from "./drawWords";
import { GEO_LOCATIONS, resolvePano } from "./geoLocations";
import { WORD_CHAINS, freeLetters, normalizeWord } from "./wordChains";
import {
  claimOrVerifyName,
  getSeenCounts,
  getSeenDrawCounts,
  getSeenPuzzleCounts,
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

/**
 * A player's avatar color, by join order.
 *
 * The first ten keep the hand-picked palette, so a normal-sized game looks
 * exactly as it always has. Past that we walk the hue circle by the golden angle
 * (137.5°), which spreads each new hue into the largest remaining gap.
 *
 * Note this only guarantees *distinct* colors, not distinguishable ones — at
 * these counts no palette could. Beyond ~10 players the name is the identity and
 * color is decoration; don't build anything that relies on telling player 60
 * from player 79 by hue alone.
 */
function playerColor(index: number): string {
  if (index < PLAYER_COLORS.length) {
    return PLAYER_COLORS[index];
  }
  // Offset past the curated block so generated hues don't restart on top of it.
  const hue = ((index - PLAYER_COLORS.length + 1) * 137.508) % 360;
  // Light + saturated: avatars render dark text on this background.
  return `hsl(${hue.toFixed(1)} 70% 65%)`;
}

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

/**
 * One player's run at the current chain.
 *
 * Solved from both ends inwards, so progress is two counters rather than one:
 * `solvedFront` blanks filled from the top, `solvedBack` from the bottom. That
 * leaves at most two blanks open at a time — one at each frontier — and being
 * stuck on a link stops you moving one way rather than stopping you dead.
 */
interface WordChainProgress {
  solvedFront: number;
  solvedBack: number;
  /** Extra letters bought per blank, index-aligned with the chain's blanks. */
  hints: number[];
  hintsUsed: number;
  wrongGuesses: number;
  /** ms from round start to completing the chain; unset while still solving. */
  finishedMs?: number;
}

interface WordChainRound {
  id: string;
  puzzleId: string;
  difficulty: WordChainDifficulty;
  /** The whole chain. `words[0]` and the last word are given; the rest are the
   * blanks, so a six-word chain is four blanks. Never sent to clients wholesale
   * until the reveal. */
  words: string[];
  progress: Map<string, WordChainProgress>;
  startedAt: number;
  durationMs: number;
  closed: boolean;
}

interface DrawGuessRecord {
  correct: boolean;
  timeMs: number;
  points: number;
}

/**
 * One player's turn at the easel.
 *
 * `word` is empty until they pick, which is what separates the `picking` phase
 * from `playing` — there is nothing to draw or guess until it's set.
 */
interface DrawRound {
  id: string;
  drawerId: string;
  /** The three offered; only ever sent to the drawer. */
  choices: DrawWord[];
  word: string;
  wordId: string;
  strokes: DrawStroke[];
  guesses: Map<string, DrawGuessRecord>;
  chat: DrawChatLine[];
  /** When the pick deadline expires — the server picks for them if it does. */
  pickEndsAt: number;
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
  // Word Chain is one puzzle per game, but it rides the same
  // beginRound/closeRound/advanceRound machinery as the others, so it's a
  // (currently single-element) list rather than a special case.
  wordRounds: WordChainRound[];
  drawRounds: DrawRound[];
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

// Word Chain scoring. A clean instant sweep tops out at 2000 + 1000 + 2000 =
// 5000 — the same ceiling as a perfect GeoGuessr round, which keeps the two
// games' scores on one scale.
//
// The solve points are a fixed pot *split across however many blanks the chain
// has*, rather than a rate per blank. Chains come in several lengths now, and a
// rate would make a six-blank chain worth half as much again as a four-blank
// one — so the season leaderboard would quietly reward whoever picked "long"
// rather than whoever played well.
//
// The shape matters more than the numbers: partial credit per link means a
// player who runs out of time still scores, while the completion and speed
// bonuses are what make it a race rather than a crossword.
const WORD_CHAIN_SOLVE_POINTS = 2000;
const WORD_CHAIN_FINISH_BONUS = 1000;
const WORD_CHAIN_SPEED_BONUS_MAX = 2000;
// A hint costs a fifth of a link, so buying one is never worse than giving up
// on the word, and it costs the same share of the game whatever the length.
// (At four blanks that's the flat 100 this started out as.)
const WORD_CHAIN_HINT_FRACTION = 0.2;

// Draw It scoring, on the same 5000-per-round ceiling as everything else.
//
// A guesser gets a flat award for getting there at all plus a speed bonus, so
// the tenth person to solve it still scores. The drawer is paid on the *share*
// of the room that solved it, never the count — otherwise a twenty-player room
// would pay double a ten-player one for the same drawing, and they share a
// leaderboard.
const DRAW_SOLVE_POINTS = 2000;
const DRAW_SPEED_BONUS_MAX = 3000;
const DRAW_DRAWER_MAX = 5000;

// Ceilings on what one round's canvas and chat can hold. Room state lives in
// memory and a drawing arrives from a browser, so these bound what a stuck
// finger — or a hostile client — can make the server keep and rebroadcast.
// Generous enough that no honest drawing comes near them.
const MAX_STROKES_PER_ROUND = 600;
const MAX_STROKES_PER_BATCH = 40;
const MAX_POINTS_PER_STROKE = 400;
const MAX_CHAT_LINES = 120;
const MAX_GUESS_LENGTH = 60;

/** Coerce an untrusted array index into range. */
function clampIndex(value: unknown, length: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < length ? n : 0;
}

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
      if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
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
        maxPlayers: MAX_PLAYERS_PER_ROOM,
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

  /**
   * Names of everyone who'd be competing under a given host-playing choice.
   * Takes `hostPlaying` explicitly because the start paths need this *before*
   * committing the choice to the room.
   */
  private competitorNames(room: Room, hostPlaying: boolean): string[] {
    return [...room.players.values()]
      .filter((p) => hostPlaying || p.id !== room.hostId)
      .map((p) => p.name);
  }

  /**
   * The competitors a game would start with, or a user-facing throw when that's
   * nobody.
   *
   * One is enough. A lone player still has a real game — a clock, a score, a
   * leaderboard row — and refusing to start it only ever turned away the person
   * who wanted to try the thing out. What has to be rejected is a game with
   * *zero* competitors, which is what a host running the big screen with an
   * empty room would produce.
   */
  private requireCompetitors(room: Room, hostPlaying: boolean): string[] {
    const names = this.competitorNames(room, hostPlaying);
    if (names.length < 1) {
      throw new RoomError(
        "Nobody's playing — tick “I'm playing too” or wait for someone to join."
      );
    }
    return names;
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
      wordRounds: [],
      drawRounds: [],
      currentRound: 0,
      createdAt: now,
      lastActivityAt: now,
      persisted: false,
    };
    room.players.set(playerId, {
      id: playerId,
      name: cleanName(name) || "Host",
      color: playerColor(0),
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
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
      throw new RoomError("This room is full.");
    }
    validatePin(pin);
    const claim = await claimOrVerifyName(cleanName(name) || "Player", pin);
    if (!claim.ok) {
      throw new RoomError(claim.reason);
    }
    const playerId = nanoid(10);
    // Join order indexes the color. Safe because players are never removed from
    // a room — if a leave/kick is ever added, this needs a real allocator.
    const color = playerColor(room.players.size);
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

  /** Returns which player in which room went offline, so the socket layer can
   * send a targeted delta instead of re-broadcasting the whole room. */
  markDisconnected(socketId: string): { code: string; playerId: string }[] {
    const changed: { code: string; playerId: string }[] = [];
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) {
          player.connected = false;
          player.socketId = undefined;
          changed.push({ code: room.code, playerId: player.id });
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
    if (!isKnownGameType(gameType)) {
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
    const competitorNames = this.requireCompetitors(room, hostPlaying);
    const duration = Number.isFinite(roundDurationSec)
      ? Math.max(30, Math.min(300, Math.round(roundDurationSec)))
      : GEO_DEFAULT_DURATION_SEC;
    const count = Math.max(1, room.settings.geoRoundCount);

    // Soft-prefer locations the current competitors haven't seen before. We
    // shuffle first (random tie-break), then stable-sort by how many of them
    // have already seen each spot. This never blocks: once everyone has seen
    // everything, it simply falls back to the least-seen locations.
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
    room.wordRounds = [];
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
   * Host-only. Start a Word Chain race from the lobby.
   *
   * One seeded puzzle, one clock, everybody solving the same chain at once.
   * Unlike the other games this one is playable solo — a lone host racing the
   * timer is a perfectly good version of it — so the only floor is that
   * somebody is actually competing.
   *
   * Async because puzzle choice consults each competitor's history.
   */
  async startWordChainGame(
    code: string,
    playerId: string,
    durationSec: number,
    hostPlaying: boolean,
    difficulty: WordChainDifficultyChoice = "any",
    length: number = WORD_CHAIN_DEFAULT_LENGTH
  ) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (!isGameEnabled("word_chain")) {
      throw new RoomError("Word Chain isn't available right now.");
    }
    if (room.phase !== "lobby") {
      throw new RoomError("You can only start a game from the lobby.");
    }
    const competitorNames = this.requireCompetitors(room, hostPlaying);
    const duration = Number.isFinite(durationSec)
      ? Math.max(30, Math.min(600, Math.round(durationSec)))
      : WORD_CHAIN_DEFAULT_DURATION_SEC;

    // Hard-prefer a puzzle nobody in the room has played: a Word Chain game is
    // a single puzzle, so a repeat isn't a mild annoyance the way a repeated
    // GeoGuessr location is — it hands whoever saw it before the whole game.
    // Only when this group has collectively played the entire bank does it fall
    // back to the least-seen chain. Shuffle first so the fallback's stable sort
    // breaks ties randomly, and so the unseen case is a plain random pick.
    // The host's choices narrow the bank first, then the never-repeat rule
    // picks within what's left. That ordering matters: honouring the choice and
    // then falling back to least-seen inside it keeps a group that has
    // exhausted "hard" on hard puzzles rather than quietly handing them an easy
    // one.
    //
    // Length doesn't give way at all. A tier that can't be filled is a runtime
    // condition worth absorbing quietly; a length with no chains behind it is a
    // bug in the bank, and silently handing over a different-shaped puzzle
    // would hide it from everyone including whoever picked it.
    const byLength = WORD_CHAINS.filter((p) => p.words.length === length);
    if (byLength.length === 0) {
      throw new RoomError("That chain length isn't available right now.");
    }
    const tier =
      difficulty === "any"
        ? byLength
        : byLength.filter((p) => p.difficulty === difficulty);
    const pool = tier.length > 0 ? tier : byLength;

    const seen = await getSeenPuzzleCounts(competitorNames);
    const unseen = pool.filter((p) => !seen.has(p.id));
    const puzzle = shuffle(unseen.length > 0 ? unseen : pool).sort(
      (a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0)
    )[0];

    room.gameType = "word_chain";
    room.hostPlaying = hostPlaying;
    room.settings.roundDurationSec = duration;
    room.wordRounds = [
      {
        id: nanoid(8),
        puzzleId: puzzle.id,
        difficulty: puzzle.difficulty,
        words: [...puzzle.words],
        progress: new Map<string, WordChainProgress>(),
        startedAt: 0,
        durationMs: duration * 1000,
        closed: false,
      },
    ];
    room.geoRounds = [];
    room.rounds = [];
    room.photos = [];
    room.currentRound = 0;
    for (const p of room.players.values()) {
      p.score = 0;
    }
    this.beginRound(room);
  }

  /** This player's run at the current chain, created on first contact. */
  private wordProgress(
    round: WordChainRound,
    playerId: string
  ): WordChainProgress {
    let progress = round.progress.get(playerId);
    if (!progress) {
      progress = {
        solvedFront: 0,
        solvedBack: 0,
        hints: [],
        hintsUsed: 0,
        wrongGuesses: 0,
      };
      round.progress.set(playerId, progress);
    }
    return progress;
  }

  /** How many blanks a chain has. */
  private blankCount(round: WordChainRound): number {
    return round.words.length - 2;
  }

  /** Blanks filled so far, from both ends. */
  private solvedCount(progress: WordChainProgress | undefined): number {
    return progress ? progress.solvedFront + progress.solvedBack : 0;
  }

  /**
   * The blanks this player may answer right now: the frontier from the top and
   * the frontier from the bottom. Two while they're apart, one when they meet
   * on the last blank, none once the chain is done.
   */
  private activeBlanks(
    round: WordChainRound,
    progress: WordChainProgress | undefined
  ): number[] {
    const total = this.blankCount(round);
    const front = progress?.solvedFront ?? 0;
    const back = total - 1 - (progress?.solvedBack ?? 0);
    if (front > back) {
      return [];
    }
    return front === back ? [front] : [front, back];
  }

  /** Whether a blank has already been filled, from either direction. */
  private isBlankSolved(
    round: WordChainRound,
    progress: WordChainProgress | undefined,
    index: number
  ): boolean {
    const total = this.blankCount(round);
    return (
      index < (progress?.solvedFront ?? 0) ||
      index > total - 1 - (progress?.solvedBack ?? 0)
    );
  }

  /** The round a Word Chain player must be in to act, or a user-facing throw. */
  private requireWordRound(code: string, playerId: string) {
    const room = this.requireRoom(code);
    if (room.gameType !== "word_chain" || room.phase !== "playing") {
      throw new RoomError("There's nothing to solve right now.");
    }
    if (!room.players.has(playerId)) {
      throw new RoomError("You are not in this room.");
    }
    if (this.isSpectator(room, playerId)) {
      throw new RoomError("You're spectating this game — sit back and watch!");
    }
    const round = room.wordRounds[room.currentRound];
    if (!round || round.closed) {
      throw new RoomError("This puzzle is already over.");
    }
    return { room, round, progress: this.wordProgress(round, playerId) };
  }

  /**
   * Answer the blank this player is currently on. Wrong answers cost nothing
   * but time — the clock is the pressure here, and a guessing penalty would
   * mostly punish typos.
   */
  submitWordGuess(
    code: string,
    playerId: string,
    index: number,
    guess: string
  ): WordChainGuessResult {
    const { room, round, progress } = this.requireWordRound(code, playerId);
    const solved = this.solvedCount(progress);

    if (progress.finishedMs !== undefined) {
      return { correct: false, solved, finished: true };
    }
    // An index that isn't currently open means the client is answering a blank
    // it has already moved past — a retried emit, or a stale view. Ignore it
    // rather than crediting the answer to the wrong word.
    const active = this.activeBlanks(round, progress);
    if (!active.includes(index)) {
      return { correct: false, solved, finished: false };
    }

    const answer = normalizeWord(round.words[index + 1]);
    if (normalizeWord(guess) !== answer) {
      progress.wrongGuesses += 1;
      this.touch(room);
      return { correct: false, solved, finished: false };
    }

    // Advance whichever frontier this blank belongs to. When the two have met
    // on the last blank, either counter closes the chain; front is arbitrary.
    if (index === progress.solvedFront) {
      progress.solvedFront += 1;
    } else {
      progress.solvedBack += 1;
    }

    const finished = this.solvedCount(progress) >= this.blankCount(round);
    if (finished) {
      progress.finishedMs = Date.now() - round.startedAt;
    }
    // Everyone's done — no reason to make the last finisher watch the clock.
    if (finished && this.allConnectedFinished(room, round)) {
      this.closeRound(room);
    }
    this.touch(room);
    return {
      correct: true,
      solved: this.solvedCount(progress),
      finished,
      word: answer,
    };
  }

  /**
   * Buy one more letter of the current blank. Private to the buyer: it changes
   * only their view and only their score.
   */
  revealWordHint(
    code: string,
    playerId: string,
    index: number
  ): { index: number; revealed: string; hintsUsed: number } {
    const { room, round, progress } = this.requireWordRound(code, playerId);
    if (progress.finishedMs !== undefined) {
      throw new RoomError("You've already finished the chain.");
    }
    // Only an open blank can be bought. Otherwise a player could spend hints
    // reading ahead down the chain instead of solving toward it.
    if (!this.activeBlanks(round, progress).includes(index)) {
      throw new RoomError("That word isn't in play right now.");
    }
    const answer = round.words[index + 1];
    const bought = progress.hints[index] ?? 0;
    const shown = freeLetters(answer) + bought;
    // The last letter is never for sale — a hint should narrow the guess, not
    // finish it.
    if (shown >= answer.length - 1) {
      throw new RoomError("No more hints for this word.");
    }
    progress.hints[index] = bought + 1;
    progress.hintsUsed += 1;
    this.touch(room);
    return {
      index,
      revealed: answer.slice(0, shown + 1),
      hintsUsed: progress.hintsUsed,
    };
  }

  /** What one hint costs on this chain — a fifth of what a link is worth. */
  private wordChainHintCost(round: WordChainRound): number {
    return Math.round(
      (WORD_CHAIN_SOLVE_POINTS / this.blankCount(round)) *
        WORD_CHAIN_HINT_FRACTION
    );
  }

  /** What one player's run is worth. Recomputed rather than accumulated, so
   * there's one definition of the score and no drift between the live view and
   * what lands on the scoreboard. */
  private wordChainPoints(
    round: WordChainRound,
    progress: WordChainProgress
  ): number {
    const blanks = this.blankCount(round);
    // Rounded once off the fraction solved, not accumulated per blank, so the
    // pot always adds up exactly however it divides.
    const linkValue = WORD_CHAIN_SOLVE_POINTS / blanks;
    let points = Math.round(
      this.solvedCount(progress) * linkValue -
        progress.hintsUsed * linkValue * WORD_CHAIN_HINT_FRACTION
    );
    if (progress.finishedMs !== undefined) {
      const remaining = Math.max(
        0,
        1 - progress.finishedMs / round.durationMs
      );
      points +=
        WORD_CHAIN_FINISH_BONUS +
        Math.round(WORD_CHAIN_SPEED_BONUS_MAX * remaining);
    }
    // Hints can't dig a player into the negative.
    return Math.max(0, points);
  }

  /**
   * True when at least one connected competitor exists and all of them have
   * completed the chain. The Word Chain equivalent of `allConnectedGuessed` —
   * separate because "done" here is finishing, not having an entry.
   */
  private allConnectedFinished(room: Room, round: WordChainRound): boolean {
    const connected = [...room.players.values()].filter(
      (p) => p.connected && !this.isSpectator(room, p.id)
    );
    return (
      connected.length > 0 &&
      connected.every(
        (p) => round.progress.get(p.id)?.finishedMs !== undefined
      )
    );
  }

  /**
   * Host-only. Start Draw It from the lobby.
   *
   * Builds the whole running order up front — who draws, in what order, with
   * which three words — so the rotation is decided once rather than negotiated
   * round by round, and so every drawer's words can be checked against everyone's
   * history in a single query.
   */
  async startDrawItGame(
    code: string,
    playerId: string,
    roundDurationSec: number,
    hostPlaying: boolean,
    difficulty: DrawDifficultyChoice = "any"
  ) {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (!isGameEnabled("draw_it")) {
      throw new RoomError("Draw It isn't available right now.");
    }
    if (room.phase !== "lobby") {
      throw new RoomError("You can only start a game from the lobby.");
    }
    const competitorNames = this.requireCompetitors(room, hostPlaying);
    // Someone has to be guessing while someone else draws, and with two people
    // the guesser is simply told the answer by the drawing. Three is the floor.
    if (competitorNames.length < 3) {
      throw new RoomError("Draw It needs at least 3 players.");
    }
    const duration = Number.isFinite(roundDurationSec)
      ? Math.max(30, Math.min(300, Math.round(roundDurationSec)))
      : DRAW_DEFAULT_DURATION_SEC;

    const tier =
      difficulty === "any"
        ? DRAW_WORDS
        : DRAW_WORDS.filter((w) => w.difficulty === difficulty);
    const pool = tier.length > 0 ? tier : DRAW_WORDS;

    // Prefer words none of these players have had. Unlike a chain, a repeat
    // here only spoils it for whoever remembers it, so this stays a preference
    // rather than a hard filter — and with three words offered per turn the
    // bank drains three times as fast as a one-puzzle game's would.
    const seen = await getSeenDrawCounts(competitorNames);
    const ranked = shuffle(pool).sort(
      (a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0)
    );

    const drawers = shuffle(
      [...room.players.values()]
        .filter((p) => hostPlaying || p.id !== room.hostId)
        .map((p) => p.id)
    ).slice(0, DRAW_MAX_ROUNDS);

    let next = 0;
    const rounds: DrawRound[] = drawers.map((drawerId) => {
      const choices = ranked.slice(next, next + 3);
      next += 3;
      return {
        id: nanoid(8),
        drawerId,
        choices,
        word: "",
        wordId: "",
        strokes: [],
        guesses: new Map<string, DrawGuessRecord>(),
        chat: [],
        pickEndsAt: 0,
        startedAt: 0,
        durationMs: duration * 1000,
        closed: false,
      };
    });

    room.gameType = "draw_it";
    room.hostPlaying = hostPlaying;
    room.settings.roundDurationSec = duration;
    room.drawRounds = rounds;
    room.geoRounds = [];
    room.wordRounds = [];
    room.rounds = [];
    room.photos = [];
    room.currentRound = 0;
    for (const p of room.players.values()) {
      p.score = 0;
    }
    this.beginPick(room);
  }

  /**
   * Open the word choice for the round's drawer. The clock on the round proper
   * doesn't start until they've picked, so a slow chooser doesn't eat the
   * guessers' time — but the pick itself is deadlined, or a drawer who wandered
   * off would stall the game.
   */
  private beginPick(room: Room) {
    const round = room.drawRounds[room.currentRound];
    room.phase = "picking";
    round.pickEndsAt = Date.now() + DRAW_PICK_SECONDS * 1000;
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
    }
    if (room.autoAdvanceTimer) {
      clearTimeout(room.autoAdvanceTimer);
      room.autoAdvanceTimer = undefined;
    }
    room.roundTimer = setTimeout(() => {
      // Out of time: take the first word for them and get on with it.
      if (room.phase === "picking" && !round.word) {
        this.commitWord(room, round, round.choices[0]);
        this.onRoomChanged(room.code);
      }
    }, DRAW_PICK_SECONDS * 1000 + 500);
    this.touch(room);
  }

  /** Drawer-only. Lock in one of the three offered words and start drawing. */
  pickDrawWord(code: string, playerId: string, word: string) {
    const room = this.requireRoom(code);
    if (room.gameType !== "draw_it" || room.phase !== "picking") {
      throw new RoomError("There's nothing to choose right now.");
    }
    const round = room.drawRounds[room.currentRound];
    if (round.drawerId !== playerId) {
      throw new RoomError("Only the drawer picks the word.");
    }
    const choice = round.choices.find((c) => c.word === word);
    if (!choice) {
      throw new RoomError("That isn't one of your words.");
    }
    this.commitWord(room, round, choice);
  }

  private commitWord(room: Room, round: DrawRound, choice: DrawWord) {
    round.word = choice.word;
    round.wordId = choice.id;
    room.phase = "playing";
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

  /**
   * The round in play, if the caller is its drawer and there is still time.
   *
   * Returns null rather than throwing when the round has moved on, because a
   * stroke landing just after the last guesser solves it is ordinary — the
   * drawer's hand was already moving. Only drawing when you aren't the drawer
   * is an actual error worth telling someone about.
   */
  private liveDrawRound(code: string, playerId: string) {
    const room = this.getRoom(code);
    if (!room || room.gameType !== "draw_it") {
      return null;
    }
    const round = room.drawRounds[room.currentRound];
    if (!round) {
      return null;
    }
    if (round.drawerId !== playerId) {
      throw new RoomError("You're not the one drawing.");
    }
    if (room.phase !== "playing" || round.closed) {
      return null;
    }
    return { room, round };
  }

  /**
   * Append finished strokes to the canvas.
   *
   * Sanitised rather than trusted: a stroke arrives from a browser, and the
   * server is what every other client renders from. Bad indices, odd-length
   * point lists and out-of-range coordinates are all fixable here and all
   * unfixable once they've been broadcast.
   */
  appendDrawStrokes(code: string, playerId: string, strokes: DrawStroke[]) {
    const live = this.liveDrawRound(code, playerId);
    if (!live || !Array.isArray(strokes)) {
      return;
    }
    const { room, round } = live;
    for (const stroke of strokes.slice(0, MAX_STROKES_PER_BATCH)) {
      const points = Array.isArray(stroke?.points) ? stroke.points : [];
      // Pairs only, and long enough to be a mark rather than a stray tap.
      const usable = points.length - (points.length % 2);
      if (usable < 2) {
        continue;
      }
      if (round.strokes.length >= MAX_STROKES_PER_ROUND) {
        break;
      }
      round.strokes.push({
        // Client-chosen and only ever compared to its neighbours, so a junk id
        // can group a stroke oddly for whoever sent it and nothing more.
        id: String(stroke?.id ?? "").slice(0, 12) || nanoid(6),
        color: clampIndex(stroke.color, DRAW_COLORS.length),
        width: clampIndex(stroke.width, DRAW_WIDTHS.length),
        points: points
          .slice(0, Math.min(usable, MAX_POINTS_PER_STROKE * 2))
          .map((n) =>
            Number.isFinite(n)
              ? Math.max(0, Math.min(DRAW_CANVAS_UNITS, Math.round(n)))
              : 0
          ),
      });
    }
    this.touch(room);
  }

  /** Drawer-only. Drop the last stroke, or wipe the canvas. */
  editDrawCanvas(code: string, playerId: string, action: "undo" | "clear") {
    const live = this.liveDrawRound(code, playerId);
    if (!live) {
      return this.drawStrokes(code);
    }
    const { room, round } = live;
    if (action === "clear") {
      round.strokes = [];
    } else {
      // Undo takes back a pen-down, not a fragment of one: drop every trailing
      // segment that shares the last one's id.
      const last = round.strokes[round.strokes.length - 1];
      if (last) {
        while (
          round.strokes.length > 0 &&
          round.strokes[round.strokes.length - 1].id === last.id
        ) {
          round.strokes.pop();
        }
      }
    }
    this.touch(room);
    return round.strokes;
  }

  /**
   * Submit a guess.
   *
   * Returns whether it was right and what it earned. The word is never in the
   * return value, and a correct guess produces a chat line with empty text —
   * everything that leaves this method is safe to show the whole room.
   */
  submitDrawGuess(
    code: string,
    playerId: string,
    text: string
  ): { result: DrawGuessResult; line: DrawChatLine | null } {
    const room = this.requireRoom(code);
    if (room.gameType !== "draw_it" || room.phase !== "playing") {
      throw new RoomError("There's nothing to guess right now.");
    }
    if (!room.players.has(playerId)) {
      throw new RoomError("You are not in this room.");
    }
    const round = room.drawRounds[room.currentRound];
    if (round.drawerId === playerId) {
      throw new RoomError("You're drawing this one!");
    }
    if (this.isSpectator(room, playerId)) {
      throw new RoomError("You're spectating this game — sit back and watch!");
    }
    if (round.guesses.get(playerId)?.correct) {
      return { result: { correct: false, points: 0 }, line: null };
    }

    const clean = text.trim().slice(0, MAX_GUESS_LENGTH);
    if (!clean) {
      return { result: { correct: false, points: 0 }, line: null };
    }

    if (normalizeGuess(clean) !== normalizeGuess(round.word)) {
      const line: DrawChatLine = {
        id: nanoid(6),
        playerId,
        text: clean,
        solved: false,
      };
      round.chat.push(line);
      if (round.chat.length > MAX_CHAT_LINES) {
        round.chat.shift();
      }
      this.touch(room);
      return { result: { correct: false, points: 0 }, line };
    }

    const elapsed = Date.now() - round.startedAt;
    const remaining = Math.max(0, 1 - elapsed / round.durationMs);
    const points = DRAW_SOLVE_POINTS + Math.round(DRAW_SPEED_BONUS_MAX * remaining);
    round.guesses.set(playerId, { correct: true, timeMs: elapsed, points });

    // The word is deliberately absent — this line goes to everyone.
    const line: DrawChatLine = {
      id: nanoid(6),
      playerId,
      text: "",
      solved: true,
    };
    round.chat.push(line);
    if (round.chat.length > MAX_CHAT_LINES) {
      round.chat.shift();
    }

    if (this.allConnectedSolved(room, round)) {
      this.closeRound(room);
    }
    this.touch(room);
    return { result: { correct: true, points }, line };
  }

  /** Everyone who could guess, has. */
  private allConnectedSolved(room: Room, round: DrawRound): boolean {
    const guessers = [...room.players.values()].filter(
      (p) =>
        p.connected &&
        p.id !== round.drawerId &&
        !this.isSpectator(room, p.id)
    );
    return (
      guessers.length > 0 &&
      guessers.every((p) => round.guesses.get(p.id)?.correct)
    );
  }

  /** Everyone in the room who is guessing this round. */
  private drawGuesserIds(room: Room, round: DrawRound): string[] {
    return [...room.players.keys()].filter(
      (id) => id !== round.drawerId && !this.isSpectator(room, id)
    );
  }

  /** What the drawer earned: the ceiling, scaled by the share who solved it. */
  private drawerPoints(room: Room, round: DrawRound): number {
    const guessers = this.drawGuesserIds(room, round);
    if (guessers.length === 0) {
      return 0;
    }
    const solved = guessers.filter(
      (id) => round.guesses.get(id)?.correct
    ).length;
    return Math.round(DRAW_DRAWER_MAX * (solved / guessers.length));
  }

  /** How many guessers have it — the counter the chat header shows. */
  drawSolvedCount(code: string): number {
    const room = this.getRoom(code);
    if (!room || room.gameType !== "draw_it") {
      return 0;
    }
    const round = room.drawRounds[room.currentRound];
    if (!round) {
      return 0;
    }
    return this.drawGuesserIds(room, round).filter(
      (id) => round.guesses.get(id)?.correct
    ).length;
  }

  /** The canvas as the server holds it, for the undo/clear rebroadcast. */
  drawStrokes(code: string): DrawStroke[] {
    const room = this.getRoom(code);
    if (!room || room.gameType !== "draw_it") {
      return [];
    }
    return room.drawRounds[room.currentRound]?.strokes ?? [];
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
    if (room.gameType === "draw_it" && room.phase === "picking") {
      // Nobody to choose. Take the first word so the room isn't stuck behind
      // someone who has gone.
      const round = room.drawRounds[room.currentRound];
      if (round && !round.word && !room.players.get(round.drawerId)?.connected) {
        this.commitWord(room, round, round.choices[0]);
      }
    } else if (room.gameType === "draw_it" && room.phase === "playing") {
      const round = room.drawRounds[room.currentRound];
      if (round && !round.closed) {
        // The drawer leaving ends the round — there is nothing left to guess
        // from. Whoever already solved it keeps what they earned.
        if (!room.players.get(round.drawerId)?.connected) {
          this.closeRound(room);
        } else if (this.allConnectedSolved(room, round)) {
          this.closeRound(room);
        }
      }
    } else if (room.phase === "playing" && room.gameType === "word_chain") {
      const round = room.wordRounds[room.currentRound];
      if (round && !round.closed && this.allConnectedFinished(room, round)) {
        this.closeRound(room);
      }
    } else if (room.phase === "playing") {
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

  /**
   * The round currently in play, whichever game this room is running. All three
   * round shapes carry the same clock fields, which is what lets `beginRound`
   * and the sweep stay game-agnostic.
   */
  private activeRound(
    room: Room
  ): InternalRound | GeoRound | WordChainRound | DrawRound {
    switch (room.gameType) {
      case "geo_guessr":
        return room.geoRounds[room.currentRound];
      case "word_chain":
        return room.wordRounds[room.currentRound];
      case "draw_it":
        return room.drawRounds[room.currentRound];
      default:
        return room.rounds[room.currentRound];
    }
  }

  /** How many rounds this room's game has in total. */
  private roundCount(room: Room): number {
    switch (room.gameType) {
      case "geo_guessr":
        return room.geoRounds.length;
      case "word_chain":
        return room.wordRounds.length;
      case "draw_it":
        return room.drawRounds.length;
      default:
        return room.rounds.length;
    }
  }

  private beginRound(room: Room) {
    room.phase = "playing";
    const round = this.activeRound(room);
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
    if (room.gameType === "draw_it") {
      const round = room.drawRounds[room.currentRound];
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
        if (player && guess.correct) {
          player.score += guess.points;
        }
      }
      const drawer = room.players.get(round.drawerId);
      if (drawer) {
        drawer.score += this.drawerPoints(room, round);
      }
      room.phase = "reveal";
      this.maybeScheduleHostAbsentAdvance(room);
      return;
    }

    if (room.gameType === "word_chain") {
      const round = room.wordRounds[room.currentRound];
      if (!round || round.closed) {
        return;
      }
      round.closed = true;
      if (room.roundTimer) {
        clearTimeout(room.roundTimer);
        room.roundTimer = undefined;
      }
      for (const [playerId, progress] of round.progress) {
        const player = room.players.get(playerId);
        if (player) {
          player.score += this.wordChainPoints(round, progress);
        }
      }
      room.phase = "reveal";
      this.maybeScheduleHostAbsentAdvance(room);
      return;
    }

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
    if (room.currentRound + 1 >= this.roundCount(room)) {
      room.phase = "final";
      this.touch(room);
      this.onGameFinished(room.code);
      return;
    }
    room.currentRound += 1;
    // Draw It's round opens on a word choice rather than a running clock, so it
    // enters through its own door.
    if (room.gameType === "draw_it") {
      this.beginPick(room);
      return;
    }
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
    room.wordRounds = [];
    room.drawRounds = [];
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
    return {
      code: room.code,
      gameType: room.gameType,
      hostName: host?.name ?? "Host",
      roundCount: this.roundCount(room),
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
      wordPuzzleIds:
        room.gameType === "word_chain"
          ? room.wordRounds.map((r) => r.puzzleId)
          : undefined,
      // Only words that actually got drawn — a round abandoned before the pick
      // shouldn't burn a word out of everyone's future.
      drawWordIds:
        room.gameType === "draw_it"
          ? room.drawRounds.map((r) => r.wordId).filter(Boolean)
          : undefined,
    };
  }

  private touch(room: Room) {
    // Hook for future persistence; for now it just keeps the idle clock honest.
    room.lastActivityAt = Date.now();
  }

  /**
   * The client-facing view of a single player, for the `room:playerJoined`
   * delta. Same shape `viewFor` puts in `players[]`, without building the other
   * 99 entries to send one.
   */
  publicPlayer(code: string, playerId: string): PublicPlayer | null {
    const room = this.getRoom(code);
    const player = room?.players.get(playerId);
    if (!room || !player) {
      return null;
    }
    return {
      id: player.id,
      name: player.name,
      color: player.color,
      score: player.score,
      isHost: player.isHost,
      connected: player.connected,
      photoCount: room.photos.filter((p) => p.ownerId === player.id).length,
      spectator: this.isSpectator(room, player.id),
    };
  }

  /**
   * How many guesses are in for the current round — the only thing a guess
   * changes for everyone other than the guesser. Returns null outside a round,
   * and for Word Chain, which broadcasts per-player standings instead (a
   * single counter can't describe a race).
   */
  answeredCount(code: string): number | null {
    const room = this.getRoom(code);
    if (!room || room.phase !== "playing" || room.gameType === "word_chain") {
      return null;
    }
    const round =
      room.gameType === "geo_guessr"
        ? room.geoRounds[room.currentRound]
        : room.rounds[room.currentRound];
    return round ? round.guesses.size : null;
  }

  /**
   * One player's position in the Word Chain race — the whole of what a correct
   * answer tells everyone else. Returns null when there's nothing to report.
   */
  wordStanding(code: string, playerId: string): WordChainStanding | null {
    const room = this.getRoom(code);
    if (!room || room.gameType !== "word_chain") {
      return null;
    }
    const progress = room.wordRounds[room.currentRound]?.progress.get(playerId);
    if (!progress) {
      return null;
    }
    return {
      playerId,
      solved: this.solvedCount(progress),
      finished: progress.finishedMs !== undefined,
    };
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

    if (room.gameType === "draw_it") {
      const round = room.drawRounds[room.currentRound];

      if (round && (room.phase === "picking" || room.phase === "playing")) {
        const iAmDrawer = viewerId === round.drawerId;
        const guessers = this.drawGuesserIds(room, round);
        state.drawRound = {
          index: room.currentRound,
          total: room.drawRounds.length,
          drawerId: round.drawerId,
          iAmDrawer,
          // The two fields that carry the whole game's secret. `word` goes to
          // exactly one person; everyone else gets the shape of it.
          word: iAmDrawer ? round.word || undefined : undefined,
          wordMask: round.word ? maskWord(round.word) : "",
          wordChoices:
            iAmDrawer && room.phase === "picking"
              ? round.choices.map((c) => c.word)
              : undefined,
          endsAt:
            room.phase === "picking"
              ? round.pickEndsAt
              : round.startedAt + round.durationMs,
          strokes: round.strokes,
          chat: round.chat,
          iGuessed: round.guesses.get(viewerId)?.correct ?? false,
          solvedCount: guessers.filter(
            (id) => round.guesses.get(id)?.correct
          ).length,
          guessCount: guessers.length,
          myPoints: round.guesses.get(viewerId)?.points ?? 0,
          spectating: this.isSpectator(room, viewerId),
          isHost: viewerId === room.hostId,
        };
      }

      if (round && room.phase === "reveal") {
        state.drawReveal = {
          index: room.currentRound,
          total: room.drawRounds.length,
          drawerId: round.drawerId,
          word: round.word,
          strokes: round.strokes,
          results: this.drawGuesserIds(room, round)
            .map((id) => {
              const g = round.guesses.get(id);
              return {
                playerId: id,
                correct: g?.correct ?? false,
                timeMs: g?.correct ? g.timeMs : null,
                points: g?.correct ? g.points : 0,
              };
            })
            .sort((a, b) => b.points - a.points),
          drawerPoints: this.drawerPoints(room, round),
        };
      }

      if (room.phase === "final") {
        state.final = { ranking: this.finalRanking(room) };
      }

      return state;
    }

    if (room.gameType === "word_chain") {
      const competitorIds = [...room.players.keys()].filter(
        (id) => !this.isSpectator(room, id)
      );

      if (room.phase === "playing" || room.phase === "reveal") {
        const round = room.wordRounds[room.currentRound];
        const blanks = round.words.slice(1, -1);
        const mine = round.progress.get(viewerId);

        if (room.phase === "playing") {
          state.wordRound = {
            puzzleId: round.puzzleId,
            difficulty: round.difficulty,
            startWord: round.words[0],
            endWord: round.words[round.words.length - 1],
            // The answer for an unsolved blank stays here on the server. What
            // goes out is its length plus the prefix this viewer has earned —
            // which is why the view is built per viewer rather than broadcast.
            blanks: blanks.map((word, i) => ({
              length: word.length,
              revealed: word.slice(
                0,
                freeLetters(word) + (mine?.hints[i] ?? 0)
              ),
              solvedWord: this.isBlankSolved(round, mine, i) ? word : undefined,
            })),
            activeIndexes: this.activeBlanks(round, mine),
            endsAt: round.startedAt + round.durationMs,
            finished: mine?.finishedMs !== undefined,
            myPoints: mine ? this.wordChainPoints(round, mine) : 0,
            hintsUsed: mine?.hintsUsed ?? 0,
            hintCost: this.wordChainHintCost(round),
            standings: competitorIds.map((id) => {
              const p = round.progress.get(id);
              return {
                playerId: id,
                solved: this.solvedCount(p),
                finished: p?.finishedMs !== undefined,
              };
            }),
            spectating: this.isSpectator(room, viewerId),
            isHost: viewerId === room.hostId,
          };
        } else {
          state.wordReveal = {
            puzzleId: round.puzzleId,
            difficulty: round.difficulty,
            words: round.words,
            results: competitorIds
              .map((id) => {
                const p = round.progress.get(id);
                return {
                  playerId: id,
                  solved: this.solvedCount(p),
                  total: blanks.length,
                  finished: p?.finishedMs !== undefined,
                  timeMs: p?.finishedMs ?? null,
                  hintsUsed: p?.hintsUsed ?? 0,
                  points: p ? this.wordChainPoints(round, p) : 0,
                };
              })
              .sort((a, b) => b.points - a.points),
          };
        }
      }

      if (room.phase === "final") {
        state.final = { ranking: this.finalRanking(room) };
      }

      return state;
    }

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
        state.final = { ranking: this.finalRanking(room) };
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
      state.final = { ranking: this.finalRanking(room) };
    }

    return state;
  }

  /** Competitors, best score first. Spectators never appear. */
  private finalRanking(room: Room): { playerId: string; score: number }[] {
    return [...room.players.values()]
      .filter((p) => !this.isSpectator(room, p.id))
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ playerId: p.id, score: p.score }));
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
