# Implementation Plan — "Price Is Right" Game

A new guess-the-thing game for Dev Social: players are shown a real product
(image + title) and guess its price. Scored by how close each guess is to the
actual price. Built on the existing room / live-sync / scoring engine.

## Decisions (locked)

- **Data source:** Live Amazon Product Advertising API (PA-API 5.0).
- **Scoring:** Relative error decay (scale-invariant, per-player, forgiving).
- **Timer:** price-specific set `[20, 30, 45]s` (default 30).
- **Round count:** fixed at 5 (matches GeoGuessr).
- **Currency:** USD only.

## Template

GeoGuessr (`geo_guessr`) is the structural template: "show content → everyone
guesses a value → reveal → score" with **no photo-submission phase** (starts
straight from the lobby). Like geo's Street View pano resolution, Price Is Right
needs an **async data-fetch step at game start** (pull products from Amazon), so
`startPriceGame` mirrors geo's `async startGeoGame`.

A game type is a vertical slice across five layers, each mapped to its geo
equivalent below.

---

## 1. Shared contract — `src/shared/types.ts`

- **`GameType`** union: add `"price_is_right"`.
- **`GAME_TYPE_LABELS`**: add `price_is_right: "Price Is Right"`.
- **New view types** (analogous to `GeoRoundView` / `GeoResult` / `GeoRevealView`):
  - `PriceRoundView` — mid-round view for a guessing player. Mirrors
    `GeoRoundView` but the content payload is `imageUrl: string` +
    `productTitle: string` (never the price). Keep `index`, `total`, `endsAt`,
    `answeredCount`, `guessCount`, `iGuessed`, `myGuess?: number`, `isHost`,
    `spectating`.
  - `PriceResult` — `{ playerId; guess: number | null; errorAbs: number | null; points: number }`
    (replaces geo's `distanceKm` with a dollar-error field).
  - `PriceRevealView` — `{ index; total; imageUrl; productTitle; answer: { price: number; source?: string; sourceUrl?: string }; results: PriceResult[] }`.
    The `answer` object carries the reveal-only truth (actual price + attribution).
- **`RoomState`**: add `priceRound?: PriceRoundView;` and `priceReveal?: PriceRevealView;`.
- **`GameSettings`** + **`DEFAULT_SETTINGS`**: add `priceRoundCount: number` (default 5).
  Add `PRICE_DURATION_OPTIONS_SEC = [20, 30, 45]` and `PRICE_DEFAULT_DURATION_SEC = 30`.
- **`ClientToServerEvents`**: add
  - `"host:startPriceGame": (payload: { roundDurationSec: number; hostPlaying: boolean }, ack?) => void`
  - `"price:guess": (payload: { price: number }, ack?) => void`
- No `ServerToClientEvents` change — everything flows through the existing
  `room:state` broadcast.

---

## 2. Data source — Live Amazon API

### New module `server/amazon.ts`

Client for Amazon Product Advertising API (PA-API 5.0). This is the analog of
geo's `resolvePano` — it turns a query into concrete round content.

```ts
export interface Product {
  id: string;
  imageUrl: string;
  title: string;
  price: number;     // actual price in USD (the scoring answer, kept server-side)
  source?: string;   // "Amazon"
  sourceUrl?: string; // product detail URL, shown at reveal
}

// Fetch a batch of guess-worthy products for a game.
export async function fetchProducts(count: number): Promise<Product[]>;
export function amazonConfigured(): boolean; // mirrors geoMapsConfigured()
```

- **Credentials** (server env vars, injected like `GOOGLE_MAPS_API_KEY` in
  `deploy.sh`): `AMAZON_ACCESS_KEY`, `AMAZON_SECRET_KEY`, `AMAZON_ASSOCIATE_TAG`,
  `AMAZON_REGION` (default `us-east-1` / `webservices.amazon.com`).
  > ⚠️ Requires an approved Amazon Associates account; PA-API access is gated on
  > qualifying sales. Must be resolved before this can be built/tested against.
- **Rate limits:** PA-API is tightly throttled. Do **not** call it per guess.
  Options:
  - **Prefetch pool** (recommended): a curated set of search terms /
    ASINs in `server/priceQueries.ts`; `fetchProducts` pulls from a rotating
    cache filled by a `scripts/prefetch-products.ts` job (mirrors the existing
    pano-prefetch pattern). Falls back to cache if the live call is throttled.
  - Live-per-game (simpler, riskier): one batched call in `startPriceGame`.
- **ToS:** PA-API terms constrain how prices/images may be displayed and cached;
  keep display within a single live game session and attribute via `sourceUrl`.
- **`amazonConfigured()` gate:** the Lobby should disable/annotate the Price Is
  Right tile when credentials are absent, exactly as geo does for
  `googleMapsConfigured`.

---

## 3. Game logic — `server/rooms.ts`

Introduce a third branch alongside the existing `geo_guessr` vs. photo-default.

- **Internal types** (mirror `GeoGuess` / `GeoRound`):
  - `PriceGuess { price: number; errorAbs: number; points: number; timeMs: number }`
  - `PriceRound { id; productId; imageUrl; title; price; source?; sourceUrl?; guesses: Map<string, PriceGuess>; startedAt; durationMs; closed }`
- **`Room`**: add `priceRounds: PriceRound[]`; init `[]` in `createRoom`, reset in `playAgain`.
- **Scoring** — `pricePoints(guess, actual)` next to `geoPoints`:

  ```
  const MAX_PRICE_POINTS = 5000;   // matches MAX_GEO_POINTS
  const PRICE_SCALE = 0.5;         // 50%-off guess ≈ 37% of max
  ratio  = Math.abs(guess - actual) / actual;
  points = Math.round(MAX_PRICE_POINTS * Math.exp(-ratio / PRICE_SCALE));
  ```

  Per-player and independent (no busting) — computed at guess-time like geo's
  `geoPoints(distanceKm)`. `errorAbs = |guess - actual|` is stored for display
  only. "Closest" ranking emerges naturally from sorting by points at reveal.
- **`startPriceGame(code, playerId, roundDurationSec, hostPlaying)`** — near-copy
  of `startGeoGame` (host check, lobby check, ≥2-competitor check, duration
  clamp). Replaces the geo-location loop with
  `await fetchProducts(priceRoundCount)` mapped into `PriceRound`s. Stays
  `async` (like geo). Sets `gameType = "price_is_right"`, resets other round
  arrays, zeroes scores, calls `beginRound`.
- **`submitPriceGuess(code, playerId, price)`** — mirror `submitGeoGuess`: guard
  `gameType === "price_is_right" && phase === "playing"`, membership + spectator
  checks, validate `price` is finite and `>= 0` (cap at a sane max), compute
  `errorAbs`/`points`, store, then `allConnectedGuessed(...)` → `closeRound`.
  `allConnectedGuessed` is already generic over any playerId-keyed guesses map —
  reused unchanged.
- **Generalize the branchers** (each currently `geo_guessr ? geoRounds : rounds`):
  `beginRound`, `closeRound` (add a price block: mark closed, clear timer, add
  `guess.points` to scores, phase → reveal, `maybeScheduleHostAbsentAdvance`),
  `handleDisconnect`, `advanceRound` total-count, `takeFinishedGame` roundCount.
- **`viewFor`** — add an early-return `price_is_right` block modeled on the geo
  block: `priceRound` for playing (exposes `imageUrl`/`productTitle`, withholds
  `price`), `priceReveal` for reveal (includes `answer.price`), identical `final`
  ranking.

---

## 4. Socket wiring

- **`server/index.ts`**: `host:startPriceGame` handler mirrors geo's (keep
  `await` since `startPriceGame` is async); `price:guess` one-liner via
  `withRoom` → `store.submitPriceGuess(code, pid, price)`.
