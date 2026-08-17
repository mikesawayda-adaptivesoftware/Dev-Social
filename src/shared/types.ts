// Shared types and constants used by both the realtime server and the Next.js client.
// Keep this file free of server- or browser-only imports so it can be consumed by both.

export type GamePhase =
  | "lobby"
  | "submission"
  // Draw It only: the drawer is choosing which of three words to draw, and
  // everyone else is waiting on them. Its own phase rather than a flag on
  // `playing`, because nothing is drawable or guessable yet and the round clock
  // hasn't started.
  | "picking"
  | "playing"
  | "reveal"
  | "final";

export type GameType =
  | "photo_guessr"
  | "geo_guessr"
  | "word_chain"
  | "draw_it";

// Whether a room is discoverable in the public games browser. Private rooms are
// reachable only by their code / join link, which is the historical behaviour.
export type RoomVisibility = "public" | "private";

// Human-friendly names for each game type, used in the UI (leaderboard tabs,
// game badges, etc.).
export const GAME_TYPE_LABELS: Record<GameType, string> = {
  photo_guessr: "Photo Guessr",
  geo_guessr: "Real GeoGuessr",
  word_chain: "Word Chain",
  draw_it: "Draw It",
};

export const GAME_TYPE_EMOJI: Record<GameType, string> = {
  photo_guessr: "📸",
  geo_guessr: "🗺️",
  word_chain: "🔗",
  draw_it: "✏️",
};

