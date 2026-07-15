# Dev Social — Game Ideas Backlog

A running list of party games/events for the team happy hours. The platform
(rooms, join-by-code, live sync, scoring, season leaderboard) is reusable, so
most of these are "drop-in" games on top of it.

**Status legend:** ✅ built · 🔨 in progress · 💡 idea

---

## ✅ Built / platform

- ✅ **Platform** — Jackbox-style rooms: host on the big screen, players join from
  their phones with a 4-letter code, live real-time sync.
- ✅ **Photo Guessr / Baby Photo Match** — everyone submits a photo (baby pic,
  etc.); the room competes to match each photo to the right teammate. Points for
  correct + speed.
- ✅ **Real GeoGuessr-style** — drop into a random Street View, guess the location
  on a map, score by distance. (Needs a Google Maps API key.)
- ✅ **Season leaderboard + game history** — cross-game points, wins, recent games
  (persisted in Supabase).

---

## 💡 Guess-the-thing (the "GeoGuessr" family)

These map directly to the original GeoGuessr inspiration and reuse the
"show content → everyone guesses → reveal → score" engine.

- 💡 **Photo Guessr variants** — travel photos, pets, childhood homes, desks.
- 🔨 **Price Is Right** — guess the price of weird Amazon products.
  (Plan: `PRICE_IS_RIGHT_PLAN.md`.)
- 💡 **Zoomed-In** — extreme close-up of an object/logo, guess what it is.
- 💡 **Higher or Lower** — Google search volume, populations, box office, etc.

## 💡 Live multiplayer party games (everyone on a phone at once)

- 💡 **Live Trivia (Kahoot-style)** — pop culture, movies, music, geography, **and
  team inside jokes / company lore**.
- 💡 **Skribbl / Pictionary** — draw & guess.
- 💡 **Codenames** — word game, team vs team.
- 💡 **Wavelength** — guess where a clue falls on a spectrum.
- 💡 **Two Truths and a Lie** — submit ahead of time, vote live.
- 💡 **Fibbage-style** — make up fake answers to obscure trivia to fool teammates.
- 💡 **"Who Said It?"** — funny anonymized Slack/standup quotes, guess the author.

## 💡 Competitive skill games (leaderboards + brackets)

- 💡 **Typing / Code Race** — speed-type a snippet, live WPM race.
- 💡 **Regex Golf / Code Golf** — solve a challenge in the fewest characters.
- 💡 **Refactor Race** — make a failing test pass the fastest.
- 💡 **Monthly tournament bracket** — seed game winners into a season-long ladder.

## 💡 Coding-themed guessers (optional flavor)

- 💡 **CommitGuessr** — guess who wrote a real commit message.
- 💡 **CodeGuessr** — guess the language / repo / service from a snippet.
- 💡 **PRGuessr** — guess who opened a PR or left a brutal review comment.
- 💡 **BugGuessr** — show a stack trace, guess the root cause / service.
- 💡 **Real or AI** — guess whether a snippet/answer was written by a human or LLM.
- 💡 **Guess the Output** — predict what a tricky snippet prints.

## 💡 Season "glue" / social features

- 💡 **Profiles + badges** — avatars, achievements, season champion.
- 💡 **Prediction market** — bet fake points on outcomes (e.g. "deploy goes green
  first try?").
- 💡 **Standup bingo** — mark off buzzwords during meetings.

---

## Notes

- Many of the guessing games are the same engine as Photo Guessr with a
  different content source, so they're cheap to add.
- "Live Trivia with team inside jokes" is a strong candidate for the next build —
  high fun-per-effort and theme-agnostic (swap question packs each month).
