"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearIdentity,
  clearRecentSeat,
  getSocket,
  loadIdentity,
  loadRecentSeat,
  saveIdentity,
  type Identity,
} from "@/lib/socket";
import type {
  AckResult,
  ClientToServerEvents,
  DrawChatLine,
  DrawDifficultyChoice,
  DrawGuessResult,
  DrawStroke,
  GameType,
  PublicPlayer,
  RoomState,
  RoomVisibility,
  WordChainDifficultyChoice,
  WordChainGuessResult,
  WordChainStanding,
} from "@/shared/types";

type NoArgEvent =
  | "host:startSubmission"
  | "photo:clearMine"
  | "host:startGame"
  | "host:nextRound"
  | "host:playAgain";

/** How long an action waits for the server before giving up. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * The server never answered.
 *
 * Worth its own type for one reason: silence is not a refusal. A refused rejoin
 * means the seat is gone and the recovery record should go with it; a timeout
 * means we don't know, and throwing the record away would strand someone whose
 * game is still running.
 */
class RequestTimeout extends Error {
  constructor() {
    super("The game server didn't answer. Try again.");
    this.name = "RequestTimeout";
  }
}

interface GameContextValue {
  connected: boolean;
  /**
   * Connected *and* holding a seat the server knows about.
   *
   * `connected` alone isn't enough for anything inside a room. Socket.IO buffers
   * emits made while offline and flushes them the instant the socket is back —
   * ahead of our `room:rejoin` — so they arrive before the server has any idea
   * who we are and come back "You are not in a room."
   */
  ready: boolean;
  state: RoomState | null;
  identity: Identity | null;
  me: RoomState["players"][number] | null;
  isHost: boolean;
  createRoom: (
    name: string,
    pin: string,
    visibility: RoomVisibility
  ) => Promise<string>;
  joinRoom: (code: string, name: string, pin: string) => Promise<string>;
  checkName: (name: string) => Promise<boolean>;
  rejoin: (code: string) => Promise<void>;
  rejoinRecent: (code: string) => Promise<void>;
  // True when the server rejected our reconnect (the seat/room is gone, e.g. the
  // game ended or the server restarted). The room page turns this into a clear
  // "this game is no longer available" state instead of an endless spinner.
  seatLost: boolean;
  /** Why, if the server said so. Null means we're guessing. */
  lostReason: string | null;
  leave: () => void;
  setGameType: (gameType: GameType) => Promise<void>;
  startSubmission: () => Promise<void>;
  submitPhoto: (dataUrl: string) => Promise<void>;
  clearMyPhotos: () => Promise<void>;
  startGame: () => Promise<void>;
  submitGuess: (choiceId: string) => Promise<void>;
  startGeoGame: (roundDurationSec: number, hostPlaying: boolean) => Promise<void>;
  submitGeoGuess: (lat: number, lng: number) => Promise<void>;
  startWordChain: (
    durationSec: number,
    hostPlaying: boolean,
    difficulty: WordChainDifficultyChoice,
    length: number
  ) => Promise<void>;
  submitWordGuess: (
    index: number,
    guess: string
  ) => Promise<WordChainGuessResult>;
  revealWordHint: (
    index: number
  ) => Promise<{ index: number; revealed: string; hintsUsed: number }>;
  startDrawIt: (
    roundDurationSec: number,
    hostPlaying: boolean,
    difficulty: DrawDifficultyChoice
  ) => Promise<void>;
  pickDrawWord: (word: string) => Promise<void>;
  sendDrawStroke: (stroke: DrawStroke) => void;
  undoDrawStroke: () => Promise<void>;
  clearDrawCanvas: () => Promise<void>;
  submitDrawGuess: (text: string) => Promise<DrawGuessResult>;
  nextRound: () => Promise<void>;
  playAgain: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

// --- Delta appliers -------------------------------------------------------
//
// The server sends a full RoomState snapshot on join/rejoin and on every phase
// change, but only diffs for the two things that happen at player-count scale:
// someone joining, and someone guessing. These fold a diff into the state we
// already hold, so every component downstream keeps reading a plain RoomState
// and none of them had to learn about the wire format.
//
// All three are no-ops when we have no state yet — a delta can arrive before the
// first snapshot has been applied, and dropping it is correct: the snapshot on
// its way already includes whatever it was telling us.

function applyPlayerJoined(state: RoomState | null, player: PublicPlayer): RoomState | null {
  if (!state) {
    return state;
  }
  // Idempotent: a snapshot racing this delta must not double-add the player.
  if (state.players.some((p) => p.id === player.id)) {
    return state;
  }
  return { ...state, players: [...state.players, player] };
}

function applyPlayerConnection(
  state: RoomState | null,
  playerId: string,
  connected: boolean
): RoomState | null {
  if (!state) {
    return state;
  }
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, connected } : p
    ),
  };
}

