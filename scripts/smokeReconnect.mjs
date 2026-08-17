import {
  assert,
  connect,
  emit,
  run,
  sleep,
  waitFor,
  watchState,
} from "./harness.mjs";

// Refreshing your phone must not destroy the round.
//
// Two halves, both on one Draw It round:
//
//   1. The drawer drops mid-round and comes back inside the grace. Before the
//      grace existed this closed the whole round instantly — you could lose the
//      picture you were drawing by locking your screen.
//   2. A guesser drops for good. The other guessers have all solved, so the
//      round is only still open because the absent one is inside their grace.
//      When it expires the round must actually close — deferring a consequence
//      is only safe if it still eventually happens.
//
// Requires only the game server on :3001.

// Must comfortably exceed DISCONNECT_GRACE_MS in server/rooms.ts.
const PAST_GRACE_MS = 14_000;

const main = async () => {
  const host = await connect();
  const players = [];
  for (const name of ["Ada", "Ben", "Cy", "Dee"]) {
    players.push({ name, sock: await connect() });
  }

  const hostView = watchState(host);
  for (const p of players) {
    p.view = watchState(p.sock);
  }

  const { code } = await emit(host, "room:create", {
    name: "Screen",
    pin: "1111",
    visibility: "private",
  });
  for (const [i, p] of players.entries()) {
    p.id = (await emit(p.sock, "room:join", { code, name: p.name, pin: `222${i}` }))
      .playerId;
  }

  // 60s is long enough that nothing below can be explained by the round timer.
  await emit(host, "host:startDrawIt", {
    roundDurationSec: 60,
    hostPlaying: false,
    difficulty: "any",
  });
  await waitFor(hostView, (s) => s.phase === "picking", "never reached picking");

  const drawer = players.find(
    (p) => p.id === hostView.state.drawRound.drawerId
  );
  assert(drawer, "the drawer wasn't one of the joined players");
  const guessers = players.filter((p) => p !== drawer);

  await waitFor(
    drawer.view,
    (s) => s.drawRound?.wordChoices?.length,
    `${drawer.name} was never offered words`
  );
  const secret = drawer.view.state.drawRound.wordChoices[0];
  await emit(drawer.sock, "draw:pickWord", { word: secret });
  await waitFor(hostView, (s) => s.phase === "playing", "never reached playing");

  // --- 1. The drawer refreshes ------------------------------------------
  await emit(drawer.sock, "draw:ink", {
    strokes: [{ color: 0, width: 1, points: [100, 100, 800, 800] }],
  });
  drawer.sock.disconnect();
  await sleep(2_000);
  assert(
    hostView.state.phase === "playing",
    `the drawer dropping closed the round (phase ${hostView.state.phase})`
  );
  console.log("  the drawer dropping doesn't close the round");

  const back = await connect();
  const backView = watchState(back);
  await emit(back, "room:rejoin", { code, playerId: drawer.id });
  await waitFor(
    backView,
    (s) => s.drawRound?.iAmDrawer,
    "the returning drawer wasn't given the round back"
  );
  assert(
    backView.state.drawRound.word === secret,
    "the returning drawer wasn't told the word again"
  );
  assert(
    backView.state.drawRound.strokes.length > 0,
    "the returning drawer lost the strokes they'd already made"
  );
  assert(
    hostView.state.phase === "playing",
    "the round ended while the drawer was coming back"
  );
  console.log("  rejoining inside the grace restores the drawer's round intact");

  // --- 2. A guesser drops for good ---------------------------------------
  const [stayA, stayB, quitter] = guessers;
  for (const g of [stayA, stayB]) {
    const res = await emit(g.sock, "draw:guess", { text: secret });
    assert(res.correct, `${g.name}'s correct guess was rejected`);
  }
  quitter.sock.disconnect();
  await sleep(2_000);
  assert(
    hostView.state.phase === "playing",
    "the round closed on a player who was still inside their grace"
  );
  console.log("  a dropped guesser still holds the round open during grace");

  await waitFor(
    hostView,
    (s) => s.phase === "reveal",
    "the round never closed after the grace expired",
    PAST_GRACE_MS
  );
  console.log("  once the grace expires the round closes as it should");

  for (const s of [host, back, ...players.map((p) => p.sock)]) {
    s.close();
  }
};

run("RECONNECT SMOKE TEST", main);
