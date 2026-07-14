import "./loadEnv";
import { createServer } from "node:http";
import { Server } from "socket.io";
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

/** Push the personalized room view to every connected member of a room. */
function broadcastRoom(code: string) {
  const room = store.getRoom(code);
  if (!room) {
    return;
  }
  for (const player of room.players.values()) {
    if (player.connected && player.socketId) {
      try {
        const view = store.viewFor(code, player.id);
        io.to(player.socketId).emit("room:state", view);
      } catch {
        // Room may have been removed mid-iteration; ignore.
      }
    }
  }
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
  socket.on("room:create", async ({ name, pin }, ack) => {
    try {
      const { code, playerId } = await store.createRoom(name, pin);
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
      broadcastRoom(res.code);
    } catch (err) {
      ack(fail(err) as never);
    }
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
      broadcastRoom(code);
    } catch (err) {
      ack(fail(err) as never);
    }
  });

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
    withRoom((code, pid) => store.submitGuess(code, pid, choiceId), ack)
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
    withRoom((code, pid) => store.submitGeoGuess(code, pid, lat, lng), ack)
  );
  socket.on("host:nextRound", (ack) =>
    withRoom((code, pid) => store.nextRound(code, pid), ack)
  );
  socket.on("host:playAgain", (ack) =>
    withRoom((code, pid) => store.playAgain(code, pid), ack)
  );

  socket.on("disconnect", () => {
    const changed = store.markDisconnected(socket.id);
    for (const code of changed) {
      broadcastRoom(code);
    }
  });
});

setInterval(() => store.sweep(), 1000 * 60 * 30);

httpServer.listen(PORT, () => {
  console.log(`\u25B6 Realtime game server listening on http://localhost:${PORT}`);
  console.log(
    supabaseEnabled
      ? "\u2713 Supabase connected — games persist + photos go to Storage."
      : "\u26A0 Supabase not configured — running in-memory only (local mode)."
  );
});
