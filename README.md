# Dev Social — Team Happy Hour Games

A live, Jackbox-style party-game platform for monthly team happy hours. The host
opens a room on the big screen, everyone joins from their phone with a 4-letter
code, and you play together in real time.

The first game is **Photo Guessr**: everyone submits a baby photo (or any
guess-worthy pic), then the room competes to match each photo to the right
teammate — points for correct guesses, bonus points for speed.

It's built as a **reusable platform first, game second** — so adding next
month's game is mostly about writing a new state machine, not rebuilding rooms,
lobbies, scoring, and realtime sync.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values (optional)
npm run dev
```

> Supabase is optional for local play — without it the app runs fully in-memory.
> See [Supabase setup](#supabase-persistence--storage) to enable the season
> leaderboard, game history, and photo storage.

This starts two processes together:

- **Next.js app** → http://localhost:3000 (the UI)
- **Realtime game server** (Socket.IO) → http://localhost:3001 (rooms + game state)

Open http://localhost:3000, click **Host a game**, and share the room code (or
the join URL) with everyone. On the same Wi-Fi, teammates can join from their
phones using your machine's network URL (printed by Next as `Network:`), e.g.
`http://192.168.x.x:3000/join`.

> If phones connect to the UI but can't reach the game server, set
> `NEXT_PUBLIC_GAME_SERVER_URL` to your machine's LAN address, e.g.
> `NEXT_PUBLIC_GAME_SERVER_URL=http://192.168.0.15:3001 npm run dev`.

## How to play (Photo Guessr)

1. **Host** creates a room → big screen shows the 4-letter code.
2. Everyone **joins** from their phone with the code + their name.
3. Host starts → **submission phase**: each person uploads a photo from their
   phone (images are downscaled client-side before sending).
4. Host starts the game → one **round per photo**: the photo shows on every
   screen, players tap who they think it is. Faster correct answers score more.
5. **Reveal** after each round (the answer + who nailed it + live scoreboard).
6. **Final** standings with a champion + confetti. Host can **Play again**.

## Architecture

```
src/
  app/
    page.tsx              # Landing: host a game / join
    join/page.tsx         # Join by code
    room/[code]/page.tsx  # The room — switches UI by game phase
  components/
    GameProvider.tsx      # Socket connection + React context + actions
    game/                 # One component per phase: Lobby, Submission,
                          #   Playing, Reveal, Final (+ shared widgets)
    ui.tsx, Confetti.tsx
  lib/
    socket.ts             # Socket.IO client singleton + persisted identity
    image.ts              # Client-side image downscaling
    useCountdown.ts       # Round timer hook
  shared/
    types.ts              # Types + event contracts shared by client & server
server/
  index.ts                # Socket.IO server: wires events -> RoomStore
  rooms.ts                # RoomStore: in-memory rooms + Photo Guessr state machine
scripts/
  smoke.mjs, smoke2.mjs   # End-to-end socket tests (node scripts/smoke.mjs)
```

**Realtime model.** The server keeps authoritative room state in memory and
pushes a *personalized, role-aware* view to each player on every change
(`room:state`). Clients are thin: they render whatever view they're handed and
emit intent events (`guess:submit`, `host:nextRound`, …). Answers and other
players' choices are hidden from the view until the reveal phase.

**Reconnects.** Each player's `{ code, playerId }` is stored in `localStorage`,
so a refresh or dropped connection automatically rejoins their seat.

## Adding a new game next month

The platform pieces — rooms, join-by-code, players, connection handling,
scoring, leaderboard, confetti — are game-agnostic. To add a game:

1. Add its phases/payloads to `src/shared/types.ts` (or generalize `RoomState`
   into a per-game `gameState` blob).
2. Add a state machine in `server/` alongside `RoomStore` (round generation,
   scoring, `viewFor` sanitization).
3. Add phase components under `src/components/game/` and route them in
   `src/app/room/[code]/page.tsx`.

Because Photo Guessr is really a "show content → everyone guesses → reveal →
score" engine, many games (movie trivia, "who said it", higher/lower, geo
guessing) can reuse the same shape with a different content source.

## Supabase (persistence + storage)

The app uses a **hybrid** architecture: the Socket.IO server stays the real-time
"brain" (it runs the round timer and hides answers until reveal), while Supabase
is the **system of record**.

What's wired up:

- **Game history + season leaderboard** — every finished game and its player
  scores are written to the `games` / `game_players` tables. The
  `season_leaderboard` view aggregates all-time points by player name, surfaced
  at `/leaderboard`.
- **Photo Storage** — submitted photos upload to the `photos` Storage bucket and
  are served by URL (instead of living in server memory).
- **Security** — the browser uses the publishable key with **RLS** allowing
  read-only access. All writes happen on the server with the `service_role` key,
  which never touches the client bundle.
- **Graceful fallback** — with no Supabase credentials the app runs fully
  in-memory (local mode); persistence/storage just switch off.

### Finish the setup (one step)

`.env.local` already has the project URL and publishable key. Add your
**`service_role`** secret so the server can persist games and upload photos:

1. Supabase Dashboard → Project Settings → **API keys** → copy `service_role`.
2. Paste it into `.env.local` as `SUPABASE_SERVICE_ROLE_KEY=...`.
3. Restart `npm run dev`. The game server should log
   `✓ Supabase connected`.

> Keep `service_role` secret — it bypasses RLS. It only lives in `.env.local`
> (gitignored) and is read by the server, never the browser.

