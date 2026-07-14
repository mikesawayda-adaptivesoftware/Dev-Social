"use client";

import { useState } from "react";
import { useGame } from "@/components/GameProvider";
import { useCountdown } from "@/lib/useCountdown";
import { googleMapsConfigured } from "@/lib/googleMaps";
import { StreetViewPano } from "./StreetViewPano";
import { GuessMap } from "./GuessMap";

export function GeoPlaying() {
  const { state, submitGeoGuess } = useGame();
  const [expanded, setExpanded] = useState(false);
  const geo = state?.geoRound;
  const totalMs = (state?.settings.roundDurationSec ?? 0) * 1000;
  const { secondsLeft, fraction } = useCountdown(geo?.endsAt, totalMs);

  if (!state || !geo) {
    return null;
  }

  const timerColor =
    fraction > 0.5 ? "#4ade80" : fraction > 0.25 ? "#facc15" : "#f87171";

  if (!googleMapsConfigured) {
    return (
      <div className="mx-auto w-full max-w-lg px-5 py-16 text-center">
        <h1 className="text-2xl font-black">🗺️ Street View unavailable</h1>
        <p className="mt-3 text-white/60">
          The Google Maps key isn&apos;t configured in this build
          (<code className="text-white/80">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>).
          See the README for setup.
        </p>
      </div>
    );
  }

  const header = (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
      <div className="mx-auto flex max-w-3xl items-center justify-between text-sm text-white">
        <span className="rounded-full bg-black/50 px-3 py-1 font-semibold backdrop-blur">
          Round {geo.index + 1} / {geo.total}
        </span>
        <span className="rounded-full bg-black/50 px-3 py-1 backdrop-blur">
          {geo.answeredCount}/{geo.guessCount} locked in
        </span>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-base font-black shadow-lg"
          style={{ backgroundColor: timerColor, color: "#000" }}
        >
          {secondsLeft}
        </span>
      </div>
      <div className="mx-auto mt-2 h-1.5 max-w-3xl overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full transition-[width] duration-100 ease-linear"
          style={{ width: `${fraction * 100}%`, backgroundColor: timerColor }}
        />
      </div>
    </div>
  );

  // Spectators (e.g. a host running the big screen) watch the panorama + live
  // status, but don't guess.
  if (geo.spectating) {
    return (
      <div className="relative flex-1 overflow-hidden">
        {header}
        <StreetViewPano panoId={geo.panoId} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 text-center">
          <span className="rounded-full bg-black/60 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
            Everyone: explore on your phone and drop your pin! 📍
          </span>
        </div>
      </div>
    );
  }

  // Player: full-screen Street View with an expandable corner guess map.
  return (
    <div className="relative flex-1 overflow-hidden">
      {header}
      <StreetViewPano panoId={geo.panoId} className="absolute inset-0" />

      <div
        className={`absolute bottom-3 right-3 z-30 flex flex-col rounded-2xl border border-white/20 bg-black/70 p-2 shadow-2xl backdrop-blur transition-all ${
          expanded
            ? "left-3 top-16 sm:left-auto sm:h-[70%] sm:w-[420px]"
            : "h-52 w-52 sm:h-64 sm:w-64"
        }`}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mb-2 shrink-0 self-end rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
        >
          {expanded ? "Shrink map ▾" : "Expand map ▴"}
        </button>
        <div className="min-h-0 flex-1">
          <GuessMap
            onSubmit={submitGeoGuess}
            locked={geo.iGuessed}
            lockedGuess={geo.myGuess}
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}
