import { readFileSync } from "node:fs";
import { io } from "socket.io-client";

// End-to-end socket flow for the Word Chain game:
//   create -> join -> host:startWordChain -> word:hint + word:guess (per
//   player) -> reveal -> nextRound (host) -> final.
//
// Requires only the game server running on :3001 — no external API keys, so
// unlike the GeoGuessr smoke test this one never skips.
//
// The answers live on the server and are never sent to a client until the
// reveal, which is the point. So the test reads the seeded bank straight off
// disk and looks up whichever puzzle the server dealt.

// Not named `URL` — that would shadow the global constructor used below.
const SERVER_URL = "http://localhost:3001";
const BANK = "server/wordChains.ts";

/** The puzzle bank, read out of the TypeScript source as plain data. */
const loadPuzzles = () => {
  const src = readFileSync(new URL(`../${BANK}`, import.meta.url), "utf8");
  const puzzles = new Map();
  // Tolerates fields after the word list (difficulty, and whatever comes next)
  // so a new column in the bank doesn't quietly make this test parse nothing.
  for (const [, id, list] of src.matchAll(
    /\{\s*id:\s*"([^"]+)",\s*words:\s*\[([^\]]+)\][^}]*\}/g
  )) {
    puzzles.set(
      id,
      [...list.matchAll(/"([A-Z]+)"/g)].map((m) => m[1])
    );
  }
  return puzzles;
};

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

/** Start a solo game with the given options and return its first round view. */
const dealOne = async (name, options) => {
  const sock = await connect();
  const dealt = new Promise((resolve) => {
    sock.on("room:state", (state) => {
      if (state.wordRound) {
        resolve(state.wordRound);
      }
    });
  });
  await emit(sock, "room:create", { name, pin: "7777", visibility: "private" });
  await emit(sock, "host:startWordChain", {
    durationSec: 60,
    hostPlaying: true,
    difficulty: "any",
    length: 6,
    ...options,
  });
  const round = await dealt;
  sock.close();
  return round;
};

/** The host's difficulty choice must actually decide which chain is dealt. */
const checkDifficultyFilter = async (tier) => {
  const round = await dealOne(`Solo${tier}`, { difficulty: tier });
  assert(
    round.difficulty === tier,
    `asked for a ${tier} chain, was dealt a ${round.difficulty} one`
  );
  console.log(`  difficulty "${tier}" honoured`);
};

/**
 * Every length must be dealt as asked and be worth the same, or the season
 * leaderboard would reward whoever picked the longest chain.
 */
const checkLength = async (words) => {
  const round = await dealOne(`Len${words}`, { length: words });
  const blanks = round.blanks.length;
  assert(
    blanks === words - 2,
    `asked for a ${words}-word chain, got one with ${blanks} blanks`
  );
  // A link is worth the pot divided by however many blanks there are, so the
  // hint (a fifth of a link) is the visible proof the split happened.
  const expectedHint = Math.round((2000 / blanks) * 0.2);
  assert(
    round.hintCost === expectedHint,
    `${words}-word chain: hint costs ${round.hintCost}, expected ${expectedHint}`
  );
  console.log(
    `  length ${words} honoured — ${blanks} blanks, hint ${round.hintCost} pts`
  );
  return blanks;
};

