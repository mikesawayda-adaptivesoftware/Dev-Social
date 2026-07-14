// Shared types and constants used by both the realtime server and the Next.js client.
// Keep this file free of server- or browser-only imports so it can be consumed by both.

export type GamePhase =
  | "lobby"
  | "submission"
  | "playing"
  | "reveal"
  | "final";

export type GameType = "photo_guessr" | "geo_guessr";

// Human-friendly names for each game type, used in the UI (leaderboard tabs,
// game badges, etc.).
export const GAME_TYPE_LABELS: Record<GameType, string> = {
  photo_guessr: "Photo Guessr",
  geo_guessr: "Real GeoGuessr",
};

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

export interface RoomState {
  code: string;
  phase: GamePhase;
  gameType: GameType;
  hostId: string;
  players: PublicPlayer[];
  settings: GameSettings;
  submission?: SubmissionView;
  round?: RoundView;
  reveal?: RevealView;
  geoRound?: GeoRoundView;
  geoReveal?: GeoRevealView;
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

// A player's PIN "claims" their name for the season leaderboard. 4-6 digits.
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const PIN_PATTERN = /^\d{4,6}$/;

// Client -> Server events
export interface ClientToServerEvents {
  "room:create": (
    payload: { name: string; pin: string },
    ack: (res: AckResult<{ code: string; playerId: string }>) => void
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
  "host:nextRound": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
  "host:playAgain": (ack?: (res: AckResult<{ ok: true }>) => void) => void;
}

// Server -> Client events
export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "room:closed": (reason: string) => void;
}

export type AckResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