export const GAME_TYPE_BLURB: Record<GameType, string> = {
  photo_guessr: "Match everyone's photos to the right teammate.",
  geo_guessr: "Explore Street View and pin the location on a map.",
  word_chain: "Race to fill the missing links between two words.",
  draw_it: "One person draws, everyone else races to guess it.",
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
  "draw_it",
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
  /**
   * They tapped Leave, rather than dropping out.
   *
   * Still in the roster because reveal screens name whoever played each round,
   * and a leaver may have played several. Hidden from the lobby list and the
   * scoreboards — see the filters at those call sites.
   */
  left: boolean;
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

/**
 * How hard a chain's blanks are to pin down. Measured as how much narrowing the
 * free first letter has to do: on an easy chain the length alone identifies the
 * answer, on a hard one several words fit the shape.
 */
export type WordChainDifficulty = "easy" | "normal" | "hard";

/** The host's lobby choice — a tier, or let the server pick from all of them. */
export type WordChainDifficultyChoice = WordChainDifficulty | "any";

export const WORD_CHAIN_DIFFICULTY_CHOICES = [
  "any",
  "easy",
  "normal",
  "hard",
] as const satisfies readonly WordChainDifficultyChoice[];

export const WORD_CHAIN_DIFFICULTY_LABELS: Record<
  WordChainDifficultyChoice,
  string
> = {
  any: "Any",
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

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
  difficulty: WordChainDifficulty;
  startWord: string;
  endWord: string;
  blanks: WordChainBlank[];
  /**
   * The blanks this viewer may answer right now. The chain is solved from both
   * ends inwards, so there are normally two — the frontier from the top and the
   * one from the bottom — collapsing to one when they meet, and none once done.
   */
  activeIndexes: number[];
  endsAt: number; // epoch ms when the puzzle auto-closes
  /** This viewer finished the chain and is now waiting on everyone else. */
  finished: boolean;
  /** Points banked so far, bonuses included once finished. */
  myPoints: number;
  hintsUsed: number;
  /** What the next hint costs. Depends on the chain's length, so the server
   * works it out rather than the UI re-deriving the scoring rules. */
  hintCost: number;
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
  difficulty: WordChainDifficulty;
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

// ---- Draw It ----
//
// One player draws a secret word; everyone else types guesses against the clock.
// The drawer's strokes stream to every screen as they happen.
//
// The whole game hangs on one asymmetry: the drawer knows the word and nobody
// else may, not even after someone solves it — a correct guess is announced as
// "Ada got it", never as the word, or the first solver would end the round for
// the room. That's why the round view is built per viewer, like every other
// game's answer here.

export type DrawDifficulty = "easy" | "normal" | "hard";
export type DrawDifficultyChoice = DrawDifficulty | "any";

export const DRAW_DIFFICULTY_CHOICES = [
  "any",
  "easy",
  "normal",
  "hard",
] as const satisfies readonly DrawDifficultyChoice[];

/** Ink the drawer can pick. The app's avatar palette, reused as a paint box. */
export const DRAW_COLORS = [
  "#f5f3ff", // chalk — the default, near-white on the dark canvas
  "#f87171",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#22d3ee",
  "#60a5fa",
  "#f472b6",
] as const;

/** Brush widths, in canvas units (see DRAW_CANVAS_UNITS). */
export const DRAW_WIDTHS = [6, 18] as const;

/**
 * Strokes are stored in a square coordinate space of this many units rather
 * than in pixels, so a drawing made on a phone renders correctly on a TV. Every
 * client scales the same numbers to whatever canvas it has.
 */
export const DRAW_CANVAS_UNITS = 1000;

/** How long the drawer gets to choose from their three words. */
export const DRAW_PICK_SECONDS = 15;

// Per-round drawing time the host may pick in the lobby.
export const DRAW_DURATION_OPTIONS_SEC = [60, 90, 120] as const;
export const DRAW_DEFAULT_DURATION_SEC = 90;

/** Most drawers in one game, however many people are in the room. */
export const DRAW_MAX_ROUNDS = 8;

export interface DrawStroke {
  /**
   * Which pen-down this segment belongs to.
   *
   * A long stroke is sent in pieces while it's still being drawn — otherwise
   * guessers see nothing until the pen lifts, which on a slow outline is
   * several seconds of blank canvas in a timed race. Consecutive segments share
   * an id so that undo removes the whole stroke rather than the last fragment
   * of it.
   */
  id: string;
  /** Index into DRAW_COLORS. */
  color: number;
  /** Index into DRAW_WIDTHS. */
  width: number;
  /** Flat [x0, y0, x1, y1, …] in DRAW_CANVAS_UNITS space. */
  points: number[];
}

export interface DrawChatLine {
  id: string;
  playerId: string;
  /** A wrong guess, verbatim. Empty when `solved` — the word is never sent. */
  text: string;
  solved: boolean;
}

export interface DrawRoundView {
  index: number; // 0-based round
  total: number;
  drawerId: string;
  iAmDrawer: boolean;
  /** The word itself — only ever present for the drawer. */
  word?: string;
  /** What everyone else sees: letters as underscores, spaces preserved. */
  wordMask: string;
  /** The three options, during `picking`, and only for the drawer. */
  wordChoices?: string[];
  /** When the current phase ends — the pick deadline, then the round clock. */
  endsAt: number;
  strokes: DrawStroke[];
  chat: DrawChatLine[];
  iGuessed: boolean;
  /** How many of the guessers have it, and how many there are. */
  solvedCount: number;
  guessCount: number;
  myPoints: number;
  spectating: boolean;
  isHost: boolean;
}

export interface DrawResult {
  playerId: string;
  correct: boolean;
  /** ms from round start to a correct guess; null if they never got it. */
  timeMs: number | null;
  points: number;
}

export interface DrawRevealView {
  index: number;
  total: number;
  drawerId: string;
  /** Safe to send now — the round is over. */
  word: string;
  strokes: DrawStroke[];
  results: DrawResult[];
  drawerPoints: number;
}

/** Ack for a submitted guess. Never carries the word, right or wrong. */
export interface DrawGuessResult {
  correct: boolean;
  points: number;
}

/**
 * A seat the browser remembers, confirmed by the server to still exist.
 *
 * Answers the only question the landing page needs: "is the game I was in still
 * running, and what is it doing?" The playerId isn't echoed back — the client
 * already has it, and it's the credential.
 */
export interface SeatStatus {
  code: string;
  name: string; // the seat's own name, so "Rejoin as Ada" is exact
  hostName: string;
  gameType: GameType;
  phase: GamePhase;
  playerCount: number;
  isHost: boolean;
}

/** How many seats one client may ask about at a time. */
export const MAX_SEATS_CHECKED = 10;

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
  drawRound?: DrawRoundView;
  drawReveal?: DrawRevealView;
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
 * Chain lengths the host can pick, in words. Two of every chain are given, so
 * these are 3, 4, 6, 10 and 15 blanks to fill.
 *
 * Every length is worth the same 5,000 — the solve points are a fixed pot split
 * across the blanks — so this changes how the puzzle feels, not what it pays.
 * Must stay in step with CHAIN_LENGTHS in scripts/generateWordChains.mjs, which
 * is what decides the lengths the bank actually contains.
 */
export const WORD_CHAIN_LENGTH_OPTIONS = [5, 6, 8, 12, 17] as const;
export const WORD_CHAIN_DEFAULT_LENGTH = 6;

export const WORD_CHAIN_LENGTH_LABELS: Record<number, string> = {
  5: "Short",
  6: "Standard",
  8: "Long",
  12: "Epic",
  17: "Marathon",
};

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
  // "Which of the seats I remember are still alive?" Answers with the live
  // subset only — a seat the server has never heard of is simply absent, so the
  // client can forget it. No new auth surface: playerId is already the rejoin
  // credential, and nothing here is returned that a rejoin wouldn't give you.
  "seats:check": (
    payload: { seats: { code: string; playerId: string }[] },
    ack: (res: AckResult<{ seats: SeatStatus[] }>) => void
  ) => void;
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
  /**
   * Give up the seat, so the room stops counting you.
   *
   * Recoverable on purpose: the seat is marked left rather than erased, and
   * `room:rejoin` un-marks it. Leave is one tap next to the room code on a
   * phone, and losing a game to a mis-tap is worse than a stale roster entry.
   */
  "room:leave": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
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
    payload: {
      durationSec: number;
      hostPlaying: boolean;
      difficulty: WordChainDifficultyChoice;
      /** Chain length in words. See WORD_CHAIN_LENGTH_OPTIONS. */
      length: number;
    },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  // Answer one blank in the chain. `index` says which — two are open at once —
  // and guards against a stale client answering one it has already moved past.
  "word:guess": (
    payload: { index: number; guess: string },
    ack?: (res: AckResult<WordChainGuessResult>) => void
  ) => void;
  // Buy one more letter of an open blank, for a points penalty. Private to the
  // buyer — nobody else's view changes.
  "word:hint": (
    payload: { index: number },
    ack?: (
      res: AckResult<{ index: number; revealed: string; hintsUsed: number }>
    ) => void
  ) => void;
  "host:startDrawIt": (
    payload: {
      roundDurationSec: number;
      hostPlaying: boolean;
      difficulty: DrawDifficultyChoice;
    },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  // Drawer-only, during `picking`.
  "draw:pickWord": (
    payload: { word: string },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  // Drawer-only. A batch of finished strokes, appended to the canvas. Batched
  // rather than per-point so a fast scribble is a few messages, not hundreds.
  "draw:ink": (
    payload: { strokes: DrawStroke[] },
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => void;
  // Drawer-only. Both resend the authoritative canvas rather than asking every
  // client to replay the same edit — they're rare, and the whole canvas is
  // smaller than a thumbnail.
  "draw:undo": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
  "draw:clear": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
  // A guess. Wrong ones go to the room as chat; a right one is announced
  // without the word.
  "draw:guess": (
    payload: { text: string },
    ack?: (res: AckResult<DrawGuessResult>) => void
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
  // New strokes, appended to whatever the client already has. The hot path of
  // Draw It, and the reason strokes are batched: this fires several times a
  // second while someone is drawing.
  "draw:ink": (payload: { strokes: DrawStroke[] }) => void;
  // The authoritative canvas, after an undo or a clear. Rare enough to send
  // whole rather than teaching every client to replay the edit.
  "draw:canvas": (payload: { strokes: DrawStroke[] }) => void;
  // One line of guess chat, plus the solved counter so the header can move
  // without waiting for a snapshot.
  "draw:chat": (payload: { line: DrawChatLine; solvedCount: number }) => void;
  // Pushed to subscribers of the public games browser whenever the list changes.
  "rooms:list": (rooms: PublicRoomSummary[]) => void;
}

export type AckResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
