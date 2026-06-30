import { io } from "socket.io-client";

const URL = "http://localhost:3001";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const emit = (sock, event, payload) =>
  new Promise((resolve, reject) => {
    const cb = (res) =>
      res?.ok ? resolve(res) : reject(new Error(res?.error ?? "no ack"));
    if (payload === undefined) sock.emit(event, cb);
    else sock.emit(event, payload, cb);
  });
const connect = () =>
  new Promise((resolve) => {
    const s = io(URL, { transports: ["websocket"] });
    s.on("connect", () => resolve(s));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  // 2 players: a non-owner can always deduce the owner is the other player.
  const [a, b] = await Promise.all([connect(), connect()]);
  const me = {};

  const created = await emit(a, "room:create", { name: "Alice" });
  me[a.id] = created.playerId;
  const code = created.code;
  const jb = await emit(b, "room:join", { code, name: "Bob" });
  me[b.id] = jb.playerId;

  for (const sock of [a, b]) {
    sock.on("room:state", (state) => {
      if (state.phase === "playing" && state.round && !state.round.iAmOwner && !state.round.myGuess) {
        // With 2 players, the correct answer is the option that isn't me.
        const myId = me[sock.id];
        const correct = state.round.optionIds.find((id) => id !== myId);
        sock.emit("guess:submit", { choiceId: correct }, () => {});
      }
    });
  }

  await emit(a, "host:startSubmission");
  await emit(a, "photo:submit", { dataUrl: PNG });
  await emit(b, "photo:submit", { dataUrl: PNG });

  const done = new Promise((resolve) => {
    a.on("room:state", async (state) => {
      if (state.phase === "reveal") {
        await sleep(120);
        await emit(a, "host:nextRound").catch(() => {});
      } else if (state.phase === "final") resolve(state);
    });
  });

  await emit(a, "host:startGame");
  const finalState = await done;
  const total = finalState.final.ranking.reduce((s, r) => s + r.score, 0);
  console.log("ranking:", finalState.final.ranking.map((r) => {
    const p = finalState.players.find((x) => x.id === r.playerId);
    return `${p.name}=${r.score}`;
  }).join(", "));

  a.close();
  b.close();
  if (total > 0) {
    console.log("SCORING TEST PASSED (points awarded for correct guesses)");
    process.exit(0);
  } else {
    console.error("SCORING TEST FAILED (expected points > 0)");
    process.exit(1);
  }
};

main().catch((e) => {
  console.error("SCORING TEST FAILED:", e);
  process.exit(1);
});
