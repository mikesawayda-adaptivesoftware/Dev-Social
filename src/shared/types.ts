// Shared types and constants used by both the realtime server and the Next.js client.
// Keep this file free of server- or browser-only imports so it can be consumed by both.

export type GamePhase =
  | "lobby"
  | "submission"
  | "playing"
  | "reveal"
  | "final";

export type GameType = "photo_guessr" | "geo_guessr" | "word_chain";

// Whether a room is discoverable in the public games browser. Private rooms are
// reachable only by their code / join link, which is the historical behaviour.
export type RoomVisibility = "public" | "private";

// Human-friendly names for each game type, used in the UI (leaderboard tabs,
// game badges, etc.).
export const GAME_TYPE_LABELS: Record<GameType, string> = {
  photo_guessr: "Photo Guessr",
  geo_guessr: "Real GeoGuessr",
  word_chain: "Word Chain",
};

export const GAME_TYPE_EMOJI: Record<GameType, string> = {
  photo_guessr: "📸",
  geo_guessr: "🗺️",
  word_chain: "🔗",
};

export const GAME_TYPE_BLURB: Record<GameType, string> = {
  photo_guessr: "Match everyone's photos to the right teammate.",
  geo_guessr: "Explore Street View and pin the location on a map.",
  word_chain: "Race to fill the missing links between two words.",
};

/** Whether a string is a game type we know about (enabled or not). */
export function isKnownGameType(value: string): value is GameType {
  return Object.hasOwn(GAME_TYPE_LABELS, value);
}

/**
 * Games that can currently be played. This is the single switch for taking a
 * game out of rotation: it drives the lobby picker, the default game for new
 * rooms, and server-side rejection — so a disabled game can't be started by a
 * stale client or a hand-crafted socket payload either.
 *
 * The labels/emoji/blurbs above deliberately stay complete for every GameType,
 * so finished games of a disabled type still render on the leaderboard.
 *
 * To re-enable Photo Guessr, put "photo_guessr" back in this list.
 */
export const ENABLED_GAME_TYPES = [
  "geo_guessr",
  "word_chain",
] as const satisfies readonly GameType[];

/** What a fresh lobby opens on. Must be an enabled game. */
export const DEFAULT_GAME_TYPE: GameType = ENABLED_GAME_TYPES[0];

export function isGameEnabled(gameType: GameType): boolean {
  return (ENABLED_GAME_TYPES as readonly GameType[]).includes(gameType);
}

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  score: number;
  isHost: boolean;
  connected: boolean;
  photoCount: number;
  // A spectator is in the room but not competing (e.g. a host who chose not to
  // play). They're hidden from scoreboards, rankings, and persistence.
  spectator: boolean;
}

export interface RoundView {
  index: number; // 0-based index of current round
  total: number;
  photoDataUrl: string;
  optionIds: string[]; // candidate player ids to choose from
  endsAt: number; // epoch ms when the round auto-closes
  answeredCount: number;
  myGuess?: string; // the player id this client guessed, if any
  iAmOwner: boolean; // true if this client owns the current photo (they just watch)
}

export interface RoundResult {
  playerId: string;
  choiceId: string | null;
  correct: boolean;
  points: number;
}

export interface RevealView {
  index: number;
  total: number;
  photoDataUrl: string;
  ownerId: string;
  results: RoundResult[];
}

export interface SubmissionView {
  myPhotoCount: number;
  totalPhotos: number;
  submittedPlayerIds: string[];
  minPhotosPerPlayer: number;
}

// ---- Real GeoGuessr ----

/** What a player sees while a geo round is in progress. Never includes the
 * answer coordinates — only the panorama id needed to render Street View. */