- **`src/components/GameProvider.tsx`**: add `startPriceGame` and
  `submitPriceGuess` to `GameContextValue` and the `value` object, as near-copies
  of `startGeoGame` / `submitGeoGuess`.

---

## 5. UI — new folder `src/components/game/price/`

Mirror `src/components/game/geo/`:

- **`PricePlaying.tsx`** (template `GeoPlaying.tsx`): reuse header/timer/progress
  block, spectator-vs-player split, `useCountdown`. Replace `StreetViewPano` with
  `ProductCard` (`<img src={imageUrl}>` + title); replace `GuessMap` with
  `PriceInput`.
- **`PriceInput.tsx`** (template `GuessMap.tsx`): a `$` number field + "Lock in
  guess" button, following the same `locked`/`submitting`/`onSubmit(price)`
  contract. No Google Maps.
- **`ProductCard.tsx`** (template `StreetViewPano.tsx`): image + title card; may
  be inlined if trivial.
- **`PriceReveal.tsx`** (template `GeoReveal.tsx`): reuse round label, ranked
  per-round list, `Leaderboard`, host "Next / See final results" button. Replace
  `ResultMap` with a product card + big actual-price reveal + optional
  `sourceUrl` link. Replace `formatDistance` with a money helper
  (e.g. `"$12.99 · off by $4.00 · +820"`).

