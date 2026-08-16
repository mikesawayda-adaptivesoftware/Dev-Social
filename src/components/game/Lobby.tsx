"use client";

import { useState, useSyncExternalStore } from "react";
import { useGame } from "@/components/GameProvider";
import { Button } from "@/components/ui";
import {
  ENABLED_GAME_TYPES,
  GAME_TYPE_BLURB,
  GAME_TYPE_EMOJI,
  GAME_TYPE_LABELS,
  GEO_DEFAULT_DURATION_SEC,
  GEO_DURATION_OPTIONS_SEC,
  WORD_CHAIN_DEFAULT_DURATION_SEC,
  WORD_CHAIN_DEFAULT_LENGTH,
  WORD_CHAIN_DIFFICULTY_CHOICES,
  WORD_CHAIN_DIFFICULTY_LABELS,
  WORD_CHAIN_DURATION_OPTIONS_SEC,
  WORD_CHAIN_LENGTH_LABELS,
  WORD_CHAIN_LENGTH_OPTIONS,
  DRAW_DEFAULT_DURATION_SEC,
  DRAW_DIFFICULTY_CHOICES,
  DRAW_DURATION_OPTIONS_SEC,
  DRAW_MAX_ROUNDS,
  type DrawDifficultyChoice,
  type GameType,
  type WordChainDifficultyChoice,
} from "@/shared/types";
import { PlayerList, RoomCodeBadge } from "./shared";

// `window.location.origin` is client-only. Read it via useSyncExternalStore so
// SSR renders "" (getServerSnapshot) and the client the real origin, with no
// hydration mismatch and no setState-in-effect.
const subscribeNoop = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

const SOLO_NOTE =
  "You're the only one here, so you're playing. This unlocks when someone else joins.";

