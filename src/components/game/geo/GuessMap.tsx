"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, GOOGLE_MAPS_MAP_ID } from "@/lib/googleMaps";

/**
 * Interactive world map for dropping a single guess pin. The player taps the
 * map to place/move their pin, then locks it in. Once locked, the map becomes
 * read-only.
 */
export function GuessMap({
  onSubmit,
  locked,
  lockedGuess,
  className = "",
}: {
  onSubmit: (lat: number, lng: number) => Promise<void> | void;
  locked: boolean;
  lockedGuess?: { lat: number; lng: number };
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(
    null
  );
  const [selected, setSelected] = useState<{ lat: number; lng: number } | null>(
    lockedGuess ?? null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !ref.current || mapRef.current) {
          return;
        }
        const map = new maps.Map(ref.current, {
          center: { lat: 20, lng: 0 },
          zoom: 1,
          mapId: GOOGLE_MAPS_MAP_ID,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          streetViewControl: false,
          mapTypeControl: false,
        });
        mapRef.current = map;

        const placeMarker = (pos: google.maps.LatLngLiteral) => {
          if (!markerRef.current) {
            markerRef.current = new maps.marker.AdvancedMarkerElement({
              map,
              position: pos,
            });
          } else {
            markerRef.current.position = pos;
          }
        };

        if (lockedGuess) {
          placeMarker(lockedGuess);
        }

        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) {
            return;
          }
          // Read latest locked state at click time via the DOM data attribute.
          if (ref.current?.dataset.locked === "true") {
            return;
          }
          const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          placeMarker(pos);
          setSelected(pos);
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load the map.");
        }
      });
    return () => {
      cancelled = true;
    };
    // Intentionally run once; live updates handled via refs/dataset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-black/40 p-6 text-center text-sm text-white/60 ${className}`}
      >
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div
        ref={ref}
        data-locked={locked ? "true" : "false"}
        className={`min-h-0 flex-1 rounded-xl ${className}`}
      />
      <button
        disabled={!selected || locked || submitting}
        onClick={async () => {
          if (!selected) {
            return;
          }
          setSubmitting(true);
          try {
            await onSubmit(selected.lat, selected.lng);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Guess failed.");
          } finally {
            setSubmitting(false);
          }
        }}
        className="shrink-0 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {locked
          ? "✓ Guess locked in"
          : submitting
            ? "Locking in…"
            : selected
              ? "Lock in guess"
              : "Tap the map to place your pin"}
      </button>
    </div>
  );
}
