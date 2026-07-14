"use client";

import { useState, useSyncExternalStore } from "react";
import { useGame } from "@/components/GameProvider";
import { Button } from "@/components/ui";
import {
  GEO_DEFAULT_DURATION_SEC,
  GEO_DURATION_OPTIONS_SEC,
  type GameType,
} from "@/shared/types";
import { PlayerList, RoomCodeBadge } from "./shared";

const GAMES: { type: GameType; emoji: string; name: string; blurb: string }[] = [
  {
    type: "photo_guessr",
    emoji: "📸",
    name: "Photo Guessr",
    blurb: "Match everyone's photos to the right teammate.",
  },
  {
    type: "geo_guessr",
    emoji: "🗺️",
    name: "Real GeoGuessr",
    blurb: "Explore Street View and pin the location on a map.",
  },
];

// `window.location.origin` is client-only. Read it via useSyncExternalStore so
// SSR renders "" (getServerSnapshot) and the client the real origin, with no
// hydration mismatch and no setState-in-effect.
const subscribeNoop = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function Lobby() {
  const { state, isHost, me, startSubmission, startGeoGame } = useGame();
  const origin = useSyncExternalStore(subscribeNoop, getOrigin, getServerOrigin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GameType>("photo_guessr");
  const [geoDuration, setGeoDuration] = useState<number>(
    GEO_DEFAULT_DURATION_SEC
  );
  const [hostPlaying, setHostPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!state) {
    return null;
  }

  const joinUrl = origin ? `${origin}/join?code=${state.code}` : "";

  const notEnough = state.players.length < 2;

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
      </div>

      <div className="card mt-8 p-6">
        <h2 className="mb-4 text-lg font-bold text-white/80">
          Players ({state.players.length})
        </h2>
        <PlayerList players={state.players} highlightId={me?.id} />
      </div>

      {isHost ? (
        <div className="mt-8 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {GAMES.map((g) => (
              <button
                key={g.type}
                onClick={() => setSelected(g.type)}
                className={`rounded-2xl border-2 p-4 text-left transition-all ${
                  selected === g.type
                    ? "border-fuchsia-400 bg-fuchsia-400/15"
                    : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                <div className="text-2xl">{g.emoji}</div>
                <div className="mt-1 font-bold">{g.name}</div>
                <div className="text-xs text-white/50">{g.blurb}</div>
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
        <p className="mt-8 text-lg text-white/70">
          You&apos;re in! Waiting for the host to start…
        </p>
      )}
    </div>
  );
}
