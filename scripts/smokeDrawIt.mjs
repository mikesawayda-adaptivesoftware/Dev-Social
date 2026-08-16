import { io } from "socket.io-client";

// End-to-end socket flow for Draw It:
//   create -> join x3 -> host:startDrawIt -> pick a word -> stream strokes ->
//   wrong guess reaches chat -> right guess is masked and scores -> reveal ->
//   nextRound -> ... -> final.
//
// Requires only the game server on :3001 — no API keys.
//
// The assertion that matters most is the one about leakage: a guesser must
// never receive the word, in any field, at any point before the reveal. That is
// the whole game, and it is the kind of thing that breaks silently.

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

/** A few strokes' worth of plausible scribble in 0..1000 space. */
const scribble = (seed) => [
  {
    color: seed % 8,
    width: seed % 2,
    points: [100 + seed, 100, 400, 300 + seed, 700, 200],
  },
  { color: 0, width: 1, points: [200, 700, 800, 720] },
];

const main = async () => {
  const [host, a, b, c] = await Promise.all([
    connect(),
    connect(),
    connect(),
    connect(),
  ]);
  const players = [
    { sock: a, name: "Ada" },
    { sock: b, name: "Ben" },
    { sock: c, name: "Cy" },
  ];

  // --- Leak watch --------------------------------------------------------
  //
  // Every state a guesser ever sees is checked against the word the drawer was
  // given. Armed as soon as the drawer learns it, disarmed at the reveal.
  let secret = null;
  const leaks = [];
  for (const { sock, name } of players) {
    sock.on("room:state", (state) => {
      const round = state.drawRound;
      if (!secret || !round || round.iAmDrawer) {
        return;
      }
      if (round.word !== undefined) {
        leaks.push(`${name} was sent word="${round.word}"`);
      }
      const blob = JSON.stringify(round).toLowerCase();
      if (blob.includes(secret.toLowerCase())) {
        leaks.push(`${name}'s round view contained "${secret}"`);
      }
    });
    sock.on("draw:chat", ({ line }) => {
      if (secret && line.text.toLowerCase().includes(secret.toLowerCase())) {
        leaks.push(`chat line carried "${secret}"`);
      }
    });
  }

  const created = await emit(host, "room:create", {
    name: "Screen",
    pin: "1111",
    visibility: "private",
  });
  const code = created.code;
  console.log("created room", code);
  for (const [i, player] of players.entries()) {
    // Take the id from the join ack rather than waiting for a snapshot to
    // arrive — the host's handler needs to resolve the drawer on the very first
    // broadcast, which lands before any player has seen their own state.
    const res = await emit(player.sock, "room:join", {
      code,
      name: player.name,
      pin: `222${i}`,
    });
    player.id = res.playerId;
  }
  console.log("joined:", players.map((p) => p.name).join(", "));

  const byId = new Map();
  host.on("room:state", (state) => {
    for (const p of state.players) {
      byId.set(p.id, p.name);
    }
  });

  let rounds = 0;
  let sawWrongGuessInChat = false;
  let sawMaskedSolve = false;
  let inkReceived = 0;

  // A non-drawer counts the ink it receives, proving strokes actually travel.
  a.on("draw:ink", ({ strokes }) => {
    inkReceived += strokes.length;
  });

  const done = new Promise((resolve, reject) => {
    host.on("room:state", async (state) => {
      try {
        if (state.phase === "picking") {
          const round = state.drawRound;
          const drawer = players.find((p) => p.id === round.drawerId);
          // The host is spectating, so the drawer is always one of the three.
          assert(drawer, "drawer wasn't one of the joined players");
          return;
        }
        if (state.phase === "reveal") {
          const r = state.drawReveal;
          assert(r.word, "reveal carried no word");
          assert(
            r.results.length === 3 - 1 || r.results.length === 2,
            `expected 2 guessers, got ${r.results.length}`
          );
          console.log(
            `  round ${r.index + 1}: "${r.word}" — ` +
              `${r.results.filter((x) => x.correct).length}/${r.results.length} got it, ` +
              `drawer +${r.drawerPoints}`
          );
          secret = null;
          rounds++;
          await sleep(120);
          await emit(host, "host:nextRound").catch(() => {});
        } else if (state.phase === "final") {
          resolve(state);
        }
      } catch (err) {
        reject(err);
      }
    });
    setTimeout(() => reject(new Error("timed out waiting for final")), 60_000);
  });

  // Each player drives their own turn: pick when it's yours, guess when it isn't.
  // Anything that throws in here would otherwise vanish into an unhandled
  // rejection and look exactly like the game hanging, so it's surfaced.
  const loud = (name, fn) => (state) =>
    Promise.resolve(fn(state)).catch((e) => {
      console.error(`FAILED in ${name}'s handler:`, e.message);
      process.exit(1);
    });

  for (const me of players) {
    me.sock.on("room:state", loud(me.name, async (state) => {
      const round = state.drawRound;
      if (process.env.DRAW_DEBUG) {
        console.log(
          `[${me.name}] phase=${state.phase} round=${!!round}` +
            (round ? ` drawer=${round.iAmDrawer} choices=${round.wordChoices?.length}` : "")
        );
      }
      if (!round) {
        return;
      }

      if (state.phase === "picking" && round.iAmDrawer && round.wordChoices) {
        assert(
          round.wordChoices.length === 3,
          `expected 3 choices, got ${round.wordChoices.length}`
        );
        const word = round.wordChoices[0];
        secret = word;
        await emit(me.sock, "draw:pickWord", { word });
        return;
      }

      if (state.phase !== "playing") {
        return;
      }

      if (round.iAmDrawer) {
        assert(round.word, "the drawer wasn't told the word");
        if (round.strokes.length === 0 && me.drewIn !== round.index) {
          me.drewIn = round.index;
          await emit(me.sock, "draw:ink", { strokes: scribble(1) });
          await emit(me.sock, "draw:ink", { strokes: scribble(2) });
          await emit(me.sock, "draw:undo");
        }
        return;
      }

      if (round.iGuessed || me.guessedIn === round.index) {
        return;
      }
      me.guessedIn = round.index;

      // A miss and then the answer, back to back. Real players type when they
      // like; this harness only wakes on state, and a wrong guess deliberately
      // doesn't produce one — so both go in a single pass.
      const wrong = await emit(me.sock, "draw:guess", {
        text: "definitely not it",
      });
      assert(!wrong.correct, "a wrong guess was accepted");
      assert(wrong.points === 0, "a wrong guess scored");

      // Typed sloppily on purpose — case and punctuation must not matter.
      const res = await emit(me.sock, "draw:guess", {
        text: `  ${secret.toUpperCase()}!  `,
      });
      assert(res.correct, `correct guess rejected for ${me.name}`);
      assert(res.points > 0, "a correct guess scored nothing");
    }));
  }

  // Chat observation, from a player's seat.
  b.on("draw:chat", ({ line }) => {
    if (!line.solved && line.text) {
      sawWrongGuessInChat = true;
    }
    if (line.solved) {
      sawMaskedSolve = true;
      assert(line.text === "", "a solved chat line carried text");
    }
  });

  await emit(host, "host:startDrawIt", {
    roundDurationSec: 60,
    hostPlaying: false,
    difficulty: "any",
  });
  console.log("draw it started");

  const finalState = await done;

  assert(leaks.length === 0, `word leaked to guessers:\n  ${leaks.join("\n  ")}`);
  assert(rounds === 3, `expected 3 rounds (one per player), got ${rounds}`);
  assert(inkReceived > 0, "no strokes reached the other players");
  assert(sawWrongGuessInChat, "a wrong guess never appeared in chat");
  assert(sawMaskedSolve, "a solve never appeared in chat");

  const ranking = finalState.final.ranking;
  assert(ranking.length === 3, `expected 3 competitors, got ${ranking.length}`);
  assert(
    !ranking.some((r) => r.playerId === finalState.hostId),
    "the spectating host landed on the scoreboard"
  );
  assert(
    ranking.every((r) => r.score > 0),
    "somebody who drew and guessed scored nothing"
  );

  console.log("FINAL RANKING:");
  for (const r of ranking) {
    console.log(`  ${byId.get(r.playerId) ?? r.playerId}: ${r.score}`);
  }
  console.log(`strokes received by a guesser: ${inkReceived}`);

  for (const s of [host, a, b, c]) {
    s.close();
  }
  console.log("DRAW IT SMOKE TEST PASSED");
  process.exit(0);
};

main().catch((e) => {
  console.error("DRAW IT SMOKE TEST FAILED:", e);
  process.exit(1);
});
