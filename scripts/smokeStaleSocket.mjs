import {
  assert,
  connect,
  emit,
  run,
  sleep,
  watchState,
} from "./harness.mjs";

// One seat, one socket.
//
// A phone that sleeps mid-game often doesn't close its socket — the server
// still believes it is connected while the browser has already opened a fresh
// one and rejoined. Both then hold the same seat, and the zombie's disconnect
// (whenever the OS finally gets round to it) marks a live player as gone.
//
// So re-claiming a seat evicts whoever held it. The subtle part is the
// aftermath: the eviction must not look like the player leaving.
//
// Requires only the game server on :3001.

const main = async () => {
  const host = await connect();
  const hostView = watchState(host);
  const { code } = await emit(host, "room:create", {
    name: "Screen",
    pin: "1111",
    visibility: "private",
  });

  const first = await connect();
  const { playerId } = await emit(first, "room:join", {
    code,
    name: "Ada",
    pin: "2221",
  });

  let closedReason = null;
  first.on("room:closed", (reason) => {
    closedReason = reason;
  });
  let firstDisconnected = false;
  first.on("disconnect", () => {
    firstDisconnected = true;
  });

  // The same seat, from a second socket — a refreshed phone, in effect.
  const second = await connect();
  const secondView = watchState(second);
  await emit(second, "room:rejoin", { code, playerId });
  await sleep(500);

  assert(closedReason, "the evicted socket was never told why it was cut off");
  assert(firstDisconnected, "the evicted socket is still connected");
  console.log(`  the stale socket is disconnected: "${closedReason}"`);

  // The bug this guards against: the eviction disconnect running the normal
  // disconnect path and marking a player who is right here as gone.
  const ada = hostView.state.players.find((p) => p.id === playerId);
  assert(ada, "Ada vanished from the roster");
  assert(
    ada.connected,
    "evicting the stale socket marked the live player as disconnected"
  );
  assert(!ada.left, "evicting the stale socket marked the live player as gone");
  assert(
    secondView.state.players.find((p) => p.id === playerId)?.connected,
    "the socket that claimed the seat doesn't see itself connected"
  );
  console.log("  the seat stays live and connected on the surviving socket");

  // And the seat is genuinely usable from the socket that took it over — an
  // eviction that left the seat half-detached would show up here.
  await emit(second, "room:leave");
  await sleep(300);
  assert(
    hostView.state.players.find((p) => p.id === playerId)?.left,
    "the surviving socket couldn't act on the seat it claimed"
  );
  console.log("  the surviving socket really owns the seat");

  for (const s of [host, first, second]) {
    s.close();
  }
};

run("STALE SOCKET SMOKE TEST", main);