const main = async () => {
  const puzzles = loadPuzzles();
  assert(puzzles.size > 0, `no puzzles parsed out of ${BANK}`);
  console.log(`loaded ${puzzles.size} puzzles`);

  for (const tier of ["easy", "normal", "hard"]) {
    await checkDifficultyFilter(tier);
  }
  const blankCounts = [];
  for (const words of [5, 6, 8, 12, 17]) {
    blankCounts.push(await checkLength(words));
  }
  assert(
    new Set(blankCounts).size === blankCounts.length,
    "the three lengths didn't produce three different blank counts"
  );

  const [a, b, c] = await Promise.all([connect(), connect(), connect()]);

  // b and c solve; a hosts the big screen and doesn't play.
  //
  // Every correct answer earns the solver a fresh snapshot, so answering off
  // `room:state` walks the chain on its own. Re-sends are harmless: the server
  // ignores a guess whose index isn't the blank that player is actually on.
  const solver = (
    sock,
    name,
    { hintFirst = false, missFirst = false, slowMs = 0, fromBack = false } = {}
  ) => {
    let hinted = false;
    let missed = false;
    // Blanks already answered. A hint also earns a snapshot, so without this
    // the handler could re-enter on a stale view and answer one twice.
    const answered = new Set();
    sock.on("room:state", async (state) => {
      const word = state.wordRound;
      if (state.phase !== "playing" || !word || word.finished) {
        return;
      }
      // Answer the far end when asked to, so the run exercises solving upward
      // from the last word as well as downward from the first.
      const index = fromBack
        ? word.activeIndexes[word.activeIndexes.length - 1]
        : word.activeIndexes[0];
      if (index === undefined || answered.has(index)) {
        return;
      }
      answered.add(index);
      const answers = puzzles.get(word.puzzleId);
      assert(answers, `server dealt unknown puzzle ${word.puzzleId}`);
      assert(
        word.blanks.length === answers.length - 2,
        `expected ${answers.length - 2} blanks, got ${word.blanks.length}`
      );
      assert(
        word.activeIndexes.length >= 1 && word.activeIndexes.length <= 2,
        `expected 1 or 2 open blanks, got ${word.activeIndexes.length}`
      );
      // The answers must not be reachable from the client's own view.
      for (const [i, blank] of word.blanks.entries()) {
        if (!blank.solvedWord) {
          assert(
            blank.revealed.length < blank.length,
            `blank ${i} leaked its whole answer to ${name}`
          );
        }
      }

      const solvedBefore = word.blanks.filter((b) => b.solvedWord).length;

      if (missFirst && !missed) {
        missed = true;
        const res = await emit(sock, "word:guess", { index, guess: "NOTAWORD" });
        assert(!res.correct, "a wrong answer was accepted");
        assert(res.solved === solvedBefore, "a wrong answer scored a link");
        console.log(`  ${name}: wrong answer correctly rejected`);
      }
      if (hintFirst && !hinted) {
        hinted = true;
        const hint = await emit(sock, "word:hint", { index });
        const answer = answers[index + 1];
        assert(hint.index === index, "hint came back for the wrong blank");
        assert(
          answer.startsWith(hint.revealed),
          `hint "${hint.revealed}" doesn't prefix ${answer}`
        );
        assert(
          hint.revealed.length < answer.length,
          "a hint gave away the whole word"
        );
        console.log(`  ${name}: hint revealed "${hint.revealed}"`);
      }

      if (slowMs) {
        await sleep(slowMs);
      }
      const res = await emit(sock, "word:guess", {
        index,
        guess: answers[index + 1].toLowerCase(), // case shouldn't matter
      });
      assert(res.correct, `correct answer rejected for ${name}`);
    });
  };

  // Bob races ahead from the top; Cara dawdles and works up from the bottom, so
  // one run covers both directions. The gap between them is the point too —
  // it's what puts Bob in the "finished, waiting on everyone else" state.
  solver(b, "Bob", { hintFirst: true });
  solver(c, "Cara", { missFirst: true, slowMs: 350, fromBack: true });

  // Bob should sit in a finished-but-still-playing state rather than the round
  // ending under Cara.
  let bobWaited = false;
  b.on("room:state", (state) => {
    if (state.phase === "playing" && state.wordRound?.finished) {
      bobWaited = true;
    }
  });
  // …and Cara should be told he's done, over the standings delta rather than a
  // whole fresh snapshot.
  let caraSawBobFinish = false;
  c.on("chain:standing", (standing) => {
    if (standing.finished) {
      caraSawBobFinish = true;
    }
  });

  const created = await emit(a, "room:create", {
    name: "Alice",
    pin: "1111",
    visibility: "private",
  });
  const code = created.code;
  console.log("created room", code);

  await emit(b, "room:join", { code, name: "Bob", pin: "2222" });
  await emit(c, "room:join", { code, name: "Cara", pin: "3333" });
  console.log("joined: Bob, Cara");

  const done = new Promise((resolve, reject) => {
    a.on("room:state", async (state) => {
      if (state.phase === "reveal") {
        assert(state.wordReveal, "reveal phase carried no wordReveal");
        console.log("CHAIN:", state.wordReveal.words.join(" · "));
        await sleep(150);
        await emit(a, "host:nextRound").catch(() => {});
      } else if (state.phase === "final") {
        resolve(state);
      }
    });
    setTimeout(() => reject(new Error("timed out waiting for final")), 30_000);
  });

  // The long chain, so the full-game path runs against the most blanks and the
  // most awkward points division rather than the tidy four-blank case.
  await emit(a, "host:startWordChain", {
    durationSec: 60,
    hostPlaying: false,
    difficulty: "any",
    length: 8,
  });
  console.log("word chain started");

  const finalState = await done;
  const ranking = finalState.final.ranking;
  assert(ranking.length === 2, `expected 2 competitors, got ${ranking.length}`);
  assert(
    ranking.every((r) => r.score > 0),
    "a player who solved the whole chain scored nothing"
  );
  assert(
    !ranking.some((r) => r.playerId === finalState.hostId),
    "the non-playing host landed on the scoreboard"
  );
  assert(bobWaited, "the first finisher never saw the waiting state");
  assert(caraSawBobFinish, "nobody was told the first finisher was done");

  console.log("FINAL RANKING:");
  for (const r of ranking) {
    const p = finalState.players.find((x) => x.id === r.playerId);
    console.log(`  ${p.name}: ${r.score}`);
  }

  a.close();
  b.close();
  c.close();
  console.log("WORD CHAIN SMOKE TEST PASSED");
  process.exit(0);
};

main().catch((e) => {
  console.error("WORD CHAIN SMOKE TEST FAILED:", e);
  process.exit(1);
});
