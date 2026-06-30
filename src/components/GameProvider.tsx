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
  getSocket,
  loadIdentity,
  saveIdentity,
  type Identity,
} from "@/lib/socket";
import type { AckResult, RoomState } from "@/shared/types";

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
  createRoom: (name: string) => Promise<string>;
  joinRoom: (code: string, name: string) => Promise<string>;
  rejoin: (code: string) => Promise<void>;
  leave: () => void;
  startSubmission: () => Promise<void>;
  submitPhoto: (dataUrl: string) => Promise<void>;
  clearMyPhotos: () => Promise<void>;
  startGame: () => Promise<void>;
  submitGuess: (choiceId: string) => Promise<void>;
  nextRound: () => Promise<void>;
  playAgain: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const identityRef = useRef<Identity | null>(null);

  useEffect(() => {
    const stored = loadIdentity();
    if (stored) {
      setIdentity(stored);
      identityRef.current = stored;
    }

    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      // Re-establish room membership after a reconnect.
      const id = identityRef.current;
      if (id) {
        socket.emit("room:rejoin", { code: id.code, playerId: id.playerId }, () => {});
      }
    };
    const onDisconnect = () => setConnected(false);
    const onState = (next: RoomState) => setState(next);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onState);
    };
  }, []);

  const persist = useCallback((id: Identity | null) => {
    identityRef.current = id;
    setIdentity(id);
    if (id) {
      saveIdentity(id);
    } else {
      clearIdentity();
    }
  }, []);

  const createRoom = useCallback(
    (name: string) =>
      new Promise<string>((resolve, reject) => {
        getSocket().emit(
          "room:create",
          { name },
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
    (code: string, name: string) =>
      new Promise<string>((resolve, reject) => {
        getSocket().emit(
          "room:join",
          { code: code.toUpperCase(), name },
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

  const leave = useCallback(() => {
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
    rejoin,
    leave,
    startSubmission: () => simpleAction("host:startSubmission"),
    submitPhoto,
    clearMyPhotos: () => simpleAction("photo:clearMine"),
    startGame: () => simpleAction("host:startGame"),
    submitGuess,
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