function applyRoundProgress(
  state: RoomState | null,
  answeredCount: number
): RoomState | null {
  if (!state) {
    return state;
  }
  // Whichever round view is live — the two game types carry the same counter.
  if (state.geoRound) {
    return { ...state, geoRound: { ...state.geoRound, answeredCount } };
  }
  if (state.round) {
    return { ...state, round: { ...state.round, answeredCount } };
  }
  return state;
}

/**
 * New strokes, appended to whatever we already hold. The prefix is left as the
 * same array contents so the canvas keeps agreeing with the room even while a
 * snapshot is in flight.
 */
function applyDrawInk(
  state: RoomState | null,
  strokes: DrawStroke[]
): RoomState | null {
  if (!state?.drawRound) {
    return state;
  }
  return {
    ...state,
    drawRound: {
      ...state.drawRound,
      strokes: [...state.drawRound.strokes, ...strokes],
    },
  };
}

/** The whole canvas, after an undo or a clear. */
function applyDrawCanvas(
  state: RoomState | null,
  strokes: DrawStroke[]
): RoomState | null {
  if (!state?.drawRound) {
    return state;
  }
  return { ...state, drawRound: { ...state.drawRound, strokes } };
}

function applyDrawChat(
  state: RoomState | null,
  line: DrawChatLine,
  solvedCount: number
): RoomState | null {
  if (!state?.drawRound) {
    return state;
  }
  // Idempotent: a snapshot racing this delta must not double-add the line.
  if (state.drawRound.chat.some((l) => l.id === line.id)) {
    return state;
  }
  return {
    ...state,
    drawRound: {
      ...state.drawRound,
      chat: [...state.drawRound.chat, line],
      solvedCount,
    },
  };
}

