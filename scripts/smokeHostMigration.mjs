import {
  assert,
  connect,
  emit,
  run,
  sleep,
  waitFor,
  watchState,
} from "./harness.mjs";

// A game whose host walks away used to be permanently stuck: nobody could
// start, advance or replay it, and it sat there until the sweeper took it.
//
// The crown now moves — but only when the host is really gone. A host who
// refreshes their phone keeps it, and a migration must never change *who is
// playing*: the host who sat out stays sat out, and the promoted player stays
// on the scoreboard. That separation is the whole reason the spectator is
// tracked apart from the host seat.
//
// Requires only the game server on :3001.

const startRoom = async (playerNames) => {
  const host = await connect();
  const hostView = watchState(host);
  const { code, playerId: hostId } = await emit(host, "room:create", {
    name: "Screen",
    pin: "1111",
    visibility: "private",
  });
  const players = [];
  for (const [i, name] of playerNames.entries()) {
    const sock = await connect();
    const view = watchState(sock);
    const { playerId } = await emit(sock, "room:join", {
      code,
      name,
      pin: `222${i}`,
    });
    players.push({ name, sock, view, id: playerId });
  }
  return { host, hostView, hostId, code, players };
};

const main = async () => {
  // --- A host who is only refreshing keeps the crown ----------------------
  {
    const { host, hostId, code, players } = await startRoom(["Ada", "Ben"]);
    host.disconnect();
    await sleep(3_000); // well inside HOST_ABSENT_MIGRATE_MS
    assert(
      players[0].view.state.hostId === hostId,
      "the crown moved while the host was merely refreshing"
    );

    const back = await connect();
    const backView = watchState(back);
    await emit(back, "room:rejoin", { code, playerId: hostId });
    await waitFor(backView, (s) => s.hostId === hostId, "the host lost the crown coming back");
    assert(
      backView.state.players.find((p) => p.id === hostId)?.isHost,
      "the returning host isn't flagged as host"
    );
    console.log("  a host who reconnects in time keeps the crown");
    for (const s of [host, back, ...players.map((p) => p.sock)]) {
      s.close();
    }
  }

  // --- A host who leaves hands it over ------------------------------------
  const { host, hostId, players } = await startRoom(["Ada", "Ben", "Cy"]);
  const [ada] = players;

  await emit(host, "host:startDrawIt", {
    roundDurationSec: 60,
    hostPlaying: false,
    difficulty: "any",
  });
  await waitFor(ada.view, (s) => s.phase === "picking", "never reached picking");

  await emit(host, "room:leave");
  await waitFor(
    ada.view,
    (s) => s.hostId !== hostId,
    "the host left and the crown stayed with them"
  );

  const state = ada.view.state;
  assert(
    state.hostId === ada.id,
    "the crown didn't go to the longest-standing player"
  );
  assert(
    state.players.find((p) => p.id === ada.id)?.isHost,
    "the new host isn't flagged as host"
  );

  // The point of the whole spectator/host split: promotion must not drag Ada
  // off the scoreboard, and must not quietly enrol the departed host on it.
  assert(
    state.players.find((p) => p.id === ada.id)?.spectator === false,
    "the promoted player was turned into a spectator"
  );
  const old = state.players.find((p) => p.id === hostId);
  assert(old.left, "the departed host isn't marked as having left");
  assert(old.spectator, "the departed host stopped being the spectator");
  assert(
    state.players.filter((p) => !p.left && !p.spectator).length === 3,
    "the set of people playing changed when the crown moved"
  );
  console.log("  leaving hands the crown to the longest-standing player");
  console.log("  promotion doesn't change who is playing");

  // --- And the new host can actually run the game -------------------------
  const drawer = players.find((p) => p.id === state.drawRound.drawerId);
  await waitFor(
    drawer.view,
    (s) => s.drawRound?.wordChoices?.length,
    "the drawer was never offered words"
  );
  const secret = drawer.view.state.drawRound.wordChoices[0];
  await emit(drawer.sock, "draw:pickWord", { word: secret });
  await waitFor(ada.view, (s) => s.phase === "playing", "never reached playing");

  for (const g of players.filter((p) => p !== drawer)) {
    await emit(g.sock, "draw:guess", { text: secret });
  }
  await waitFor(ada.view, (s) => s.phase === "reveal", "never reached reveal");

  await emit(ada.sock, "host:nextRound");
  await waitFor(
    ada.view,
    (s) => s.phase === "picking",
    "the new host couldn't advance the round"
  );
  console.log("  the new host can advance the game");

  for (const s of [host, ...players.map((p) => p.sock)]) {
    s.close();
  }
};

run("HOST MIGRATION SMOKE TEST", main);
