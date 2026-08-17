import { io } from "socket.io-client";

// The bits every smoke test needs. The older scripts (smoke.mjs, smokeGeo.mjs,
// smokeWordChain.mjs, smokeDrawIt.mjs) each carry their own copy; the session
// tests share this one rather than adding four more.

export const SERVER_URL = "http://localhost:3001";

/** Emit and wait for the ack, rejecting on `{ ok: false }`. */
export const emit = (sock, event, payload) =>
  new Promise((resolve, reject) => {
    const cb = (res) =>
      res?.ok ? resolve(res) : reject(new Error(res?.error ?? "no ack"));
    if (payload === undefined) {
      sock.emit(event, cb);
    } else {
      sock.emit(event, payload, cb);
    }
  });

export const connect = () =>
  new Promise((resolve) => {
    const s = io(SERVER_URL, { transports: ["websocket"] });
    s.on("connect", () => resolve(s));
  });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const assert = (cond, message) => {
  if (!cond) {
    throw new Error(message);
  }
};

/**
 * Assert an emit is rejected. Never write this as
 * `.then(() => assert(false)).catch(() => {})` — the catch swallows the assert
 * too, so a call that wrongly *succeeds* passes silently.
 */
export const expectFail = async (promise, pattern, message) => {
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
 * Keeps a socket's latest snapshot, applying the roster deltas the real client
 * applies. Without the join delta a host's view stays stuck at "one player",
 * since a join only sends the newcomer a full snapshot.
 *
 * Attach this before anything happens — snapshots are pushed, so a listener
 * added later simply misses them.
 */
export const watchState = (sock) => {
  const view = { state: null };
  sock.on("room:state", (s) => {
    view.state = s;
  });
  sock.on("room:playerJoined", ({ player }) => {
    if (view.state && !view.state.players.some((p) => p.id === player.id)) {
      view.state.players.push(player);
    }
  });
  sock.on("room:playerConnection", ({ playerId, connected }) => {
    const p = view.state?.players.find((x) => x.id === playerId);
    if (p) {
      p.connected = connected;
    }
  });
  return view;
};

/** Poll until `check(view.state)` holds, or fail with `message`. */
export const waitFor = async (view, check, message, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (view.state && check(view.state)) {
      return view.state;
    }
    await sleep(100);
  }
  throw new Error(
    `${message} (last phase: ${view.state?.phase ?? "no snapshot"})`
  );
};

/** Wrap a smoke test's `main` so failures are loud and the process always exits. */
export const run = (label, main) => {
  main()
    .then(() => {
      console.log(`${label} PASSED`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`${label} FAILED:`, e);
      process.exit(1);
    });
};
