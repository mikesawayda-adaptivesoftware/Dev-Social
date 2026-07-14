"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/googleMaps";

/**
 * Interactive Street View panorama rendered from a panorama id. Location hints
 * (address, road labels) are hidden so players have to actually recognize where
 * they are.
 */
export function StreetViewPano({
  panoId,
  className = "",
  interactive = true,
}: {
  panoId: string;
  className?: string;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !ref.current) {
          return;
        }
        if (!panoRef.current) {
          panoRef.current = new maps.StreetViewPanorama(ref.current, {
            pano: panoId,
            addressControl: false,
            showRoadLabels: false,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
            linksControl: interactive,
            panControl: interactive,
            zoomControl: interactive,
            clickToGo: interactive,
            disableDefaultUI: !interactive,
          });
        } else {
          panoRef.current.setPano(panoId);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load Street View.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panoId, interactive]);

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
