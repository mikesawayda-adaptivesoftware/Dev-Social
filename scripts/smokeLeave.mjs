import { io } from "socket.io-client";

// Leaving a room, and the duplicate-room bug it was hiding.
//
// The bug that started this: "Leave" was client-only, so the server kept the
// player connected forever — the room never swept, stayed advertised in the
// games browser, and still counted them as a competitor. And create/join never
// released the previous seat, so one socket sat in two rooms and both showed as
// live. That's how the same person ended up hosting two games at once.

const SERVER_URL = "http://localhost:3001";

const emit = (sock, event, payload) =>
  new Promise((resolve, reject) => {
    const cb = (res) =>
      res?.ok ? resolve(res) : reject(new Error(res?.error ?? "no ack"));
    if (payload === undefined) {
      sock.emit(event, cb);
    } else {
      sock.emit(event, payload, cb);
    }
  });

const connect = () =>
  new Promise((resolve) => {
    const s = io(SERVER_URL, { transports: ["websocket"] });
    s.on("connect", () => resolve(s));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const assert = (cond, message) => {
  if (!cond) {
    throw new Error(message);
  }
};

/**
 * Assert an emit is rejected. Never write this as
 * `.then(() => assert(false)).catch(() => {})` — the catch swallows the assert
 * too, so a call that wrongly *succeeds* passes silently.
 */
const expectFail = async (promise, pattern, message) => {
  let ackErr = null;
  try {
    await promise;
  } catch (e) {
    ackErr = e;
  }
  assert(ackErr, message);
  assert(
    pattern.test(ackErr.message),
    `${message} — expected ${pattern}, got "${ackErr.message}"`
  );
};

/**
 * The public games list, as the browser page sees it.
 *
 * `rooms:unsubscribe` takes no ack, so it is fired and forgotten — awaiting it
 * would wait for a callback the server never makes.
 */
const browseList = async (sock) => {
  const res = await emit(sock, "rooms:subscribe");
  sock.emit("rooms:unsubscribe");
  return res.rooms;
};

const main = async () => {
  const [host, a, b, browser] = await Promise.all([
    connect(),
    connect(),
    connect(),
    connect(),
  ]);

  // Attached before anything happens — snapshots are pushed on join, and a
  // listener added afterwards would simply miss them.
  //
  // The joined-delta is applied the way the real client applies it: a join
  // sends the newcomer a full snapshot and everyone else a single roster entry,
  // so without this the host's view stays stuck at "one player".
  let hostState = null;
  host.on("room:state", (s) => {
    hostState = s;
  });
  host.on("room:playerJoined", ({ player }) => {
    if (hostState && !hostState.players.some((p) => p.id === player.id)) {
      hostState.players.push(player);
    }
  });

  // --- A player leaving frees their seat --------------------------------
  const created = await emit(host, "room:create", {
    name: "Hostie",
    pin: "1111",
    visibility: "public",
  });
  const code = created.code;
  await emit(a, "room:join", { code, name: "Ada", pin: "2221" });
  const benId = (await emit(b, "room:join", { code, name: "Ben", pin: "2222" }))
    .playerId;

  await sleep(300);
  assert(hostState, "host never got a snapshot");
  assert(
    hostState.players.filter((p) => !p.left).length === 3,
    `expected 3 players, got ${hostState.players.filter((p) => !p.left).length}`
  );

  await emit(b, "room:leave");
  await sleep(400);
  const ben = hostState.players.find((p) => p.name === "Ben");
  assert(ben, "Ben vanished from the roster entirely — he should be marked left");
  assert(ben.left, "Ben left but isn't marked left");
  console.log("  a player leaving marks the seat, keeps the record");

  let list = await browseList(browser);
  const listed = list.find((r) => r.code === code);
  assert(listed, "the public lobby disappeared while people were still in it");
  assert(
    listed.playerCount === 2,
    `browse list says ${listed.playerCount} players, expected 2`
  );
  console.log("  the games browser drops a leaver from the count");

  // --- Leaving is recoverable -------------------------------------------
  // Leave is one mis-tap away on a phone, so it has to be undoable: rejoining
  // with the same playerId clears `left` and puts the seat back.
  await emit(b, "room:rejoin", { code, playerId: benId });
  await sleep(300);
  const backAgain = hostState.players.find((p) => p.name === "Ben");
  assert(!backAgain.left, "Ben rejoined but is still marked left");
  list = await browseList(browser);
  assert(
    list.find((r) => r.code === code)?.playerCount === 3,
    "the count didn't go back up after a rejoin"
  );
  console.log("  leaving is recoverable — rejoining restores the seat");

  await expectFail(
    emit(b, "room:rejoin", { code, playerId: "not-a-real-player" }),
    /no longer part of this room|not found/i,
    "an unknown playerId was allowed to claim a seat"
  );
  console.log("  an unknown playerId can't claim a seat");

  await emit(b, "room:leave");

  // --- The last person leaving closes the room --------------------------
  await emit(a, "room:leave");
  await emit(host, "room:leave");
  await sleep(400);

  list = await browseList(browser);
  assert(
    !list.some((r) => r.code === code),
    "the emptied room is still advertised in the games browser"
  );
  const gone = await connect();
  await expectFail(
    emit(gone, "room:join", { code, name: "Late", pin: "9999" }),
    /not found/i,
    "joined a room that should be gone"
  );
  gone.close();
  console.log("  the last player leaving closes the room immediately");

  // --- The regression: two rooms hosted from one socket ------------------
  const first = await emit(host, "room:create", {
    name: "Hostie",
    pin: "1111",
    visibility: "public",
  });
  await sleep(200);
  const second = await emit(host, "room:create", {
    name: "Hostie",
    pin: "1111",
    visibility: "public",
  });
  await sleep(400);

  list = await browseList(browser);
  const mine = list.filter(
    (r) => r.code === first.code || r.code === second.code
  );
  assert(
    mine.length === 1,
    `hosting twice from one socket left ${mine.length} rooms listed — this is the two-games bug`
  );
  assert(
    mine[0].code === second.code,
    "the wrong room survived — the newest should be the live one"
  );
  console.log("  hosting again releases the first room, so only one is listed");

  for (const s of [host, a, b, browser]) {
    s.close();
  }
  console.log("LEAVE SMOKE TEST PASSED");
  process.exit(0);
};

main().catch((e) => {
  console.error("LEAVE SMOKE TEST FAILED:", e);
  process.exit(1);
});
