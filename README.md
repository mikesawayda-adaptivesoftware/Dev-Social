# Dev Social — Team Happy Hour Games

A live, Jackbox-style party-game platform for monthly team happy hours. The host
opens a room on the big screen, everyone joins from their phone with a 4-letter
code, and you play together in real time.

Two games ship today:

- **Photo Guessr** — everyone submits a baby photo (or any guess-worthy pic),
  then the room competes to match each photo to the right teammate. Points for
  correct guesses, bonus points for speed.
- **Real GeoGuessr** — each player is dropped into an interactive Street View on
  their phone, explores, and drops a pin on a world map. You score by how close
  your pin is to the true location. (Needs a Google Maps API key — see
  [Google Maps setup](#google-maps-setup-for-real-geoguessr).)

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

## How to play (Real GeoGuessr)

1. **Host** creates a room and, in the lobby, picks **Real GeoGuessr**, the time
   per location (60 / 90 / 120s), and whether they're **playing too** or just
   running the big screen.
2. Everyone **joins** from their phone with the code + their name.
3. Host starts → each round drops **every player into the same Street View**
   location, which they explore independently on their phone.
4. Players pan/move around, then **drop a pin** on the world map and lock it in.
   Closer pins score more (up to 5,000 points per location, decaying with
   distance).
5. **Reveal** shows the true location and everyone's pins on a map, with
   per-round distances + points and the live scoreboard.
6. After 5 locations, **Final** standings + confetti. Host can return to the
   lobby to pick another game.

> By default the host runs the big screen and doesn't guess (and stays off the
> scoreboard entirely). Toggle **"I'm playing too"** in the lobby to have the
> host guess from their device and appear in the standings. All players in a
> game get the same 5 locations, drawn once when the game starts.

## Google Maps setup (for Real GeoGuessr)

Real GeoGuessr renders Google Street View + an interactive map in the browser,
so it needs a **Maps JavaScript API** key. Photo Guessr and the rest of the app
work without it.

1. Create a project at <https://console.cloud.google.com> and **enable billing**
   (Maps has a recurring monthly free allotment; low-volume happy-hour play is
   typically free). Set a **budget alert** (Billing → Budgets & alerts) so there
   are no surprises.
2. **APIs & Services → Library** → enable **Maps JavaScript API** (this includes
   Street View rendering).
3. **APIs & Services → Credentials → Create credentials → API key**. Edit the
   key:
   - **Application restrictions → HTTP referrers (web sites)** and add your
     origins, e.g. `http://localhost:3000/*` and `https://your-domain/*`.
   - **API restrictions → Restrict key → Maps JavaScript API**.
4. Put the key in `.env.local` as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...`, then
   restart `npm run dev`.

### Where do the locations come from?

The pool of worldwide locations lives in
[`server/geoLocations.ts`](server/geoLocations.ts). Each is a `{ lat, lng, label }`
that resolves to a Street View **panorama id** — the server only ever sends the
`panoId` to the browser (never the answer coordinates) until the reveal, so the
location is hidden while you play.

Panorama ids are resolved automatically at game start via the free Street View
metadata API. For that server-side call you need a key **without** an HTTP
referrer restriction — either a dedicated `GOOGLE_MAPS_API_KEY`, or an
unrestricted browser key. To avoid any runtime lookups (and allow a
referrer-restricted-only key), pre-bake the ids once:

```bash
GOOGLE_MAPS_API_KEY=... npx tsx scripts/resolvePanos.ts
# paste the printed array back into server/geoLocations.ts
```

Add or edit locations by dropping new `{ lat, lng, label }` entries into the
pool. Aim for spots you'd recognize with good Street View coverage.

**Fewer repeats across games.** Within a single game no location is ever
repeated. Across games, the server also remembers which locations each player
(by their claimed name) has already seen and **soft-prefers spots the current
players haven't seen yet** — it ranks the pool by how many players in the room
have seen each location and picks the least-seen first (random tie-break). This
never blocks a game: once everyone has seen everything, it just falls back to the
least-recently-common locations. History is stored in the `player_locations_seen`
table and only kicks in when Supabase is configured.

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
      geo/                # Real GeoGuessr: StreetViewPano, GuessMap,
                          #   GeoPlaying, GeoReveal
    ui.tsx, Confetti.tsx
  lib/
    socket.ts             # Socket.IO client singleton + persisted identity
    image.ts              # Client-side image downscaling
    useCountdown.ts       # Round timer hook
    googleMaps.ts         # Maps JS API loader (singleton)
  shared/
    types.ts              # Types + event contracts shared by client & server
server/
  index.ts                # Socket.IO server: wires events -> RoomStore
  rooms.ts                # RoomStore: in-memory rooms + game state machines
  geoLocations.ts         # Curated GeoGuessr pool + panorama resolver
scripts/
  smoke.mjs, smoke2.mjs   # End-to-end socket tests (node scripts/smoke.mjs)
  smokeGeo.mjs            # GeoGuessr socket flow test
  resolvePanos.ts         # Bake Street View panorama ids into the pool
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
  `season_leaderboard` and `season_leaderboard_by_type` views aggregate all-time
  standings (overall and per game type, with per-user averages + high scores),
  surfaced at `/leaderboard` with an overall tab, per-game tabs, and an
  expandable per-game results history.
- **Name + PIN identity ("claim the name")** — to keep the leaderboard honest,
  each player name is protected by a PIN. The first person to use a name claims
  it by setting a 4–6 digit PIN (stored as a scrypt hash in the `players` table);
  anyone else using that name must enter the matching PIN or pick another name.
  The host/join forms show a live "new name / taken" hint as you type (via a
  `name:check` event that returns only a boolean, never the PIN). In local mode
  (no Supabase) PIN enforcement is skipped, since there's no leaderboard to
  protect.
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

> **Applying new migrations.** The richer leaderboard views
> (`supabase/migrations/0003_leaderboard_views.sql`), the name+PIN identity
> table (`supabase/migrations/0004_players_identity.sql`), and the per-player
> GeoGuessr location history (`supabase/migrations/0005_player_locations_seen.sql`)
> have already been applied to the hosted project (via the Supabase MCP
> `apply_migration`). To apply them to a fresh project, run `supabase db push`,
> paste their contents into the Supabase Dashboard → **SQL editor**, or use the
> Supabase MCP. Until `0003` is applied the `/leaderboard` page errors on the
> missing `season_leaderboard_by_type` view; until `0004` is applied,
> hosting/joining a Supabase-backed server fails on the missing `players` table;
> `0005` is optional (location dedup silently no-ops without it).

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
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | build arg | GeoGuessr Street View + map (optional) |
| `GAME_CLIENT_ORIGIN`           | runtime `-e` | locks the socket server CORS|
| `GOOGLE_MAPS_API_KEY`          | runtime `-e` | GeoGuessr pano resolution (optional, unrestricted) |
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

### Option B — publish to ghcr.io, run on Unraid (`deploy.sh`)

For a build-on-your-Mac, run-on-Unraid flow, use the included `deploy.sh`. It
builds a **`linux/amd64`** image (Unraid's arch — a plain `docker compose build`
on Apple Silicon would produce an arm64 image that won't run there), pushes it to
the **GitHub Container Registry** (`ghcr.io`), and prints the Unraid setup +
`docker run` commands.

```bash
# one-time setup
export GITHUB_CR_PAT='ghp_...'   # GitHub PAT with write:packages + read:packages
                                 #   https://github.com/settings/tokens

./deploy.sh                  # build (linux/amd64) + push to ghcr.io
./deploy.sh "commit message" # git commit/push to GitHub first, then build + push
./deploy.sh --local          # build & run locally via docker compose
```

The image is `ghcr.io/mikesawayda-adaptivesoftware/dev-social:latest`. Public
config (origin, Supabase URL/anon key, optional Maps key) is set at the top of
`deploy.sh` and baked in as build args; the `service_role` secret is read from
`.env` and injected at run time only.

> **Make the ghcr package public** (one-time) so Unraid can pull without a login,
> or keep it private and `docker login ghcr.io` on Unraid first (step 2 below).
> GitHub → your profile → Packages → `dev-social` → Package settings → Change
> visibility.

The printed first-time Unraid setup (also emitted by the script):

```bash
# 1. (private package only) login to ghcr.io
echo 'YOUR_GITHUB_PAT' | docker login ghcr.io -u mikesawayda-adaptivesoftware --password-stdin

# 2. save the Supabase service_role secret ONCE (reused on every update)
mkdir -p /mnt/user/appdata/dev-social
printf %s 'YOUR_SUPABASE_SERVICE_ROLE_KEY' > /mnt/user/appdata/dev-social/service_role
chmod 600 /mnt/user/appdata/dev-social/service_role

# 3. pull + run (host ports 3092 = app, 3093 = socket)
docker pull ghcr.io/mikesawayda-adaptivesoftware/dev-social:latest
docker rm -f dev-social 2>/dev/null || true
SERVICE_ROLE=$(cat /mnt/user/appdata/dev-social/service_role)
docker run -d --name dev-social --restart unless-stopped \
  -p 3092:3000 -p 3093:3001 \
  -e NODE_ENV=production \
  -e GAME_CLIENT_ORIGIN='https://dev-social.adaptivesoftware.co' \
  -e SUPABASE_URL='https://dlfjcxnnmtkzupvhdivw.supabase.co' \
  -e SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE" \
  ghcr.io/mikesawayda-adaptivesoftware/dev-social:latest
```

To update after a future `./deploy.sh`: re-run steps 3 (pull → rm → run); the
saved `service_role` file is reused.

### Reverse proxy: Cloudflare + Nginx Proxy Manager

The live deployment fronts one public origin —
`https://dev-social.adaptivesoftware.co` — with **Cloudflare** (DNS + edge TLS)
in front of **Nginx Proxy Manager** (NPM, TLS + routing on the LAN). The two
container ports stay LAN-internal; only the HTTPS origin is public.

```
Browser ──HTTPS──> Cloudflare (proxied) ──HTTPS──> Nginx Proxy Manager
                                                      ├─ /          → 192.168.0.248:3092  (Next.js app)
                                                      └─ /socket.io/ → 192.168.0.248:3093  (Socket.IO)
```

**1. Cloudflare DNS** — add a proxied CNAME (one per app; there is no wildcard):

| Field        | Value                    |
| ------------ | ------------------------ |
| Type         | `CNAME`                  |
| Name         | `dev-social`             |
| Target       | `adaptivesoftware.co`    |
| Proxy status | 🟠 Proxied (orange cloud) |
| TTL          | Auto                     |

Account-wide **SSL/TLS mode must be Full** (or Full strict) so Cloudflare speaks
HTTPS to NPM's Let's Encrypt cert — *Flexible* causes redirect loops with Force
SSL. WebSockets traverse the proxy automatically (the 100s proxy timeout does not
apply to them).

**2. Nginx Proxy Manager** — one proxy host with a custom location for the socket:

- **Details tab** — Domain `dev-social.adaptivesoftware.co`, Scheme `http`,
  Forward Hostname/IP `192.168.0.248`, Forward Port `3092`, **Websockets Support ON**.
- **Custom Locations tab** — add location `/socket.io/`, Scheme `http`, Forward
  `192.168.0.248`, Port `3093`. Click the ⚙️ gear and paste:

  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 86400s;
  proxy_send_timeout 86400s;
  ```

- **SSL tab** — request a Let's Encrypt cert, Force SSL on. If issuance fails
  while Cloudflare is proxying (the HTTP-01 challenge is blocked), set the CF
  record to **DNS only** (grey cloud) temporarily, issue the cert, then re-enable
  Proxied.

NPM writes the `/socket.io/` block above the default `location /`, so ordering is
handled for you. `GAME_CLIENT_ORIGIN` (set on the container) locks the realtime
server's CORS to this origin.

> **Hostname must match everywhere.** `NEXT_PUBLIC_GAME_SERVER_URL` is baked into
> the browser bundle at build time, so the Cloudflare record, the NPM proxy host,
> and `PUBLIC_ORIGIN` in `deploy.sh` must all use the exact same hostname
> (`dev-social.adaptivesoftware.co`). A mismatch loads the page but silently
> fails the socket connection — rebuild after any change.

<details>
<summary>Equivalent hand-rolled nginx (if you don't use NPM)</summary>

```nginx
server {
    listen 443 ssl;
    server_name dev-social.adaptivesoftware.co;
    # ssl_certificate ... (Cloudflare Origin cert or Let's Encrypt)

    location /socket.io/ {              # realtime -> game server (MUST precede /)
        proxy_pass http://192.168.0.248:3093;
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
        proxy_pass http://192.168.0.248:3092;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

</details>

> The schema for the hosted Supabase project lives in `supabase/migrations/`.
> Apply it with the Supabase CLI (`supabase db push`) or the dashboard SQL editor
> before first run.

### Deploy checklist

1. Cloudflare: proxied CNAME `dev-social` → `adaptivesoftware.co`.
2. NPM: proxy host `dev-social.adaptivesoftware.co` → `:3092` (websockets on) +
   `/socket.io/` location → `:3093`, Let's Encrypt SSL.
3. `.env` has `SUPABASE_SERVICE_ROLE_KEY` (and optionally
   `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to ship GeoGuessr enabled).
4. Start Docker Desktop, `export GITHUB_CR_PAT=…`, run `./deploy.sh "message"`.
5. On Unraid: run the printed setup (saves `service_role`, then pull → run).
6. Open `https://dev-social.adaptivesoftware.co` and start a game to confirm the
   socket connects (check the browser console for a `/socket.io/` connection).

### Updating vs. troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| Page loads, but "connecting…" never resolves / games don't start | Socket blocked — check the NPM `/socket.io/` location points at `:3093` with the upgrade headers, and the baked origin matches the domain |
| Redirect loop / `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL/TLS mode is *Flexible* — set it to *Full* |
| `docker pull` denied on Unraid | Package is private — `docker login ghcr.io` (step 1) or make the ghcr package public |
| GeoGuessr shows a setup hint | No `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` was set at **build** time — add it to `.env` and re-run `./deploy.sh` (it's baked, not runtime) |
| Leaderboard errors / no persistence | `SUPABASE_SERVICE_ROLE_KEY` missing on the container, or migrations not applied to the project |

## Scripts

| Command            | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `npm run dev`      | Next app + realtime server (hot reload)        |
| `npm run build`    | Production build + type check                  |
| `npm start`        | Run the production app + realtime server       |
| `node scripts/smoke.mjs`  | End-to-end flow test against `:3001`    |
| `node scripts/smoke2.mjs` | Deterministic scoring test              |
| `node scripts/smokeGeo.mjs` | Real GeoGuessr socket flow test (skips without a Maps key) |
| `npx tsx scripts/resolvePanos.ts` | Bake Street View panorama ids into the pool |
| `./deploy.sh`      | Build `linux/amd64` image + push to ghcr.io    |
| `./deploy.sh --local` | Build & run locally via docker compose      |

## Tech

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Socket.IO · tsx · concurrently
