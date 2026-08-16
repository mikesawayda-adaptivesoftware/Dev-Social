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

interface GameContextValue {
  connected: boolean;
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
  const identityRef = useRef<Identity | null>(null);

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
            if (!res.ok) {
              // The server no longer has our seat (game ended, or the server
              // restarted and lost in-memory state). Drop the dead active seat
              // and surface a clear state rather than a frozen spinner.
              identityRef.current = null;
              setIdentity(null);
              clearIdentity();
              setState(null);
              setSeatLost(true);
            }
          }
        );
      }
    };
    const onDisconnect = () => setConnected(false);
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
      socket.off("room:state", onState);
      socket.off("room:playerJoined", onPlayerJoined);
      socket.off("room:playerConnection", onPlayerConnection);
      socket.off("round:progress", onRoundProgress);
      socket.off("chain:standing", onChainStanding);
      socket.off("draw:ink", onDrawInk);
      socket.off("draw:canvas", onDrawCanvas);
      socket.off("draw:chat", onDrawChat);
    };
  }, []);

  const persist = useCallback((id: Identity | null) => {
    identityRef.current = id;
    setIdentity(id);
    if (id) {
      setSeatLost(false);
      saveIdentity(id);
    } else {
      clearIdentity();
    }
  }, []);

  const createRoom = useCallback(
    (name: string, pin: string, visibility: RoomVisibility) =>
      new Promise<string>((resolve, reject) => {
        getSocket().emit(
          "room:create",
          { name, pin, visibility },
          (res: AckResult<{ code: string; playerId: string }>) => {
            if (res.ok) {
              persist({ code: res.code, playerId: res.playerId, isHost: true, name });
              resolve(res.code);
            } else {
              reject(new Error(res.error));
            }
          }
        );
      }),
    [persist]
  );

  const joinRoom = useCallback(
    (code: string, name: string, pin: string) =>
      new Promise<string>((resolve, reject) => {
        getSocket().emit(
          "room:join",
          { code: code.toUpperCase(), name, pin },
          (res: AckResult<{ code: string; playerId: string }>) => {
            if (res.ok) {
              persist({ code: res.code, playerId: res.playerId, isHost: false, name });
              resolve(res.code);
            } else {
              reject(new Error(res.error));
            }
          }
        );
      }),
    [persist]
  );

  const checkName = useCallback(
    (name: string) =>
      new Promise<boolean>((resolve) => {
        if (!name.trim()) {
          resolve(false);
          return;
        }
        getSocket().emit(
          "name:check",
          { name: name.trim() },
          (res: AckResult<{ claimed: boolean }>) => {
            resolve(res.ok ? res.claimed : false);
          }
        );
      }),
    []
  );

  const rejoin = useCallback(
    (code: string) =>
      new Promise<void>((resolve, reject) => {
        const id = identityRef.current;
        if (!id || id.code.toUpperCase() !== code.toUpperCase()) {
          reject(new Error("No saved seat in this room."));
          return;
        }
        getSocket().emit(
          "room:rejoin",
          { code: id.code, playerId: id.playerId },
          (res: AckResult<{ ok: true }>) => {
            if (res.ok) {
              resolve();
            } else {
              persist(null);
              reject(new Error(res.error));
            }
          }
        );
      }),
    [persist]
  );

  const rejoinRecent = useCallback(
    (code: string) =>
      new Promise<void>((resolve, reject) => {
        const seat = loadRecentSeat(code);
        if (!seat) {
          reject(new Error("No saved seat in this room."));
          return;
        }
        getSocket().emit(
          "room:rejoin",
          { code: seat.code, playerId: seat.playerId },
          (res: AckResult<{ ok: true }>) => {
            if (res.ok) {
              persist({
                code: seat.code,
                playerId: seat.playerId,
                isHost: seat.isHost,
                name: seat.name,
              });
              resolve();
            } else {
              // The seat is gone — forget it so we stop offering to rejoin it.
              clearRecentSeat(code);
              reject(new Error(res.error));
            }
          }
        );
      }),
    [persist]
  );

  const leave = useCallback(() => {
    const current = identityRef.current;
    if (current) {
      clearRecentSeat(current.code);
    }
    setSeatLost(false);
    persist(null);
    setState(null);
  }, [persist]);

  const simpleAction = useCallback(
    (event: NoArgEvent) =>
      new Promise<void>((resolve, reject) => {
        // These events carry no payload, only an ack callback. The generated
        // socket overloads collapse the ack arg to `never`, so emit through a
        // narrowly-typed view to keep things type-safe without `any`.
        const sock = getSocket() as unknown as {
          emit: (
            event: NoArgEvent,
            ack: (res: AckResult<{ ok: true }>) => void
          ) => void;
        };
        sock.emit(event, (res: AckResult<{ ok: true }>) => {
          if (res?.ok) {
            resolve();
          } else {
            reject(new Error(res?.error ?? "Action failed."));
          }
        });
      }),
    []
  );

  const submitPhoto = useCallback(
    (dataUrl: string) =>
      new Promise<void>((resolve, reject) => {
        getSocket().emit(
          "photo:submit",
          { dataUrl },
          (res: AckResult<{ ok: true }>) => {
            if (res?.ok) {
              resolve();
            } else {
              reject(new Error(res?.error ?? "Upload failed."));
            }
          }
        );
      }),
    []
  );

  const setGameType = useCallback(
    (gameType: GameType) =>
      new Promise<void>((resolve, reject) => {
        getSocket().emit(
          "host:setGameType",
          { gameType },
          (res: AckResult<{ ok: true }>) => {
            if (res?.ok) {
              resolve();
            } else {
              reject(new Error(res?.error ?? "Couldn't switch the game."));
            }
          }
        );
      }),
    []
  );

  const submitGuess = useCallback(
    (choiceId: string) =>
      new Promise<void>((resolve, reject) => {
        getSocket().emit(
          "guess:submit",
          { choiceId },
          (res: AckResult<{ ok: true }>) => {
            if (res?.ok) {
              resolve();
            } else {
              reject(new Error(res?.error ?? "Guess failed."));
            }
          }
        );
      }),
    []
  );

  const startGeoGame = useCallback(
    (roundDurationSec: number, hostPlaying: boolean) =>
      new Promise<void>((resolve, reject) => {
        getSocket().emit(
          "host:startGeoGame",
          { roundDurationSec, hostPlaying },
          (res: AckResult<{ ok: true }>) => {
            if (res?.ok) {
              resolve();
            } else {
              reject(new Error(res?.error ?? "Couldn't start the game."));
            }
          }
        );
      }),
    []
  );

  const submitGeoGuess = useCallback(
    (lat: number, lng: number) =>
      new Promise<void>((resolve, reject) => {
        getSocket().emit(
          "geo:guess",
          { lat, lng },
          (res: AckResult<{ ok: true }>) => {
            if (res?.ok) {
              resolve();
            } else {
              reject(new Error(res?.error ?? "Guess failed."));
            }
          }
        );
      }),
    []
  );

  const startWordChain = useCallback(
    (
      durationSec: number,
      hostPlaying: boolean,
      difficulty: WordChainDifficultyChoice,
      length: number
    ) =>
      new Promise<void>((resolve, reject) => {
        getSocket().emit(
          "host:startWordChain",
          { durationSec, hostPlaying, difficulty, length },
          (res: AckResult<{ ok: true }>) => {
            if (res?.ok) {
              resolve();
            } else {
              reject(new Error(res?.error ?? "Couldn't start the game."));
            }
          }
        );
      }),
    []
  );

  // Resolves for both right and wrong answers — "wrong" isn't an error, it's
  // the answer. Only a rejected action (not in the room, round over) throws.
  const submitWordGuess = useCallback(
    (index: number, guess: string) =>
      new Promise<WordChainGuessResult>((resolve, reject) => {
        getSocket().emit(
          "word:guess",
          { index, guess },
          (res: AckResult<WordChainGuessResult>) => {
            if (res?.ok) {
              resolve(res);
            } else {
              reject(new Error(res?.error ?? "Couldn't submit that answer."));
            }
          }
        );
      }),
    []
  );

  const revealWordHint = useCallback(
    (index: number) =>
      new Promise<{ index: number; revealed: string; hintsUsed: number }>(
        (resolve, reject) => {
          getSocket().emit("word:hint", { index }, (res) => {
            if (res?.ok) {
              resolve(res);
            } else {
              reject(new Error(res?.error ?? "No hint available."));
            }
          });
        }
      ),
    []
  );

  const startDrawIt = useCallback(
    (
      roundDurationSec: number,
      hostPlaying: boolean,
      difficulty: DrawDifficultyChoice
    ) =>
      new Promise<void>((resolve, reject) => {
        getSocket().emit(
          "host:startDrawIt",
          { roundDurationSec, hostPlaying, difficulty },
          (res: AckResult<{ ok: true }>) => {
            if (res?.ok) {
              resolve();
            } else {
              reject(new Error(res?.error ?? "Couldn't start the game."));
            }
          }
        );
      }),
    []
  );

  const pickDrawWord = useCallback(
    (word: string) =>
      new Promise<void>((resolve, reject) => {
        getSocket().emit(
          "draw:pickWord",
          { word },
          (res: AckResult<{ ok: true }>) => {
            if (res?.ok) {
              resolve();
            } else {
              reject(new Error(res?.error ?? "Couldn't pick that word."));
            }
          }
        );
      }),
    []
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
    getSocket().emit("draw:ink", { strokes: [stroke] });
    setState((s) => applyDrawInk(s, [stroke]));
  }, []);

  const canvasAction = useCallback(
    (event: "draw:undo" | "draw:clear") =>
      new Promise<void>((resolve, reject) => {
        const sock = getSocket() as unknown as {
          emit: (
            event: "draw:undo" | "draw:clear",
            ack: (res: AckResult<{ ok: true }>) => void
          ) => void;
        };
        sock.emit(event, (res) => {
          if (res?.ok) {
            resolve();
          } else {
            reject(new Error(res?.error ?? "That didn't work."));
          }
        });
      }),
    []
  );

  // Resolves for right and wrong alike — "wrong" is an answer, not an error.
  const submitDrawGuess = useCallback(
    (text: string) =>
      new Promise<DrawGuessResult>((resolve, reject) => {
        getSocket().emit(
          "draw:guess",
          { text },
          (res: AckResult<DrawGuessResult>) => {
            if (res?.ok) {
              resolve(res);
            } else {
              reject(new Error(res?.error ?? "Couldn't send that guess."));
            }
          }
        );
      }),
    []
  );

  const me = useMemo(() => {
    if (!state || !identity) {
      return null;
    }
    return state.players.find((p) => p.id === identity.playerId) ?? null;
  }, [state, identity]);

  const value: GameContextValue = {
    connected,
    state,
    identity,
    me,
    isHost: Boolean(identity?.isHost),
    createRoom,
    joinRoom,
    checkName,
    rejoin,
    rejoinRecent,
    seatLost,
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