export interface GeoRoundView {
  index: number; // 0-based index of current round
  total: number;
  panoId: string; // Street View panorama id to render (answer coords withheld)
  endsAt: number; // epoch ms when the round auto-closes
  answeredCount: number;
  guessCount: number; // number of players expected to guess
  iGuessed: boolean; // whether this client has locked in a guess
  myGuess?: LatLng; // this client's locked-in pin, if any
  isHost: boolean; // whether this client is the host
  spectating: boolean; // true if this client watches instead of guessing
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoResult {
  playerId: string;
  guess: LatLng | null; // null if the player never guessed
  distanceKm: number | null;
  points: number;
}

/** What everyone sees at reveal: the true location plus every player's pin. */
export interface GeoRevealView {
  index: number;
  total: number;
  panoId: string;
  answer: LatLng & { label: string };
  results: GeoResult[];
}

// ---- Word Chain ----
//
// One seeded puzzle per game: a chain of words where each neighbouring pair
// makes a compound word or a set phrase (SUN → FLOWER → BED → ROOM → …). The
// two ends are given; everyone races to fill the blanks between them, top down.
//
// Answers never leave the server until the solver earns them: a blank exposes
// only its length and the letters that particular viewer has unlocked, and the
// whole chain appears only at the reveal.

/** One blank in the chain, as a single viewer currently sees it. */
export interface WordChainBlank {
  /** Letters in the answer, so the client can draw the right number of slots. */
  length: number;
  /**
   * The prefix this viewer can see: the free first letter, plus one more per
   * hint they've spent. Personal — hints don't leak to the rest of the room.
   */
  revealed: string;
  /** The answer. Present only on blanks this viewer has already solved. */
  solvedWord?: string;
}

/**
 * One player's position in the race. Deliberately tiny: it's broadcast to the
 * whole room on every correct answer.
 */
export interface WordChainStanding {
  playerId: string;
  solved: number;
  finished: boolean;
}

export interface WordChainRoundView {
  puzzleId: string;
  startWord: string;
  endWord: string;
  blanks: WordChainBlank[];
  /** The blank this viewer answers next; equals `blanks.length` once done. */
  activeIndex: number;
  endsAt: number; // epoch ms when the puzzle auto-closes
  /** This viewer finished the chain and is now waiting on everyone else. */
  finished: boolean;
  /** Points banked so far, bonuses included once finished. */
  myPoints: number;
  hintsUsed: number;
  /** Everyone's progress, including this viewer's, for the live race board. */
  standings: WordChainStanding[];
  spectating: boolean; // true if this client watches instead of solving
  isHost: boolean;
}

export interface WordChainResult {
  playerId: string;
  solved: number;
  total: number;
  finished: boolean;
  /** ms from start to completing the chain; null if they never finished. */
  timeMs: number | null;
  hintsUsed: number;
  points: number;
}

export interface WordChainRevealView {
  puzzleId: string;
  /** The full chain, answers included. Only ever sent once the round is over. */
  words: string[];
  results: WordChainResult[];
}

/** Ack payload for a submitted answer. `word` is set only on a correct guess. */
export interface WordChainGuessResult {
  correct: boolean;
  solved: number;
  finished: boolean;
  word?: string;
}

/**
 * A room as it appears in the public games browser. Deliberately minimal — this
 * goes to anyone on the site, including people not in the room.
 */
export interface PublicRoomSummary {
  code: string;
  hostName: string;
  // What the host currently has selected in the lobby. Live: it follows their
  // picks (see `host:setGameType`) rather than only becoming true at start.
  gameType: GameType;
  playerCount: number;
  maxPlayers: number;
  createdAt: number; // epoch ms, for an "opened 3m ago" hint
}

export interface RoomState {
  code: string;
  phase: GamePhase;
  gameType: GameType;
  hostId: string;
  visibility: RoomVisibility;
  players: PublicPlayer[];
  settings: GameSettings;
  submission?: SubmissionView;
  round?: RoundView;
  reveal?: RevealView;
  geoRound?: GeoRoundView;
  geoReveal?: GeoRevealView;
  wordRound?: WordChainRoundView;
  wordReveal?: WordChainRevealView;
  final?: { ranking: { playerId: string; score: number }[] };
}

export interface GameSettings {
  roundDurationSec: number;
  maxOptions: number;
  // Number of locations shown per Real GeoGuessr game.
  geoRoundCount: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  roundDurationSec: 25,
  maxOptions: 6,
  geoRoundCount: 5,
};

// Per-round explore/guess timer for GeoGuessr the host may pick in the lobby.
export const GEO_DURATION_OPTIONS_SEC = [60, 90, 120] as const;
export const GEO_DEFAULT_DURATION_SEC = 90;

// How long the whole Word Chain race runs — 1, 2 or 5 minutes, host's pick.
export const WORD_CHAIN_DURATION_OPTIONS_SEC = [60, 120, 300] as const;
export const WORD_CHAIN_DEFAULT_DURATION_SEC = 120;

/**
 * Hard cap on players in one room. A real decision now — it used to be an
 * accident of how many colors were in the avatar palette.
 */
export const MAX_PLAYERS_PER_ROOM = 100;

// A player's PIN "claims" their name for the season leaderboard. 4-6 digits.
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const PIN_PATTERN = /^\d{4,6}$/;

// Client -> Server events
export interface ClientToServerEvents {
  "room:create": (
    payload: { name: string; pin: string; visibility: RoomVisibility },
    ack: (res: AckResult<{ code: string; playerId: string }>) => void
  ) => void;
  // Subscribe to live updates of the public games list. Acks with the current
  // list so a browser doesn't have to wait for the next change to render.
  "rooms:subscribe": (
    ack: (res: AckResult<{ rooms: PublicRoomSummary[] }>) => void
  ) => void;
  "rooms:unsubscribe": () => void;
  "room:join": (
    payload: { code: string; name: string; pin: string },
    ack: (res: AckResult<{ code: string; playerId: string }>) => void
  ) => void;
  "name:check": (
    payload: { name: string },
    ack: (res: AckResult<{ claimed: boolean }>) => void
  ) => void;
  "room:rejoin": (
    payload: { code: string; playerId: string },
    ack: (res: AckResult<{ ok: true }>) => void
  ) => void;
  // Host-only, lobby-only. The host's game choice is server state, not local UI
  // state, so the lobby and the public games list both reflect it live.
  "host:setGameType": (
    payload: { gameType: GameType },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  "host:startSubmission": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
  "photo:submit": (
    payload: { dataUrl: string },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  "photo:clearMine": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
  "host:startGame": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
  "guess:submit": (
    payload: { choiceId: string },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  "host:startGeoGame": (
    payload: { roundDurationSec: number; hostPlaying: boolean },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  "geo:guess": (
    payload: { lat: number; lng: number },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  "host:startWordChain": (
    payload: { durationSec: number; hostPlaying: boolean },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  // Answer one blank in the chain. `index` guards against a stale client
  // answering a blank it has already moved past.
  "word:guess": (
    payload: { index: number; guess: string },
    ack?: (res: AckResult<WordChainGuessResult>) => void
  ) => void;
  // Buy one more letter of the current blank, for a points penalty. Private to
  // the buyer — nobody else's view changes.
  "word:hint": (
    ack?: (res: AckResult<{ revealed: string; hintsUsed: number }>) => void
  ) => void;
  "host:nextRound": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
  "host:playAgain": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
}

// Server -> Client events
//
// `room:state` is the full snapshot. The deltas below exist because the roster
// is ~99% of a snapshot's bytes and grows with player count, while what actually
// changed is usually a single field. Re-sending everything on every guess costs
// roster x players bytes per broadcast, which is fine at 10 players and ~680 MB
// per game at 100. So the two high-frequency paths — someone joining, someone
// guessing — send only their diff.
//
// Correctness without a sequence/ack protocol: socket.io delivers in order on a
// connection, and any disconnect ends in a `room:rejoin` that re-sends a full
// snapshot. So a client can't silently miss a delta and drift. Every phase
// change also re-snapshots, which bounds staleness to the current round.
export interface ServerToClientEvents {
  // Full snapshot. Sent on join/rejoin, on any phase change, and to whoever just
  // acted (cheap for one player, and it keeps personal fields exact).
  "room:state": (state: RoomState) => void;
  "room:closed": (reason: string) => void;
  // A player joined the lobby. Appended to the roster client-side.
  "room:playerJoined": (payload: { player: PublicPlayer }) => void;
  // A player dropped or came back.
  "room:playerConnection": (payload: {
    playerId: string;
    connected: boolean;
  }) => void;
  // Someone guessed. This is the entire news: a counter. Goes to everyone except
  // the guesser, who gets a snapshot instead.
  "round:progress": (payload: { answeredCount: number }) => void;
  // Someone moved up the chain. Same bargain as `round:progress`: the whole
  // room needs the race board, but only one player's position changed, so this
  // is a single standing rather than a fresh snapshot each.
  "chain:standing": (payload: WordChainStanding) => void;
  // Pushed to subscribers of the public games browser whenever the list changes.
  "rooms:list": (rooms: PublicRoomSummary[]) => void;
}

export type AckResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
