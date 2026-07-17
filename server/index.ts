import "./loadEnv";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { nanoid } from "nanoid";
import { RoomStore, RoomError } from "./rooms";
import {
  isNameClaimed,
  persistFinishedGame,
  supabaseEnabled,
  uploadPhoto,
} from "./supabase";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  AckResult,
} from "../src/shared/types";

const PORT = Number(process.env.GAME_SERVER_PORT ?? 3001);
const CORS_ORIGIN = process.env.GAME_CLIENT_ORIGIN ?? "*";

interface SocketData {
  code?: string;
  playerId?: string;
}

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const store = new RoomStore();
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(httpServer, {
  cors: { origin: CORS_ORIGIN },
  maxHttpBufferSize: 4_000_000, // allow base64 photo uploads
});

// Socket.IO room holding everyone watching the public games browser. Unlike a
// game room, every subscriber gets the identical payload, so this one really is
// a broadcast (see `broadcastRoom` below for why game rooms can't be).
const BROWSE_ROOM = "browse:public";

/** Push the current public games list to anyone browsing. */
function broadcastPublicRooms() {
  // Nobody's looking — skip rebuilding the list. Without this guard every guess
  // in every in-progress game would recompute it for no one.
  if (!io.sockets.adapter.rooms.get(BROWSE_ROOM)?.size) {
    return;
  }
  io.to(BROWSE_ROOM).emit("rooms:list", store.listPublicRooms());
}

/** Send one player their full personalized snapshot. */
function sendSnapshot(code: string, playerId: string, socketId: string) {
  try {
    io.to(socketId).emit("room:state", store.viewFor(code, playerId));
  } catch {
    // Room may have been removed; ignore.
  }
}

/**
 * A guess happened and the round is still open.
 *
 * The only thing that changed for everyone else is the answered counter, so send
 * them 20 bytes instead of a fresh roster each. The guesser gets a real snapshot
 * — it's one player, and it keeps their personal fields (myGuess/iGuessed) exact
 * without inventing a second delta shape for them.
 *
 * Callers must handle the round-closing case themselves: that's a phase change,
 * and everyone needs a full snapshot for it.
 */
function broadcastGuessProgress(
  code: string,
  guesserId: string,
  socket: GameSocket
) {
  const answeredCount = store.answeredCount(code);
  if (answeredCount === null) {
    // Not in a round any more — fall back to the safe thing.
    broadcastRoom(code);
    return;
  }
  // socket.to(room) reaches every member EXCEPT this socket, which is exactly
  // the split we want, and socket.io encodes the packet once for all of them.
  socket.to(code).emit("round:progress", { answeredCount });
  sendSnapshot(code, guesserId, socket.id);
}

/** Push the personalized room view to every connected member of a room. */
function broadcastRoom(code: string) {
  const room = store.getRoom(code);
  // Each player needs a *different* view (answer coords are withheld from
  // whoever hasn't guessed yet), so this emits per-socket rather than to the
  // socket.io room.
  if (room) {
    for (const player of room.players.values()) {
      if (player.connected && player.socketId) {
        sendSnapshot(code, player.id, player.socketId);
      }
    }
  }
  // Any room change can change the browsable list — a player joining bumps a
  // count, a host starting removes the lobby entirely. Every mutation path funnels
  // through here, so piggybacking keeps the list from ever going stale.
  broadcastPublicRooms();
}

store.onRoomChanged = broadcastRoom;

// Persist completed games to Supabase (no-op when Supabase isn't configured).
store.onGameFinished = (code) => {
  const finished = store.takeFinishedGame(code);
  if (finished) {
    void persistFinishedGame(finished);
  }
};

function ok<T>(data: T): AckResult<T> {
  return { ok: true, ...data };
}

function fail(error: unknown): AckResult<never> {
  const message =
    error instanceof RoomError
      ? error.message
      : "Something went wrong. Try again.";
  if (!(error instanceof RoomError)) {
    console.error(error);
  }
  return { ok: false, error: message };
}