`Leaderboard`, `PlayerList`, `Avatar`, `Button`, `useCountdown` are game-agnostic
and reused unchanged.

---

## 6. Routing — `src/app/room/[code]/page.tsx`

Add an explicit `price_is_right` branch to the phase dispatcher
(`playing → PricePlaying`, `reveal → PriceReveal`); `final` stays shared. Import
the two new components. **No new route/page file** — the room page dispatches by
`phase`/`gameType` internally, so the Next.js instant-navigation customization
(the only breaking change flagged in `AGENTS.md`) does not apply here.

---

## 7. Lobby — `src/components/game/Lobby.tsx`

- Add a `GAMES` entry: `{ type: "price_is_right", emoji: "💰", name: "Price Is Right", blurb: "Guess the price of weird real products." }`.
- Add a settings block mirroring geo's: timer picker
  (`PRICE_DURATION_OPTIONS_SEC`) + the "I'm playing too" host-playing checkbox
  (reused verbatim). Disable/annotate the tile when `amazonConfigured()` is false.
- Extend `start()`: `else if (selected === "price_is_right") await startPriceGame(priceDuration, hostPlaying)`.
  Pull `startPriceGame` from `useGame()`; add `priceDuration` state.
- Update the start-button label ternary.

---

## Files touched

**New**
- `server/amazon.ts` — PA-API client (`fetchProducts`, `amazonConfigured`)
- `server/priceQueries.ts` — curated search terms / ASINs (if prefetch approach)
- `scripts/prefetch-products.ts` — optional prefetch/cache job
- `src/components/game/price/PricePlaying.tsx`
- `src/components/game/price/PriceInput.tsx`
- `src/components/game/price/ProductCard.tsx`
- `src/components/game/price/PriceReveal.tsx`

**Modified**
- `src/shared/types.ts`
- `server/rooms.ts`
- `server/index.ts`
- `src/components/GameProvider.tsx`
- `src/app/room/[code]/page.tsx`
- `src/components/game/Lobby.tsx`
- `deploy.sh` — inject Amazon env vars (mirrors `GOOGLE_MAPS_API_KEY`)

---

## Open items / risks

1. **Amazon Associates credentials** — approved account + PA-API access
   (gated on qualifying sales) required before build/test. Main risk to this
   approach; needs a decision on fallback if unavailable.
2. **PA-API rate limits / caching** — confirm prefetch-pool vs. live-per-game.
3. **ToS** — price/image display + caching constraints for a party-game context.
4. **Scoring constants** — `MAX_PRICE_POINTS = 5000`, `PRICE_SCALE = 0.5` are
   starting values; tune after playtest.
5. **Seen-tracking** — skip per-player product-repeat avoidance for v1 (geo's
   `geoLocationIds` machinery not replicated).
