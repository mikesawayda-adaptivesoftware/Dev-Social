import { io } from "socket.io-client";

// End-to-end socket flow for the Real GeoGuessr game:
//   create -> join -> host:startGeoGame -> geo:guess (per player) ->
//   reveal -> nextRound (host) -> ... -> final.
//
// Requires the game server running on :3001 AND a Google Maps key configured
// server-side (GOOGLE_MAPS_API_KEY or an unrestricted NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
// so panorama ids can be resolved. Without a key the test SKIPS gracefully.

const URL = "http://localhost:3001";

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

// Deterministic-ish guesses somewhere in Europe so distances are finite.
const GUESSES = [
  { lat: 48.85, lng: 2.35 },
  { lat: 51.5, lng: -0.12 },
];

const main = async () => {
  const [a, b, c] = await Promise.all([connect(), connect(), connect()]);

  // b and c are the guessing players (a is host / big screen).
  b.on("room:state", (state) => {
    if (state.phase === "playing" && state.geoRound && !state.geoRound.iGuessed) {
      b.emit("geo:guess", GUESSES[0], () => {});
    }
  });
  c.on("room:state", (state) => {
    if (state.phase === "playing" && state.geoRound && !state.geoRound.iGuessed) {
      c.emit("geo:guess", GUESSES[1], () => {});
    }
  });

  const created = await emit(a, "room:create", { name: "Alice", pin: "1111" });
  const code = created.code;
  console.log("created room", code);

  await emit(b, "room:join", { code, name: "Bob", pin: "2222" });
  await emit(c, "room:join", { code, name: "Cara", pin: "3333" });
  console.log("joined: Bob, Cara");

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

  try {
    await emit(a, "host:startGeoGame", { roundDurationSec: 60, hostPlaying: false });
  } catch (err) {
    if (/Street View|Google Maps API key/i.test(err.message)) {
      console.log(`SKIPPED: ${err.message}`);
      a.close();
      b.close();
      c.close();
      process.exit(0);
    }
    throw err;
  }
  console.log("geo game started");

  const finalState = await done;
  console.log("FINAL RANKING:");
  for (const r of finalState.final.ranking) {
    const p = finalState.players.find((x) => x.id === r.playerId);
    console.log(`  ${p.name}: ${r.score}`);
  }

  a.close();
  b.close();
  c.close();
  console.log("GEO SMOKE TEST PASSED");
  process.exit(0);
};

main().catch((e) => {
  console.error("GEO SMOKE TEST FAILED:", e);
  process.exit(1);
});