function applyChainStanding(
  state: RoomState | null,
  standing: WordChainStanding
): RoomState | null {
  if (!state?.wordRound) {
    return state;
  }
  // Only ever moves someone already on the board. A standing for an unknown
  // player would mean our roster is behind, and the snapshot that fixes that
  // carries their position anyway.
  return {
    ...state,
    wordRound: {
      ...state.wordRound,
      standings: state.wordRound.standings.map((s) =>
        s.playerId === standing.playerId ? standing : s
      ),
    },
  };
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [seatLost, setSeatLost] = useState(false);
  // Why the seat went, when the server bothered to say. Otherwise the screen
  // guesses at "it may have ended, or the server restarted".
  const [lostReason, setLostReason] = useState<string | null>(null);
  const identityRef = useRef<Identity | null>(null);
  // Does the server currently have us in a room on *this* socket? Mirrored into
  // a ref because `request` is called from callbacks that shouldn't re-create
  // themselves every time it flips.
  const [seatReady, setSeatReady] = useState(false);
  const seatReadyRef = useRef(false);
  const setSeat = useCallback((value: boolean) => {
    seatReadyRef.current = value;
    setSeatReady(value);
  }, []);

  useEffect(() => {
    // Seed identity from sessionStorage on mount. This must run in an effect
    // (not a lazy useState initializer): sessionStorage is unavailable during
    // SSR, so initializing from it would desync server/client and cause a
    // hydration mismatch in identity-dependent children.
    const stored = loadIdentity();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIdentity(stored);
      identityRef.current = stored;
    }

    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      // Re-establish room membership after a reconnect.
      const id = identityRef.current;
      if (id) {
        setSeatLost(false);
        socket.emit(
          "room:rejoin",
          { code: id.code, playerId: id.playerId },
          (res: AckResult<{ ok: true }>) => {
            if (res.ok) {
              // Only now is it safe to act: anything sent before this point
              // reaches a server that doesn't know who we are.
              setSeat(true);
            } else {
              // The server no longer has our seat (game ended, or the server
              // restarted and lost in-memory state). Drop the dead active seat
              // and surface a clear state rather than a frozen spinner.
              identityRef.current = null;
              setIdentity(null);
              clearIdentity();
              // …and the recovery record with it, or the room page keeps
              // offering to rejoin a seat that has already been refused.
              clearRecentSeat(id.code);
              setState(null);
              setSeatLost(true);
              setLostReason(res.error);
            }
          }
        );
      }
    };
    const onDisconnect = () => {
      setConnected(false);
      setSeat(false);
    };
    /**
     * The server retired this connection — the seat is being played somewhere
     * else now.
     *
     * Dropping the identity is what stops a ping-pong: the socket auto-
     * reconnects, and `onConnect` would otherwise re-`room:rejoin` from the
     * stored identity and yank the seat back off the tab that legitimately
     * holds it.
     */
    const onRoomClosed = (reason: string) => {
      const current = identityRef.current;
      if (current) {
        clearRecentSeat(current.code);
      }
      identityRef.current = null;
      setIdentity(null);
      clearIdentity();
      setSeat(false);
      setState(null);
      setSeatLost(true);
      setLostReason(reason);
    };
    const onState = (next: RoomState) => setState(next);
    const onPlayerJoined = ({ player }: { player: PublicPlayer }) =>
      setState((s) => applyPlayerJoined(s, player));
    const onPlayerConnection = ({
      playerId,
      connected: isConnected,
    }: {
      playerId: string;
      connected: boolean;
    }) => setState((s) => applyPlayerConnection(s, playerId, isConnected));
    const onRoundProgress = ({ answeredCount }: { answeredCount: number }) =>
      setState((s) => applyRoundProgress(s, answeredCount));
    const onChainStanding = (standing: WordChainStanding) =>
      setState((s) => applyChainStanding(s, standing));
    const onDrawInk = ({ strokes }: { strokes: DrawStroke[] }) =>
      setState((s) => applyDrawInk(s, strokes));
    const onDrawCanvas = ({ strokes }: { strokes: DrawStroke[] }) =>
      setState((s) => applyDrawCanvas(s, strokes));
    const onDrawChat = ({
      line,
      solvedCount,
    }: {
      line: DrawChatLine;
      solvedCount: number;
    }) => setState((s) => applyDrawChat(s, line, solvedCount));

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:closed", onRoomClosed);
    socket.on("room:state", onState);
    socket.on("room:playerJoined", onPlayerJoined);
    socket.on("room:playerConnection", onPlayerConnection);
    socket.on("round:progress", onRoundProgress);
    socket.on("chain:standing", onChainStanding);
    socket.on("draw:ink", onDrawInk);
    socket.on("draw:canvas", onDrawCanvas);
    socket.on("draw:chat", onDrawChat);
    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:closed", onRoomClosed);
      socket.off("room:state", onState);
      socket.off("room:playerJoined", onPlayerJoined);
      socket.off("room:playerConnection", onPlayerConnection);
      socket.off("round:progress", onRoundProgress);
      socket.off("chain:standing", onChainStanding);
      socket.off("draw:ink", onDrawInk);
      socket.off("draw:canvas", onDrawCanvas);
      socket.off("draw:chat", onDrawChat);
    };
  }, [setSeat]);

  const persist = useCallback(
    (id: Identity | null) => {
      identityRef.current = id;
      setIdentity(id);
      setSeat(Boolean(id));
      if (id) {
        setSeatLost(false);
        saveIdentity(id);
      } else {
        clearIdentity();
      }
    },
    [setSeat]
  );

  /**
   * Every request to the server, in one place.
   *
   * Two things this fixes over the fifteen hand-rolled promises it replaces.
   * An ack that never comes used to leave the promise pending forever, and
   * since every caller re-enables its button in `.finally()`, a single dropped
   * ack disabled that button for the rest of the game. And an action fired
   * while the socket is down is rejected here rather than buffered — Socket.IO
   * would otherwise flush it on reconnect, ahead of our `room:rejoin`, where it
   * bounces off "You are not in a room". Rejecting is deliberate: queuing would
   * replay a round's actions into whatever round happens to be running by then.
   */
  const request = useCallback(
    <T,>(
      event: keyof ClientToServerEvents,
      payload: unknown,
      fallbackError: string,
      needsSeat = true
    ): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (needsSeat && !seatReadyRef.current) {
          reject(new Error("You're not connected to the game right now."));
          return;
        }
        // Socket.IO's generated overloads can't describe a generic event name,
        // and the no-payload events collapse their ack argument to `never`. The
        // narrow view here is the one escape hatch, instead of one per caller.
        const sock = getSocket().timeout(REQUEST_TIMEOUT_MS) as unknown as {
          emit: (event: string, ...args: unknown[]) => void;
        };
        const done = (err: Error | null, res?: AckResult<T>) => {
          if (err) {
            reject(new RequestTimeout());
          } else if (res?.ok) {
            resolve(res as unknown as T);
          } else {
            reject(new Error(res?.error ?? fallbackError));
          }
        };
        if (payload === undefined) {
          sock.emit(event, done);
        } else {
          sock.emit(event, payload, done);
        }
      }),
    []
  );

  // Create, join, rejoin and name checks all run without a seat — they're how
  // you get one.
  const createRoom = useCallback(
    async (name: string, pin: string, visibility: RoomVisibility) => {
      const res = await request<{ code: string; playerId: string }>(
        "room:create",
        { name, pin, visibility },
        "Couldn't create the room.",
        false
      );
      persist({ code: res.code, playerId: res.playerId, isHost: true, name });
      return res.code;
    },
    [persist, request]
  );

  const joinRoom = useCallback(
    async (code: string, name: string, pin: string) => {
      const res = await request<{ code: string; playerId: string }>(
        "room:join",
        { code: code.toUpperCase(), name, pin },
        "Couldn't join the room.",
        false
      );
      persist({ code: res.code, playerId: res.playerId, isHost: false, name });
      return res.code;
    },
    [persist, request]
  );

  const checkName = useCallback(
    async (name: string) => {
      if (!name.trim()) {
        return false;
      }
      try {
        const res = await request<{ claimed: boolean }>(
          "name:check",
          { name: name.trim() },
          "",
          false
        );
        return res.claimed;
      } catch {
        // A name check that can't reach the server shouldn't block typing.
        return false;
      }
    },
    [request]
  );

  const rejoin = useCallback(
    async (code: string) => {
      const id = identityRef.current;
      if (!id || id.code.toUpperCase() !== code.toUpperCase()) {
        throw new Error("No saved seat in this room.");
      }
      try {
        await request(
          "room:rejoin",
          { code: id.code, playerId: id.playerId },
          "Couldn't rejoin that game.",
          false
        );
        setSeat(true);
      } catch (e) {
        // Only a refusal proves the seat is gone. Silence proves nothing, and
        // throwing the record away on a timeout would strand someone whose game
        // is still running.
        if (!(e instanceof RequestTimeout)) {
          persist(null);
          clearRecentSeat(id.code);
        }
        throw e;
      }
    },
    [persist, request, setSeat]
  );

  const rejoinRecent = useCallback(
    async (code: string) => {
      const seat = loadRecentSeat(code);
      if (!seat) {
        throw new Error("No saved seat in this room.");
      }
      try {
        await request(
          "room:rejoin",
          { code: seat.code, playerId: seat.playerId },
          "Couldn't rejoin that game.",
          false
        );
      } catch (e) {
        if (!(e instanceof RequestTimeout)) {
          // The seat is gone — forget it so we stop offering to rejoin it.
          clearRecentSeat(code);
        }
        throw e;
      }
      persist({
        code: seat.code,
        playerId: seat.playerId,
        isHost: seat.isHost,
        name: seat.name,
      });
    },
    [persist, request]
  );

  const leave = useCallback(() => {
    // Tell the server, or the seat stays occupied by a ghost: the room keeps
    // counting them, never sweeps, and stays advertised in the games browser.
    // Fire-and-forget — we're navigating away regardless, and the seat is
    // released again by the next create/join on this socket if it misses.
    getSocket().emit("room:leave");
    // The recovery record deliberately survives. Leave is one tap next to the
    // room code, and clearing it here used to make an accidental tap during a
    // started game unrecoverable — `room:join` is lobby-only, so there was no
    // way back in.
    setSeatLost(false);
    persist(null);
    setState(null);
  }, [persist]);

  const simpleAction = useCallback(
    (event: NoArgEvent) => request<void>(event, undefined, "Action failed."),
    [request]
  );

  const submitPhoto = useCallback(
    (dataUrl: string) =>
      request<void>("photo:submit", { dataUrl }, "Upload failed."),
    [request]
  );

  const setGameType = useCallback(
    (gameType: GameType) =>
      request<void>(
        "host:setGameType",
        { gameType },
        "Couldn't switch the game."
      ),
    [request]
  );

  const submitGuess = useCallback(
    (choiceId: string) =>
      request<void>("guess:submit", { choiceId }, "Guess failed."),
    [request]
  );

  const startGeoGame = useCallback(
    (roundDurationSec: number, hostPlaying: boolean) =>
      request<void>(
        "host:startGeoGame",
        { roundDurationSec, hostPlaying },
        "Couldn't start the game."
      ),
    [request]
  );

  const submitGeoGuess = useCallback(
    (lat: number, lng: number) =>
      request<void>("geo:guess", { lat, lng }, "Guess failed."),
    [request]
  );

  const startWordChain = useCallback(
    (
      durationSec: number,
      hostPlaying: boolean,
      difficulty: WordChainDifficultyChoice,
      length: number
    ) =>
      request<void>(
        "host:startWordChain",
        { durationSec, hostPlaying, difficulty, length },
        "Couldn't start the game."
      ),
    [request]
  );

  // Resolves for both right and wrong answers — "wrong" isn't an error, it's
  // the answer. Only a rejected action (not in the room, round over) throws.
  const submitWordGuess = useCallback(
    (index: number, guess: string) =>
      request<WordChainGuessResult>(
        "word:guess",
        { index, guess },
        "Couldn't submit that answer."
      ),
    [request]
  );

  const revealWordHint = useCallback(
    (index: number) =>
      request<{ index: number; revealed: string; hintsUsed: number }>(
        "word:hint",
        { index },
        "No hint available."
      ),
    [request]
  );

  const startDrawIt = useCallback(
    (
      roundDurationSec: number,
      hostPlaying: boolean,
      difficulty: DrawDifficultyChoice
    ) =>
      request<void>(
        "host:startDrawIt",
        { roundDurationSec, hostPlaying, difficulty },
        "Couldn't start the game."
      ),
    [request]
  );

  const pickDrawWord = useCallback(
    (word: string) =>
      request<void>("draw:pickWord", { word }, "Couldn't pick that word."),
    [request]
  );

  /**
   * Send a segment, and keep a copy.
   *
   * The keeping matters: the server broadcasts ink to everyone *except* the
   * sender, so without this the drawer's own finished strokes exist on every
   * screen but theirs — their line would vanish the moment they lifted the pen,
   * because the canvas renders from state and the live stroke has ended.
   *
   * Not awaited. Segments leave several times a second, the drawer has already
   * seen the line, and a dropped one is corrected by the next snapshot.
   */
  const sendDrawStroke = useCallback((stroke: DrawStroke) => {
    // Dropped rather than buffered while the seat is down: socket.io would hold
    // the segment and flush it on reconnect, painting it into whatever round is
    // running by then. The local copy is still kept so the drawer's own line
    // doesn't disappear, and the next snapshot settles the difference.
    if (seatReadyRef.current) {
      getSocket().emit("draw:ink", { strokes: [stroke] });
    }
    setState((s) => applyDrawInk(s, [stroke]));
  }, []);

  const canvasAction = useCallback(
    (event: "draw:undo" | "draw:clear") =>
      request<void>(event, undefined, "That didn't work."),
    [request]
  );

  // Resolves for right and wrong alike — "wrong" is an answer, not an error.
  const submitDrawGuess = useCallback(
    (text: string) =>
      request<DrawGuessResult>(
        "draw:guess",
        { text },
        "Couldn't send that guess."
      ),
    [request]
  );

  const me = useMemo(() => {
    if (!state || !identity) {
      return null;
    }
    return state.players.find((p) => p.id === identity.playerId) ?? null;
  }, [state, identity]);

  const value: GameContextValue = {
    connected,
    ready: connected && seatReady,
    state,
    identity,
    me,
    // Read from the room, not from what we were told when we joined. The host
    // moves now — if the host leaves, someone still in the room takes over —
    // and an identity captured at create time would leave the new host without
    // controls and the old one pressing buttons that answer "Only the host can
    // do that". The stored flag is only a stand-in until the first snapshot.
    isHost: state ? state.hostId === identity?.playerId : Boolean(identity?.isHost),
    createRoom,
    joinRoom,
    checkName,
    rejoin,
    rejoinRecent,
    seatLost,
    lostReason,
    leave,
    setGameType,
    startSubmission: () => simpleAction("host:startSubmission"),
    submitPhoto,
    clearMyPhotos: () => simpleAction("photo:clearMine"),
    startGame: () => simpleAction("host:startGame"),
    submitGuess,
    startGeoGame,
    submitGeoGuess,
    startWordChain,
    submitWordGuess,
    revealWordHint,
    startDrawIt,
    pickDrawWord,
    sendDrawStroke,
    undoDrawStroke: () => canvasAction("draw:undo"),
    clearDrawCanvas: () => canvasAction("draw:clear"),
    submitDrawGuess,
    nextRound: () => simpleAction("host:nextRound"),
    playAgain: () => simpleAction("host:playAgain"),
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return ctx;
}
