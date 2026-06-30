// Shared types and constants used by both the realtime server and the Next.js client.
// Keep this file free of server- or browser-only imports so it can be consumed by both.

export type GamePhase =
  | "lobby"
  | "submission"
  | "playing"
  | "reveal"
  | "final";

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  score: number;
  isHost: boolean;
  connected: boolean;
  photoCount: number;
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

export interface RoomState {
  code: string;
  phase: GamePhase;
  hostId: string;
  players: PublicPlayer[];
  settings: GameSettings;
  submission?: SubmissionView;
  round?: RoundView;
  reveal?: RevealView;
  final?: { ranking: { playerId: string; score: number }[] };
}

export interface GameSettings {
  roundDurationSec: number;
  maxOptions: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  roundDurationSec: 25,
  maxOptions: 6,
};

// Client -> Server events
export interface ClientToServerEvents {
  "room:create": (
    payload: { name: string },
    ack: (res: AckResult<{ code: string; playerId: string }>) => void
  ) => void;
  "room:join": (
    payload: { code: string; name: string },
    ack: (res: AckResult<{ code: string; playerId: string }>) => void
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