export function Lobby() {
  const {
    state,
    isHost,
    me,
    setGameType,
    startSubmission,
    startGeoGame,
    startWordChain,
    startDrawIt,
  } = useGame();
  const origin = useSyncExternalStore(subscribeNoop, getOrigin, getServerOrigin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoDuration, setGeoDuration] = useState<number>(
    GEO_DEFAULT_DURATION_SEC
  );
  const [wordDuration, setWordDuration] = useState<number>(
    WORD_CHAIN_DEFAULT_DURATION_SEC
  );
  const [wordDifficulty, setWordDifficulty] =
    useState<WordChainDifficultyChoice>("any");
  const [wordLength, setWordLength] = useState<number>(
    WORD_CHAIN_DEFAULT_LENGTH
  );
  const [drawDuration, setDrawDuration] = useState<number>(
    DRAW_DEFAULT_DURATION_SEC
  );
  const [drawDifficulty, setDrawDifficulty] =
    useState<DrawDifficultyChoice>("any");
  const [hostPlaying, setHostPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!state) {
    return null;
  }

  const joinUrl = origin ? `${origin}/join?code=${state.code}` : "";

  // The host's pick lives on the server, so everyone in the lobby (and the
  // public games list) sees the same selection.
  const selected = state.gameType;

  // Photo Guessr needs photos from two different people, so it really does need
  // a room. GeoGuessr and Word Chain are you against a clock, and play fine
  // alone.
  // Draw It needs someone to draw *for*, so it can't be solo and it can't be
  // two — with one guesser the drawing may as well be a direct message.
  const soloCapable = selected === "geo_guessr" || selected === "word_chain";
  // A host by themselves can only be a player — a game with nobody competing
  // isn't a game. Derived rather than stored, so it also covers the lobby's
  // default game, which the host reaches without clicking a card at all.
  const alone = state.players.length === 1;
  const hostWillPlay = hostPlaying || (alone && soloCapable);
  const competitors = hostWillPlay
    ? state.players.length
    : state.players.length - 1;
  const notEnough = soloCapable
    ? competitors < 1
    : selected === "draw_it"
      ? competitors < 3
      : state.players.length < 2;

  function pickGame(gameType: GameType) {
    setError(null);
    if (gameType === "word_chain") {
      // Everyone solves their own chain, so the host joining in is the norm
      // here rather than the exception. They can still untick it to run the
      // big screen. (GeoGuessr keeps its host-on-the-big-screen default.)
      setHostPlaying(true);
    }
    setGameType(gameType).catch((e) =>
      setError(e instanceof Error ? e.message : "Couldn't switch the game.")
    );
  }

  async function copyLink() {
    if (!joinUrl) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(joinUrl);
      } else {
        // Fallback for non-secure contexts (e.g. plain-http LAN access), where
        // navigator.clipboard is unavailable.
        const ta = document.createElement("textarea");
        ta.value = joinUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (rare) — the link stays on screen to copy manually.
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      if (selected === "geo_guessr") {
        await startGeoGame(geoDuration, hostWillPlay);
      } else if (selected === "word_chain") {
        await startWordChain(
          wordDuration,
          hostWillPlay,
          wordDifficulty,
          wordLength
        );
      } else if (selected === "draw_it") {
        await startDrawIt(drawDuration, hostWillPlay, drawDifficulty);
      } else {
        await startSubmission();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the game.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 text-center">
      <RoomCodeBadge code={state.code} />

      <div className="mt-4 flex flex-col items-center gap-2">
        <span className="text-sm text-white/50">Players join at</span>
        <button
          type="button"
          onClick={copyLink}
          disabled={!joinUrl}
          title="Click to copy the join link"
          aria-label={copied ? "Join link copied" : "Copy join link"}
          className="group flex max-w-full items-center gap-3 rounded-2xl border-2 border-white/10 bg-white/5 px-4 py-3 font-semibold text-white transition-all hover:border-fuchsia-400 hover:bg-fuchsia-400/10 disabled:opacity-50"
        >
          <span className="truncate">
            {joinUrl.replace(/^https?:\/\//, "")}
          </span>
          <span
            className={`shrink-0 rounded-lg px-3 py-1 text-xs font-bold uppercase tracking-wide transition-colors ${
              copied
                ? "bg-green-500 text-white"
                : "bg-fuchsia-500/80 text-white group-hover:bg-fuchsia-500"
            }`}
          >
            {copied ? "✓ Copied" : "Copy"}
          </span>
        </button>
        {state.visibility === "public" && (
          <p className="text-xs text-emerald-300/80">
            🌐 Listed in Live games — anyone can join until you start.
          </p>
        )}
      </div>

      <div className="card mt-8 p-6">
        <h2 className="mb-4 text-lg font-bold text-white/80">
          Players ({state.players.length})
        </h2>
        <PlayerList players={state.players} highlightId={me?.id} />
      </div>

      {isHost ? (
        <div className="mt-8 space-y-4">
          {/* Two-up only when there's more than one game to choose between —
              a lone half-width card reads as a layout bug. */}
          <div
            className={`grid gap-3 ${
              ENABLED_GAME_TYPES.length > 1 ? "sm:grid-cols-2" : ""
            }`}
          >
            {ENABLED_GAME_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => pickGame(type)}
                className={`rounded-2xl border-2 p-4 text-left transition-all ${
                  selected === type
                    ? "border-fuchsia-400 bg-fuchsia-400/15"
                    : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                <div className="text-2xl">{GAME_TYPE_EMOJI[type]}</div>
                <div className="mt-1 font-bold">{GAME_TYPE_LABELS[type]}</div>
                <div className="text-xs text-white/50">{GAME_TYPE_BLURB[type]}</div>
              </button>
            ))}
          </div>

          {selected === "geo_guessr" && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <p className="mb-2 text-sm font-semibold text-white/70">
                Time per location
              </p>
              <DurationPicker
                options={GEO_DURATION_OPTIONS_SEC}
                value={geoDuration}
                onChange={setGeoDuration}
                format={(sec) => `${sec}s`}
              />
              <p className="mt-2 text-xs text-white/40">
                5 locations · guess by distance. Needs a Google Maps key.
              </p>
              <HostPlayingToggle
                checked={hostWillPlay}
                onChange={setHostPlaying}
                verb="Guess"
                lockedNote={alone ? SOLO_NOTE : undefined}
              />
            </div>
          )}

          {selected === "word_chain" && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <p className="mb-2 text-sm font-semibold text-white/70">
                Time limit
              </p>
              <DurationPicker
                options={WORD_CHAIN_DURATION_OPTIONS_SEC}
                value={wordDuration}
                onChange={setWordDuration}
                format={(sec) => `${sec / 60} min`}
              />
              <p className="mb-2 mt-4 text-sm font-semibold text-white/70">
                Chain length
              </p>
              {/* A grid, not a row: five options don't fit side by side on a
                  phone without shrinking the labels to nothing. */}
              <div className="grid grid-cols-3 gap-2">
                {WORD_CHAIN_LENGTH_OPTIONS.map((words) => (
                  <button
                    key={words}
                    onClick={() => setWordLength(words)}
                    className={`rounded-xl border-2 px-2 py-2 text-sm font-semibold transition-all ${
                      wordLength === words
                        ? "border-fuchsia-400 bg-fuchsia-400/15"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    {WORD_CHAIN_LENGTH_LABELS[words]}
                    <span className="block text-xs font-normal text-white/40">
                      {words - 2} blanks
                    </span>
                  </button>
                ))}
              </div>
              {wordLength >= 12 && wordDuration < 300 && (
                <p className="mt-2 text-xs text-amber-300/80">
                  {wordLength - 2} blanks is a lot for{" "}
                  {wordDuration / 60} minute
                  {wordDuration === 60 ? "" : "s"} — consider 5 minutes.
                </p>
              )}

              <p className="mb-2 mt-4 text-sm font-semibold text-white/70">
                Difficulty
              </p>
              <div className="flex gap-2">
                {WORD_CHAIN_DIFFICULTY_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    onClick={() => setWordDifficulty(choice)}
                    className={`flex-1 rounded-xl border-2 px-2 py-2 text-sm font-semibold transition-all ${
                      wordDifficulty === choice
                        ? "border-fuchsia-400 bg-fuchsia-400/15"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    {WORD_CHAIN_DIFFICULTY_LABELS[choice]}
                  </button>
                ))}
              </div>

              <p className="mt-2 text-xs text-white/40">
                One puzzle, everyone racing the same clock, solving in from both
                ends. Nobody is dealt a chain they&apos;ve played before. Every
                length is worth the same 5,000, so pick on feel. Difficulty is
                how many words fit each blank before the first letter narrows it
                down.
              </p>
              <HostPlayingToggle
                checked={hostWillPlay}
                onChange={setHostPlaying}
                verb="Solve"
                lockedNote={alone ? SOLO_NOTE : undefined}
              />
            </div>
          )}

          {selected === "draw_it" && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <p className="mb-2 text-sm font-semibold text-white/70">
                Time to draw
              </p>
              <DurationPicker
                options={DRAW_DURATION_OPTIONS_SEC}
                value={drawDuration}
                onChange={setDrawDuration}
                format={(sec) => `${sec}s`}
              />

              <p className="mb-2 mt-4 text-sm font-semibold text-white/70">
                Difficulty
              </p>
              <div className="flex gap-2">
                {DRAW_DIFFICULTY_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    onClick={() => setDrawDifficulty(choice)}
                    className={`flex-1 rounded-xl border-2 px-2 py-2 text-sm font-semibold capitalize transition-all ${
                      drawDifficulty === choice
                        ? "border-fuchsia-400 bg-fuchsia-400/15"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    {choice}
                  </button>
                ))}
              </div>

              <p className="mt-2 text-xs text-white/40">
                Everyone takes a turn drawing, up to {DRAW_MAX_ROUNDS} rounds.
                Needs at least 3 players — someone has to be guessing.
              </p>
              <HostPlayingToggle
                checked={hostWillPlay}
                onChange={setHostPlaying}
                verb="Draw and guess"
              />
            </div>
          )}

          <Button
            onClick={start}
            disabled={busy || notEnough}
            className="w-full max-w-sm"
          >
            {notEnough
              ? selected === "draw_it"
                ? "Need 3 players…"
                : "Waiting for players…"
              : `Start ${GAME_TYPE_LABELS[selected]} →`}
          </Button>
          {error && (
            <p className="text-sm text-red-300">{error}</p>
          )}
          <p className="text-xs text-white/40">
            You&apos;re the host. Pick a game and start when everyone has joined.
          </p>
        </div>
      ) : (
        <div className="mt-8">
          <p className="text-lg text-white/70">
            You&apos;re in! Waiting for the host to start…
          </p>
          <p className="mt-3 text-sm text-white/50">
            Up next: {GAME_TYPE_EMOJI[selected]}{" "}
            <span className="font-semibold text-white/80">
              {GAME_TYPE_LABELS[selected]}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

/** Row of timer choices. Each game brings its own options and its own way of
 * writing them — seconds read better for a per-location clock, minutes for a
 * whole-game one. */
function DurationPicker({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly number[];
  value: number;
  onChange: (sec: number) => void;
  format: (sec: number) => string;
}) {
  return (
    <div className="flex gap-2">
      {options.map((sec) => (
        <button
          key={sec}
          onClick={() => onChange(sec)}
          className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-all ${
            value === sec
              ? "border-fuchsia-400 bg-fuchsia-400/15"
              : "border-white/10 bg-white/5 hover:border-white/30"
          }`}
        >
          {format(sec)}
        </button>
      ))}
    </div>
  );
}

/**
 * Whether the host competes or just runs the big screen.
 *
 * `lockedNote` covers the case where there's no choice left to make — a host
 * alone in the room is the only possible player — and says why, instead of
 * leaving a live-looking checkbox whose other setting has no valid outcome.
 */
function HostPlayingToggle({
  checked,
  onChange,
  verb,
  lockedNote,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  verb: string;
  lockedNote?: string;
}) {
  const locked = Boolean(lockedNote);
  return (
    <label
      className={`mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 ${
        locked ? "" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-fuchsia-500 disabled:opacity-60"
      />
      <span className="text-sm">
        <span className="font-semibold">I&apos;m playing too</span>
        <span className="block text-xs text-white/40">
          {lockedNote ??
            `${verb} from this device. Off = you run the screen and stay off the scoreboard.`}
        </span>
      </span>
    </label>
  );
}
