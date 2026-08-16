# Dev Social — Team Happy Hour Games

A live, Jackbox-style party-game platform for monthly team happy hours. The host
opens a room on the big screen, everyone joins from their phone with a 4-letter
code, and you play together in real time.

Three games ship today:

- **Photo Guessr** — everyone submits a baby photo (or any guess-worthy pic),
  then the room competes to match each photo to the right teammate. Points for
  correct guesses, bonus points for speed.
- **Real GeoGuessr** — each player is dropped into an interactive Street View on
  their phone, explores, and drops a pin on a world map. You score by how close
  your pin is to the true location. Plays fine solo. (Needs a Google Maps API
  key — see [Google Maps setup](#google-maps-setup-for-real-geoguessr).)
- **Word Chain** — everyone races the same clock on one seeded chain of words,
  where each neighbouring pair makes a compound word (SUN·FLOWER·BED·ROOM). Fill
  the blanks between the two ends before the timer runs out. Plays fine solo.

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
2. Everyone **joins** from their phone with the code + their name — or nobody
   does, and the host plays alone against the clock.
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
>
> **Playing solo works.** GeoGuessr and Word Chain both need one competitor, not
> two — a lone player still has a clock, a score and a leaderboard row. A host
> alone in the room is by definition the one playing, so the lobby ticks and
> locks "I'm playing too" until somebody else joins. Only Photo Guessr still
> needs a crowd, because it needs photos from two different people.

## How to play (Word Chain)

1. **Host** creates a room and, in the lobby, picks **Word Chain**, the time
   limit (**1 / 2 / 5 minutes**), the **chain length** (Short / Standard / Long
   — 3, 4 or 6 blanks) and the **difficulty** (Any / Easy / Normal / Hard).
   "I'm playing too" is on by default here.
2. Everyone **joins** from their phone with the code + their name. One player is
   fine — you're racing the clock either way (see the solo note above).
3. Host starts → everyone gets **the same chain** at the same time: two words
   given, the blanks between them to fill. Each neighbouring pair makes a
   compound word or set phrase, so `KEY · ? · ? · ? · ? · PUNCH` resolves to
   KEY**NOTE**, NOTE**BOOK**, BOOK**WORM**, WORM**HOLE**, HOLE PUNCH.
4. Solve **inwards from both ends** — there's an input at the top frontier and
   one at the bottom, so a link you can't get stops you one way round rather
   than stopping you dead. Each blank shows its length and its first letter;
   **💡 Reveal a letter** buys one more for −100 points. Wrong answers cost
   nothing but time.
5. **2,000 points split across the blanks**, plus **1,000** for completing the
   chain and up to **2,000** more for the time you had left — a clean sweep tops
   out at 5,000, the same ceiling as a perfect GeoGuessr round. The solve points
   are a fixed pot rather than a rate per link, so **every length is worth the
   same** and the leaderboard rewards playing well rather than picking "long".
   A hint costs a fifth of a link, which is 100 points on a standard chain.
6. Finish early and you **wait on the others**, watching the live race board.
   The round ends when everyone finishes or the clock runs out, then **Reveal**
   shows the whole chain and everyone's times, and **Final** crowns a champion.

> **On the big screen.** A host who isn't playing gets a TV layout instead of
> the phone one: the chain large enough to read across a room, a big clock, and
> a lane per player that fills a segment per link as they solve. It's fed by the
> same `chain:standing` deltas the players' race board uses, and it never sees
> an answer — the server builds it the same way it builds the view for a player
> who has solved nothing.

> **Difficulty** is how much narrowing the free first letter has to do: on an
> easy chain the blank's length alone identifies the answer, on a hard one
> several words fit the shape. It's measured inside the link graph, so it tracks
> how much work the hint saves rather than how obscure the compound is. The bank
> splits roughly evenly across the three tiers.

> **No repeats, ever.** A game is a single puzzle, so a chain someone has
> already played would hand them the whole game. The server picks from the
> chains *nobody in the room* has played, and only falls back to least-seen once
> that group has collectively played the entire bank. History lives in the
> `player_word_chains_seen` table, so this needs Supabase configured — in local
> mode the pick is simply random.
>
> The bank ships **1,051 chains** — 400 short, 500 standard, 151 long. Long
> chains are the scarce ones: every blank has to be unambiguous from both sides
> (below), and six in a row is a much harder ask of the graph than three. Each
> length is its own never-repeat pool, so the pools are independent.
>
> To grow it, add links to the `LINKS` table in
> `scripts/generateWordChains.mjs` and re-run it — the chains are walked out of
> that graph, so a link that isn't a real compound is the one bug that matters
> here and the table is the only thing worth reviewing.
>
> **Every blank has exactly one answer**, checked from both directions, and the
> generator drops chains that break that rule — including ones already in the
> bank. This is the constraint to keep in mind when adding links: a new link can
> retroactively give an old blank a second answer (add `BED → ROCK` and the
> blank in `BED · ? · SERVICE` accepts both ROOM and ROCK), so growing the graph
> can shrink the bank. That's the right trade. A puzzle that tells a correct
> player they're wrong, mid-race, is worse than one fewer puzzle.
>
> Ids of surviving chains are always kept; the history table is keyed by id, so
> renumbering one re-deals it to players who already solved it. Dropping one is
> safe — its rows simply stop matching anything.

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
      word/               # Word Chain: ChainBoard (tiles + race board),
                          #   WordChainPlaying, WordChainReveal,
                          #   WordChainBigScreen (the host's TV view)
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
  wordChains.ts           # Seeded Word Chain puzzle bank (generated) + normalizing
scripts/
  smoke.mjs, smoke2.mjs   # End-to-end socket tests (node scripts/smoke.mjs)
  smokeGeo.mjs            # GeoGuessr socket flow test
  smokeWordChain.mjs      # Word Chain socket flow test
  generateWordChains.mjs  # Walk the vetted link graph to grow the puzzle bank
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

> **Applying new migrations.** A push to `main` that touches
> `supabase/migrations/**` runs **Deploy database migrations**, which links the
> project and runs `supabase db push --linked`. Adding a migration is committing
> a file; nothing is applied by hand. The filenames are the versions the remote
> `schema_migrations` table records, so a rename would make an applied migration
> look pending — add new files, don't renumber old ones.
>
> That workflow and **Deploy** are independent and race, so a new image can be
> live for a minute or two before its migration is. Write migrations that a
> slightly older image tolerates, and features that tolerate a missing table:
> the two history tables below already do.
>
> For a **fresh** project, `supabase db push` applies everything in order. Until
> `..._leaderboard_views` is applied the `/leaderboard` page errors on the
> missing `season_leaderboard_by_type` view; until `..._players_identity` is
> applied, hosting/joining a Supabase-backed server fails on the missing
> `players` table. The two history tables are optional —
> `..._player_locations_seen` and `..._player_word_chains_seen` silently no-op
> when absent, they just stop steering games away from content a player has
> already had.

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

### How a deploy happens

```bash
git push origin main
```

There is no deploy script and nothing to run on a workstation.

```
push to main
  └─ CI: lint → next build → tsc --noEmit         .github/workflows/ci.yml
      └─ build linux/amd64, push :latest + :sha-… .github/workflows/deploy.yml
          └─ Watchtower on Unraid polls, pulls, restarts        (~5 min)
```

Two properties matter and are worth not breaking:

- **The publish job `needs:` the CI job.** A failing lint, typecheck or build
  produces no image, so a broken build never reaches Unraid. That is what makes
  pushing straight to `main` safe without branch protection.
- **Delivery is pull-based.** Watchtower reaches out to GHCR; CI never reaches
  in. No SSH key, no VPN, no self-hosted runner, no inbound port — which is why
  a deploy needs nothing but a `git push`, from anywhere.

Migrations under `supabase/migrations/` apply themselves the same way, via
`.github/workflows/deploy-migrations.yml`.

Confirm what's live:

```bash
curl -s https://dev-social.adaptivesoftware.co/api/health
```

`sha` is the commit the running image was built from — `BUILD_SHA` is baked into
the runner stage by CI. The game server reports the same value on its own
`/health` (`http://192.168.0.248:3093/health`, LAN only), which is how you tell
the two processes apart if they ever disagree.

> ⚠️ **Room state is in memory** (`server/rooms.ts`, no Redis adapter). Every
> Watchtower restart ends every game in progress. Don't merge during a happy
> hour, or set `WATCHTOWER_SCHEDULE` on the Unraid box so updates land at a
> known quiet time instead of within minutes.

To roll back, pin `image:` in the Unraid compose file to a `:sha-<commit>` tag
and `docker compose up -d`.

### Build-time vs. run-time config (read this first)

Five values are **`NEXT_PUBLIC_*`**, which Next.js **inlines into the browser
bundle at build time** — so they must be Docker **build args**, not runtime env
vars. They're public/non-secret, and CI supplies them from repo Variables and
Secrets:

| Value                             | Set as        | Comes from                              |
| --------------------------------- | ------------- | --------------------------------------- |
| `NEXT_PUBLIC_GAME_SERVER_URL`     | build arg     | Variable `PUBLIC_ORIGIN`                |
| `NEXT_PUBLIC_SUPABASE_URL`        | build arg     | Variable `SUPABASE_URL`                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | build arg     | Secret `SUPABASE_ANON_KEY`              |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | build arg     | Secret `GOOGLE_MAPS_BROWSER_KEY`        |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`  | build arg     | Variable `GOOGLE_MAPS_MAP_ID`           |
| `BUILD_SHA`                       | build arg     | `github.sha` (reported by `/api/health`)|
| `GAME_CLIENT_ORIGIN`              | runtime       | `infra/docker-compose.yml`              |
| `SUPABASE_URL`                    | runtime       | `infra/docker-compose.yml`              |
| `SUPABASE_SERVICE_ROLE_KEY`       | runtime       | Unraid `.env` — **secret** (see below)  |
| `GOOGLE_MAPS_API_KEY`             | runtime       | Unraid `.env` (optional, unrestricted)  |

If you build without `NEXT_PUBLIC_GAME_SERVER_URL` set to your real origin, the
deployed site tries to open the socket against `localhost:3001` and fails for
everyone. Because these are baked, **changing any of them needs a new build** —
edit the Variable/Secret, then re-run **Deploy** from the Actions tab.

### The `service_role` secret

The server uses Supabase's `service_role` key for all writes + photo uploads. It
**bypasses RLS**, so it must stay server-side — never in the browser, never
committed. It never passes through CI: the image contains no credentials, and
the key exists only in a file on the Unraid host.

- Locally it lives in `.env.local` (`SUPABASE_SERVICE_ROLE_KEY=...`).
- From the dashboard: **Project Settings → API Keys → `service_role`** (listed
  as `secret`; under "Legacy API keys" in the current UI). A newer `sb_secret_…`
  key works too.
- In production it lives in `/mnt/user/appdata/dev-social/.env` next to the
  compose file — see `infra/.env.unraid.example`.

> Without it, the app still runs — just fully in-memory (no persistence/storage).

### Running it locally

```bash
cp .env.docker.example .env   # then paste the service_role key
npm run docker:local          # docker compose up --build
```

The root `docker-compose.yml` is a **local build** file. `infra/docker-compose.yml`
is the pull-only production stack for Unraid; it has no `build:` key, because
nothing is ever built on that box.

### Unraid, one time

```bash
mkdir -p /mnt/user/appdata/dev-social && cd /mnt/user/appdata/dev-social

# 1. Copy infra/docker-compose.yml from the repo to here. Needed again only when
#    that file changes — image updates need nothing.

# 2. Secrets beside it (see infra/.env.unraid.example).
cat > .env <<'EOF'
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GOOGLE_MAPS_API_KEY=your-unrestricted-server-key
EOF
chmod 600 .env

# 3. The ghcr package is private, so the host needs a login (one time).
echo 'YOUR_GITHUB_PAT' | docker login ghcr.io -u mikesawayda-adaptivesoftware --password-stdin

# 4. Replace any old hand-run container with the compose stack.
docker rm -f dev-social 2>/dev/null || true
docker compose pull && docker compose up -d
```

Then make sure **Watchtower can pull a private GHCR image** — it needs either
the host's `~/.docker/config.json` mounted into it, or `REPO_USER`/`REPO_PASS`
set on the Watchtower container. Don't make the package public as a shortcut:
this image ships the full `src/` and `server/` source tree.

> Keep the package private rather than public. The runtime image intentionally
> retains `node_modules`, `src/` and `server/` so `tsx` can run the game server
> straight from TypeScript.

#### Real GeoGuessr needs **two** Maps keys

GeoGuessr is the only feature that needs Google Maps, and it uses two keys with
**different** restriction requirements — a common footgun:

| Key | Set as | Used by | Google restriction |
| --- | ------ | ------- | ------------------ |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | **build arg** (baked) | Browser: renders Street View + guess map | HTTP-referrer restricted (your domain + localhost); needs **Maps JavaScript API** |
| `GOOGLE_MAPS_API_KEY` | **runtime `-e`** | Server: resolves Street View panorama IDs | **No referrer restriction** (server calls have no referrer) — leave unrestricted or IP-restrict; needs **Street View Static API** |

> **Don't reuse one referrer-restricted key for both.** The server key must not be
> referrer-restricted or every panorama lookup is rejected and you get *"Couldn't
> load any Street View locations."* The browser key is baked at build time, so
> changing it requires a rebuild (edit the `GOOGLE_MAPS_BROWSER_KEY` secret, then
> re-run **Deploy**); the server key is runtime-only, so editing the Unraid `.env`
> and restarting the container is enough.
> You can pre-bake panorama IDs instead with `npx tsx scripts/resolvePanos.ts` to
> avoid the server needing a key at all.

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
  `192.168.0.248`, Port `3093`. Click the ⚙️ gear and paste **only** the
  timeouts:

  ```nginx
  proxy_read_timeout 86400s;
  proxy_send_timeout 86400s;
  ```

  Do **not** add `proxy_http_version`/`Upgrade`/`Connection` here. The
  **Websockets Support** toggle already injects those into every location, and a
  second `proxy_http_version` makes nginx fail to load with `"proxy_http_version"
  directive is duplicate` — the save throws *Internal Error* and the SSL block
  never activates (→ Cloudflare 525).

- **SSL tab** — request a Let's Encrypt cert, Force SSL on. If issuance fails
  while Cloudflare is proxying (the HTTP-01 challenge is blocked), set the CF
  record to **DNS only** (grey cloud) temporarily, issue the cert, then re-enable
  Proxied.

NPM writes the `/socket.io/` block above the default `location /`, so ordering is
handled for you. `GAME_CLIENT_ORIGIN` (set on the container) locks the realtime
server's CORS to this origin.

> **Hostname must match everywhere.** `NEXT_PUBLIC_GAME_SERVER_URL` is baked into
> the browser bundle at build time, so the Cloudflare record, the NPM proxy host,
> and the `PUBLIC_ORIGIN` repo Variable must all use the exact same hostname
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
> Changes there apply themselves on push to `main`. Before the very first
> automated run, trigger **Deploy database migrations** manually with `dry_run`
> checked and read the `supabase migration list --linked` output: the 0001–0005
> migrations were applied by hand, so production may have no migration history
> rows, and a blind `db push` would try to replay them against objects that
> already exist.

### One-time setup checklist

1. **GitHub → Settings → Secrets and variables → Actions.** Variables
   `PUBLIC_ORIGIN`, `SUPABASE_URL`, `GOOGLE_MAPS_MAP_ID`; secrets
   `SUPABASE_ANON_KEY`, `GOOGLE_MAPS_BROWSER_KEY`, and — for schema deploys —
   `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. The migrations workflow
   skips with a warning until those last two exist, so the pipeline stays green
   in the meantime.
2. **Cloudflare**: proxied CNAME `dev-social` → `adaptivesoftware.co`, SSL/TLS
   mode Full.
3. **NPM**: proxy host `dev-social.adaptivesoftware.co` → `:3092` (websockets
   on) + `/socket.io/` location → `:3093`, Let's Encrypt SSL.
4. **Unraid**: `infra/docker-compose.yml` and a `.env` in
   `/mnt/user/appdata/dev-social/`, then `docker compose up -d`.
5. **Watchtower**: confirm it can pull the private GHCR package.
6. Push to `main`, then check `curl -s https://dev-social.adaptivesoftware.co/api/health`
   and start a game to confirm the socket connects (look for a `/socket.io/`
   connection in the browser console).

### Updating vs. troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| Page loads, but "connecting…" never resolves / games don't start | Socket blocked — check the NPM `/socket.io/` location points at `:3093` with the upgrade headers, and the baked origin matches the domain |
| Redirect loop / `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL/TLS mode is *Flexible* — set it to *Full* |
| `docker pull` denied on Unraid | Package is private — `docker login ghcr.io` on the host, and give Watchtower the same credentials |
| CI green but no new image | The push only touched `paths-ignore` paths (`**.md`, `supabase/**`, `.claude/**`) — run **Deploy** manually from the Actions tab |
| `/api/health` still reports the old sha | Watchtower hasn't polled yet — check `docker logs watchtower`, then that it can pull the private package |
| Games all died mid-session | Expected: a Watchtower restart clears in-memory room state. Merge outside game time, or set `WATCHTOWER_SCHEDULE` |
| NPM save → *Internal Error*; `nginx -t` shows `"proxy_http_version" directive is duplicate` | Remove `proxy_http_version` from the `/socket.io/` advanced box — the Websockets Support toggle already adds it |
| Cloudflare **525** (SSL handshake failed) | Origin TLS not active — NPM proxy host has no cert, or its config failed to reload (see the duplicate-directive row above) |
| GeoGuessr shows a setup hint | No `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` was set at **build** time — set the `GOOGLE_MAPS_BROWSER_KEY` secret and re-run **Deploy** (it's baked, not runtime) |
| GeoGuessr: *Couldn't load any Street View locations… configured for the server* | Server `GOOGLE_MAPS_API_KEY` missing, referrer-restricted, or lacking the Street View Static API — set an **unrestricted** server key and redeploy |
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
| `node scripts/smokeWordChain.mjs` | Word Chain socket flow test (no keys needed) |
| `node scripts/generateWordChains.mjs [n]` | Grow the Word Chain bank to n puzzles **per length** (default 400) |
| `npx tsx scripts/resolvePanos.ts` | Bake Street View panorama ids into the pool |
| `npm run lint`     | ESLint (also the first CI gate)                |
| `npx tsc --noEmit` | Typecheck, **including `server/`** — run after `npm run build` |
| `npm run docker:local` | Build & run the container locally via docker compose |

## Tech

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Socket.IO · tsx · concurrently
