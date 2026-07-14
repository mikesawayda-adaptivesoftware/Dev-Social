"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Avatar, Button } from "@/components/ui";
import { Leaderboard } from "../shared";
import {
  loadGoogleMaps,
  googleMapsConfigured,
  GOOGLE_MAPS_MAP_ID,
} from "@/lib/googleMaps";
import type { GeoResult, PublicPlayer } from "@/shared/types";

function formatDistance(km: number | null): string {
  if (km === null) {
    return "no guess";
  }
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  if (km < 100) {
    return `${km.toFixed(1)} km`;
  }
  return `${Math.round(km).toLocaleString()} km`;
}

/** Map showing the true location plus every player's pin, joined by lines. */
function ResultMap({
  answer,
  results,
  players,
  className = "",
}: {
  answer: { lat: number; lng: number; label: string };
  results: GeoResult[];
  players: PublicPlayer[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !ref.current) {
          return;
        }
        const map = new maps.Map(ref.current, {
          center: answer,
          zoom: 2,
          mapId: GOOGLE_MAPS_MAP_ID,
          disableDefaultUI: true,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
        });
        const bounds = new maps.LatLngBounds();

        // True location: a distinct red pin with a star glyph.
        const answerMarker = new maps.marker.AdvancedMarkerElement({
          map,
          position: answer,
          title: answer.label,
          zIndex: 1000,
          content: new maps.marker.PinElement({
            glyph: "★",
            glyphColor: "#fff",
            background: "#ea4335",
            borderColor: "#b31412",
          }).element,
        });
        cleanups.push(() => {
          answerMarker.map = null;
        });
        bounds.extend(answer);

        for (const r of results) {
          if (!r.guess) {
            continue;
          }
          const color =
            players.find((p) => p.id === r.playerId)?.color ?? "#ffffff";
          // A colored circle matching the player's color.
          const dot = document.createElement("div");
          dot.style.width = "16px";
          dot.style.height = "16px";
          dot.style.borderRadius = "50%";
          dot.style.background = color;
          dot.style.border = "1.5px solid #000";
          const marker = new maps.marker.AdvancedMarkerElement({
            map,
            position: r.guess,
            content: dot,
          });
          cleanups.push(() => {
            marker.map = null;
          });
          const line = new maps.Polyline({
            map,
            path: [r.guess, answer],
            geodesic: true,
            strokeColor: color,
            strokeOpacity: 0.7,
            strokeWeight: 2,
          });
          cleanups.push(() => {
            line.setMap(null);
          });
          bounds.extend(r.guess);
        }

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, 60);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load the map.");
        }
      });
    return () => {
      cancelled = true;
      for (const c of cleanups) {
        c();
      }
    };
  }, [answer, results, players]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-black/40 p-6 text-center text-sm text-white/60 ${className}`}
      >
        {error}
      </div>
    );
  }

  return <div ref={ref} className={className} />;
}

export function GeoReveal() {
  const { state, isHost, me, nextRound } = useGame();
  const [busy, setBusy] = useState(false);
  const geo = state?.geoReveal;

  const ranked = useMemo(
    () =>
      geo
        ? [...geo.results].sort((a, b) => b.points - a.points)
        : [],
    [geo]
  );
  const myResult = useMemo(
    () => geo?.results.find((r) => r.playerId === me?.id),
    [geo, me]
  );

  if (!state || !geo) {
    return null;
  }

  const isLast = geo.index + 1 >= geo.total;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6">
      <p className="text-center text-sm text-white/50">
        Round {geo.index + 1} / {geo.total}
      </p>
      <h1 className="mt-1 text-center text-2xl font-black sm:text-3xl">
        📍 {geo.answer.label}
      </h1>

      {googleMapsConfigured && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
          <ResultMap
            answer={geo.answer}
            results={geo.results}
            players={state.players}
            className="h-64 w-full sm:h-80"
          />
        </div>
      )}

      {!me?.spectator && (
        <div className="mt-5 text-center">
          {myResult?.guess ? (
            <p className="text-2xl font-black text-emerald-400">
              {formatDistance(myResult.distanceKm)} away · +{myResult.points}
            </p>
          ) : (
            <p className="text-xl font-bold text-red-300">
              No guess in time — 0 points!
            </p>
          )}
        </div>
      )}

      <div className="card mt-6 p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          This round
        </h3>
        <ol className="space-y-2">
          {ranked.map((r) => {
            const p = state.players.find((pl) => pl.id === r.playerId);
            if (!p) {
              return null;
            }
            return (
              <li
                key={r.playerId}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                  r.playerId === me?.id
                    ? "bg-fuchsia-400/15 ring-1 ring-fuchsia-400/40"
                    : "bg-white/5"
                }`}
              >
                <Avatar name={p.name} color={p.color} size={28} />
                <span className="flex-1 truncate font-semibold">{p.name}</span>
                <span className="text-sm text-white/50">
                  {formatDistance(r.distanceKm)}
                </span>
                <span className="w-16 text-right font-mono font-bold text-fuchsia-300">
                  +{r.points}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="card mt-6 p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          Scoreboard
        </h3>
        <Leaderboard players={state.players} meId={me?.id} compact />
      </div>

      {isHost ? (
        <div className="mt-8 text-center">
          <Button
            onClick={async () => {
              setBusy(true);
              try {
                await nextRound();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="w-full max-w-sm"
          >
            {isLast ? "See final results 🏆" : "Next location →"}
          </Button>
        </div>
      ) : (
        <p className="mt-8 text-center text-white/50">
          Waiting for the host to continue…
        </p>
      )}
    </div>
  );
}
