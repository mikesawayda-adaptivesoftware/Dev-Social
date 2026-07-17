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
  type GameType,
} from "@/shared/types";
import { PlayerList, RoomCodeBadge } from "./shared";

// `window.location.origin` is client-only. Read it via useSyncExternalStore so
// SSR renders "" (getServerSnapshot) and the client the real origin, with no
// hydration mismatch and no setState-in-effect.
const subscribeNoop = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function Lobby() {
  const { state, isHost, me, setGameType, startSubmission, startGeoGame } =
    useGame();
  const origin = useSyncExternalStore(subscribeNoop, getOrigin, getServerOrigin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoDuration, setGeoDuration] = useState<number>(
    GEO_DEFAULT_DURATION_SEC
  );
  const [hostPlaying, setHostPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!state) {
    return null;
  }

  const joinUrl = origin ? `${origin}/join?code=${state.code}` : "";

  // The host's pick lives on the server, so everyone in the lobby (and the
  // public games list) sees the same selection.
  const selected = state.gameType;

  const notEnough = state.players.length < 2;

  function pickGame(gameType: GameType) {
    setError(null);
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
        await startGeoGame(geoDuration, hostPlaying);
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
              <div className="flex gap-2">
                {GEO_DURATION_OPTIONS_SEC.map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setGeoDuration(sec)}
                    className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-all ${
                      geoDuration === sec
                        ? "border-fuchsia-400 bg-fuchsia-400/15"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/40">
                5 locations · guess by distance. Needs a Google Maps key.
              </p>

              <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <input
                  type="checkbox"
                  checked={hostPlaying}
                  onChange={(e) => setHostPlaying(e.target.checked)}
                  className="h-5 w-5 accent-fuchsia-500"
                />
                <span className="text-sm">
                  <span className="font-semibold">I&apos;m playing too</span>
                  <span className="block text-xs text-white/40">
                    Guess from this device. Off = you run the screen and stay off
                    the scoreboard.
                  </span>
                </span>
              </label>
            </div>
          )}

          <Button
            onClick={start}
            disabled={busy || notEnough}
            className="w-full max-w-sm"
          >
            {notEnough
              ? "Waiting for players…"
              : selected === "geo_guessr"
                ? "Start Real GeoGuessr →"
                : "Start Photo Guessr →"}
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