io.on("connection", (socket) => {
  socket.on("room:create", async ({ name, pin, visibility }, ack) => {
    try {
      const { code, playerId } = await store.createRoom(name, pin, visibility);
      socket.data.code = code;
      socket.data.playerId = playerId;
      store.attachSocket(code, playerId, socket.id);
      socket.join(code);
      ack(ok({ code, playerId }));
      broadcastRoom(code);
    } catch (err) {
      ack(fail(err) as never);
    }
  });

  socket.on("room:join", async ({ code, name, pin }, ack) => {
    try {
      const res = await store.joinRoom(code, name, pin);
      socket.data.code = res.code;
      socket.data.playerId = res.playerId;
      store.attachSocket(res.code, res.playerId, socket.id);
      socket.join(res.code);
      ack(ok(res));

      // The joiner needs everything; everyone else needs one new roster entry.
      // Snapshotting all of them here is what made filling a 100-player lobby
      // cost ~136 MB.
      sendSnapshot(res.code, res.playerId, socket.id);
      const player = store.publicPlayer(res.code, res.playerId);
      if (player) {
        socket.to(res.code).emit("room:playerJoined", { player });
      }
      broadcastPublicRooms();
    } catch (err) {
      ack(fail(err) as never);
    }
  });

  socket.on("rooms:subscribe", (ack) => {
    socket.join(BROWSE_ROOM);
    // Ack with the list so the browser paints immediately instead of waiting
    // for the next room change to push one.
    ack(ok({ rooms: store.listPublicRooms() }));
  });

  socket.on("rooms:unsubscribe", () => {
    socket.leave(BROWSE_ROOM);
  });

  socket.on("name:check", async ({ name }, ack) => {
    try {
      const claimed = await isNameClaimed(name);
      ack(ok({ claimed }));
    } catch {
      ack(ok({ claimed: false }));
    }
  });

  socket.on("room:rejoin", ({ code, playerId }, ack) => {
    try {
      store.rejoin(code, playerId, socket.id);
      socket.data.code = code;
      socket.data.playerId = playerId;
      socket.join(code);
      ack(ok({ ok: true as const }));

      // A full snapshot here is what makes the delta scheme safe: any client
      // that dropped — and so may have missed deltas — resyncs on the way back.
      sendSnapshot(code, playerId, socket.id);
      socket.to(code).emit("room:playerConnection", { playerId, connected: true });
      broadcastPublicRooms();
    } catch (err) {
      ack(fail(err) as never);
    }
  });

  /**
   * A guess: the hot path. If it closed the round that's a phase change and
   * everyone gets a snapshot; otherwise only the counter moved, so everyone but
   * the guesser gets 20 bytes.
   */
  const withGuess = (
    handler: (code: string, playerId: string) => void,
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) {
      ack?.({ ok: false, error: "You are not in a room." });
      return;
    }
    try {
      const phaseBefore = store.getRoom(code)?.phase;
      handler(code, playerId);
      ack?.(ok({ ok: true as const }));
      const phaseAfter = store.getRoom(code)?.phase;
      if (phaseAfter !== phaseBefore) {
        broadcastRoom(code);
      } else {
        broadcastGuessProgress(code, playerId, socket);
      }
    } catch (err) {
      ack?.(fail(err) as never);
    }
  };

  const withRoom = (
    handler: (code: string, playerId: string) => void,
    ack?: (res: AckResult<{ ok: true }>) => void
  ) => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) {
      ack?.({ ok: false, error: "You are not in a room." });
      return;
    }
    try {
      handler(code, playerId);
      ack?.(ok({ ok: true as const }));
      broadcastRoom(code);
    } catch (err) {
      ack?.(fail(err) as never);
    }
  };

  socket.on("host:setGameType", ({ gameType }, ack) =>
    withRoom((code, pid) => store.setGameType(code, pid, gameType), ack)
  );
  socket.on("host:startSubmission", (ack) =>
    withRoom((code, pid) => store.startSubmission(code, pid), ack)
  );
  socket.on("photo:submit", async ({ dataUrl }, ack) => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) {
      ack?.({ ok: false, error: "You are not in a room." });
      return;
    }
    try {
      const photoId = nanoid(8);
      let content = dataUrl;
      if (supabaseEnabled && dataUrl.startsWith("data:")) {
        const url = await uploadPhoto(code, photoId, dataUrl);
        if (url) {
          content = url;
        }
      }
      store.submitPhoto(code, playerId, content, photoId);
      ack?.(ok({ ok: true as const }));
      broadcastRoom(code);
    } catch (err) {
      ack?.(fail(err) as never);
    }
  });
  socket.on("photo:clearMine", (ack) =>
    withRoom((code, pid) => store.clearMyPhotos(code, pid), ack)
  );
  socket.on("host:startGame", (ack) =>
    withRoom((code, pid) => store.startGame(code, pid), ack)
  );
  socket.on("guess:submit", ({ choiceId }, ack) =>
    withGuess((code, pid) => store.submitGuess(code, pid, choiceId), ack)
  );
  socket.on("host:startGeoGame", async ({ roundDurationSec, hostPlaying }, ack) => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) {
      ack?.({ ok: false, error: "You are not in a room." });
      return;
    }
    try {
      await store.startGeoGame(code, playerId, roundDurationSec, hostPlaying);
      ack?.(ok({ ok: true as const }));
      broadcastRoom(code);
    } catch (err) {
      ack?.(fail(err) as never);
    }
  });
  socket.on("geo:guess", ({ lat, lng }, ack) =>
    withGuess((code, pid) => store.submitGeoGuess(code, pid, lat, lng), ack)
  );
  socket.on("host:nextRound", (ack) =>
    withRoom((code, pid) => store.nextRound(code, pid), ack)
  );
  socket.on("host:playAgain", (ack) =>
    withRoom((code, pid) => store.playAgain(code, pid), ack)
  );

  socket.on("disconnect", () => {
    const changed = store.markDisconnected(socket.id);
    for (const { code, playerId } of changed) {
      const phaseBefore = store.getRoom(code)?.phase;
      // A dropout may let the current round close early, or (if the host left)
      // arm the reveal auto-advance, before we push the updated state.
      store.handleDisconnect(code);
      const room = store.getRoom(code);
      if (!room) {
        continue;
      }
      if (room.phase !== phaseBefore) {
        // The dropout closed the round — that's a phase change, everyone needs
        // the new state.
        broadcastRoom(code);
      } else {
        // This socket has already left its rooms, so io.to reaches the rest.
        io.to(code).emit("room:playerConnection", { playerId, connected: false });
        broadcastPublicRooms();
      }
    }
  });
});

// Runs often enough that the sweep's short empty-lobby TTL means something —
// at a 30m interval a "10 minute" reap could take 40.
setInterval(() => {
  store.sweep();
  broadcastPublicRooms();
}, 1000 * 60 * 2);

httpServer.listen(PORT, () => {
  console.log(`\u25B6 Realtime game server listening on http://localhost:${PORT}`);
  console.log(
    supabaseEnabled
      ? "\u2713 Supabase connected — games persist + photos go to Storage."
      : "\u26A0 Supabase not configured — running in-memory only (local mode)."
  );
});
