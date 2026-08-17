import { assert, connect, emit, run, sleep } from "./harness.mjs";

// `seats:check` — what the landing page's "you're still in a game" card runs on.
//
// The browser remembers every seat it ever took, but a remembered seat is only
// a hint: rooms end, and the server loses all of them on a restart. So the card
// only ever shows what the server confirms, and a seat it doesn't recognise has
// to come back absent rather than as a dead rejoin button — that's what lets
// the client prune it.
//
// Requires only the game server on :3001.

const main = async () => {
  const [hostA, hostB, ada] = await Promise.all([
    connect(),
    connect(),
    connect(),
  ]);

  const a = await emit(hostA, "room:create", {
    name: "Hostie",
    pin: "1111",
    visibility: "private",
  });
  const b = await emit(hostB, "room:create", {
    name: "Other",
    pin: "1111",
    visibility: "private",
  });
  const adaId = (
    await emit(ada, "room:join", { code: a.code, name: "Ada", pin: "2221" })
  ).playerId;

  // Two live seats and one room that never existed.
  const check = (seats) => emit(ada, "seats:check", { seats });
  let res = await check([
    { code: a.code, playerId: adaId },
    { code: b.code, playerId: b.playerId },
    { code: "ZZZZ", playerId: "nobody" },
  ]);
  assert(
    res.seats.length === 2,
    `expected 2 live seats, got ${res.seats.length}`
  );
  assert(
    !res.seats.some((s) => s.code === "ZZZZ"),
    "a room that doesn't exist came back as a live seat"
  );
  console.log("  only seats the server still has come back");

  const mine = res.seats.find((s) => s.code === a.code);
  assert(mine.name === "Ada", `the seat named the wrong player: ${mine.name}`);
  assert(mine.hostName === "Hostie", "the seat named the wrong host");
  assert(mine.isHost === false, "a joined player was reported as the host");
  assert(mine.phase === "lobby", `unexpected phase ${mine.phase}`);
  assert(mine.playerCount === 2, `expected 2 players, got ${mine.playerCount}`);
  const theirs = res.seats.find((s) => s.code === b.code);
  assert(theirs.isHost, "a host's own seat wasn't reported as the host's");
  console.log("  a seat describes its game well enough to label a button");

  // A real playerId is not a skeleton key: it only opens its own room.
  res = await check([{ code: b.code, playerId: adaId }]);
  assert(
    res.seats.length === 0,
    "a playerId from another room was accepted as a seat"
  );
  console.log("  a playerId only describes the room it belongs to");

  // Leaving is recoverable, so a left seat is still worth offering — it's the
  // way back from a mis-tap. It disappears only when the room does.
  await emit(ada, "room:leave");
  await sleep(200);
  res = await check([{ code: a.code, playerId: adaId }]);
  assert(res.seats.length === 1, "leaving a game threw away the way back into it");
  console.log("  leaving keeps the seat resumable");

  await emit(hostA, "room:leave");
  await sleep(200);
  res = await check([{ code: a.code, playerId: adaId }]);
  assert(
    res.seats.length === 0,
    "a seat in a closed room is still offered as resumable"
  );
  console.log("  a seat in a closed room drops out of the list");

  for (const s of [hostA, hostB, ada]) {
    s.close();
  }
};

run("SEATS SMOKE TEST", main);