The schema was created via migrations (`games`, `game_players`,
`season_leaderboard`, and the `photos` Storage bucket).

### Going fully Supabase-native (optional, later)

To drop the Node server entirely, move authoritative game logic into Postgres
RPC functions + RLS and use **Supabase Realtime** channels for broadcasts. The
client's `GameProvider` API (actions + a `room:state` stream) is intentionally
isolated, so the UI components wouldn't need to change.

## Deploy (Docker + Unraid + nginx)

Dev Social ships as a **single container** running both processes — the Next.js
app (`:3000`) and the Socket.IO game server (`:3001`) — with hosted Supabase as
the system of record. No code changes are needed; it's the same `npm start` you
run locally.

### Build-time vs. run-time config (read this first)

Three values are **`NEXT_PUBLIC_*`**, which Next.js **inlines into the browser
bundle at build time** — so they must be passed as Docker **build args**, not
runtime `-e` vars. They're public/non-secret:

| Value                          | Set as       | Where                       |
| ------------------------------ | ------------ | --------------------------- |
| `NEXT_PUBLIC_GAME_SERVER_URL`  | build arg    | your public origin          |
| `NEXT_PUBLIC_SUPABASE_URL`     | build arg    | Supabase project URL        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| build arg    | Supabase publishable key    |
| `GAME_CLIENT_ORIGIN`           | runtime `-e` | locks the socket server CORS|
| `SUPABASE_URL`                 | runtime `-e` | Supabase project URL        |
| `SUPABASE_SERVICE_ROLE_KEY`    | runtime `-e` | **secret** (see below)      |

If you build without `NEXT_PUBLIC_GAME_SERVER_URL` set to your real origin, the
deployed site tries to open the socket against `localhost:3001` and fails for
everyone. `docker-compose.yml` and `deploy.sh` already set these build args.

### The `service_role` secret

The server uses Supabase's `service_role` key for all writes + photo uploads. It
**bypasses RLS**, so it must stay server-side — never in the browser, never
committed.

- It already lives in `.env.local` (`SUPABASE_SERVICE_ROLE_KEY=...`).
- From the dashboard: **Project Settings → API Keys → `service_role`** (listed
  as `secret`; under "Legacy API keys" in the current UI). A newer `sb_secret_…`
  key works too.

Put it in a `.env` file next to `docker-compose.yml` (gitignored) so compose and
`deploy.sh` can read it:

```bash
cp .env.docker.example .env   # then paste the service_role key
```

> Without it, the app still runs — just fully in-memory (no persistence/storage).

### Option A — run on this host (docker compose)

Build the image locally and run both processes:

```bash
docker compose up -d --build
```

### Option B — publish to Docker Hub, run on Unraid (`deploy.sh`)

For a build-on-your-Mac, run-on-Unraid flow, use the included `deploy.sh`. It
builds a **`linux/amd64`** image (Unraid's arch — a plain `docker compose build`
on Apple Silicon would produce an arm64 image that won't run there), pushes it to
Docker Hub, and prints the Unraid `docker run` command.

```bash
# one-time setup
export DOCKERHUB_TOKEN='...'        # hub.docker.com -> Account Settings -> Personal access tokens
# edit DOCKERHUB_USERNAME at the top of deploy.sh

./deploy.sh                  # build (linux/amd64) + push to Docker Hub
./deploy.sh "commit message" # git commit/push first (if REPO_URL set), then build + push
./deploy.sh --local          # build & run locally via docker compose
```

The printed `docker run` maps both ports and injects the runtime env (incl. the
`service_role` from your `.env`):

```bash
docker run -d --name dev-social --restart unless-stopped \
  -p 3000:3000 -p 3001:3001 \
  -e NODE_ENV=production \
  -e GAME_CLIENT_ORIGIN='https://devsocial.adaptivesoftware.co' \
  -e SUPABASE_URL='https://YOUR-PROJECT.supabase.co' \
  -e SUPABASE_SERVICE_ROLE_KEY='your-service-role-key' \
  docker.io/<your-user>/dev-social:latest
```

### Put it behind nginx

Route one public origin to the two ports — the `/socket.io/` location (with
WebSocket upgrade headers) must come *before* `/`:

```nginx
server {
    listen 443 ssl;
    server_name devsocial.adaptivesoftware.co;
    # ssl_certificate ... (Cloudflare Origin cert or Let's Encrypt)

    location /socket.io/ {              # realtime -> game server
        proxy_pass http://UNRAID_HOST:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location / {                        # app -> Next.js
        proxy_pass http://UNRAID_HOST:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

WebSockets pass through Cloudflare's proxy automatically (the 100s proxy timeout
doesn't apply to them). `GAME_CLIENT_ORIGIN` in compose locks the realtime
server's CORS to your origin.

> The schema for the hosted Supabase project lives in `supabase/migrations/`.
> Apply it with the Supabase CLI (`supabase db push`) or the dashboard SQL editor
> before first run.

## Scripts

| Command            | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `npm run dev`      | Next app + realtime server (hot reload)        |
| `npm run build`    | Production build + type check                  |
| `npm start`        | Run the production app + realtime server       |
| `node scripts/smoke.mjs`  | End-to-end flow test against `:3001`    |
| `node scripts/smoke2.mjs` | Deterministic scoring test              |
| `./deploy.sh`      | Build `linux/amd64` image + push to Docker Hub |
| `./deploy.sh --local` | Build & run locally via docker compose      |

## Tech

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Socket.IO · tsx · concurrently
