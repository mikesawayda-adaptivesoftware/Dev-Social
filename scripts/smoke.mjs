import { io } from "socket.io-client";

const URL = "http://localhost:3001";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
    const s = io(URL, { transports: ["websocket"] });
    s.on("connect", () => resolve(s));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const [a, b, c] = await Promise.all([connect(), connect(), connect()]);
  const ids = {};

  // Track latest personalized state per client; auto-guess as players.
  for (const [label, sock] of [
    ["A", a],
    ["B", b],
    ["C", c],
  ]) {
    sock.on("room:state", (state) => {
      if (state.phase === "playing" && state.round) {
        const r = state.round;
        if (!r.iAmOwner && !r.myGuess) {
          sock.emit("guess:submit", { choiceId: r.optionIds[0] }, () => {});
        }
      }
    });
    sock._label = label;
  }

  const created = await emit(a, "room:create", { name: "Alice", pin: "1111" });
  ids.a = created.playerId;
  const code = created.code;
  console.log("created room", code);

  const jb = await emit(b, "room:join", { code, name: "Bob", pin: "2222" });
  const jc = await emit(c, "room:join", { code, name: "Cara", pin: "3333" });
  ids.b = jb.playerId;
  ids.c = jc.playerId;
  console.log("joined: Bob, Cara");

  await emit(a, "host:startSubmission");
  await emit(a, "photo:submit", { dataUrl: PNG });
  await emit(b, "photo:submit", { dataUrl: PNG });
  await emit(c, "photo:submit", { dataUrl: PNG });
  console.log("submitted 3 photos");

  // Host drives the rounds: advance whenever we hit reveal; finish on final.
  const done = new Promise((resolve) => {
    a.on("room:state", async (state) => {
      if (state.phase === "reveal") {
        await sleep(150);
        await emit(a, "host:nextRound").catch(() => {});
      } else if (state.phase === "final") {
        resolve(state);
      }
    });
  });

  await emit(a, "host:startGame");
  console.log("game started");

  const finalState = await done;
  console.log("FINAL RANKING:");
  for (const r of finalState.final.ranking) {
    const p = finalState.players.find((x) => x.id === r.playerId);
    console.log(`  ${p.name}: ${r.score}`);
  }

  a.close();
  b.close();
  c.close();
  console.log("SMOKE TEST PASSED");
  process.exit(0);
};

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e);
  process.exit(1);
});
