"use client";

import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

// Loads the Google Maps JavaScript API exactly once for the whole app. The
// browser key is public by design (restrict it by HTTP referrer in the Google
// Cloud Console). Used by the Real GeoGuessr game to render Street View + the
// interactive guess/reveal maps.

export const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// AdvancedMarkerElement requires the map to be created with a Map ID. Set
// NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID to a cloud-configured Map ID for production
// styling; otherwise fall back to Google's DEMO_MAP_ID (fine for dev/local).
export const GOOGLE_MAPS_MAP_ID =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

export const googleMapsConfigured = Boolean(GOOGLE_MAPS_API_KEY);

let loaderPromise: Promise<typeof google.maps> | null = null;

/**
 * Resolve the `google.maps` namespace, loading the API on first call and
 * reusing the same promise thereafter. Rejects if no key is configured.
 */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (!googleMapsConfigured) {
    return Promise.reject(
      new Error(
        "Google Maps API key is not configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)."
      )
    );
  }
  return (loaderPromise ??= (async () => {
    setOptions({ key: GOOGLE_MAPS_API_KEY, v: "weekly" });
    // Load the libraries the GeoGuessr UI needs; this also populates the global
    // `google.maps` namespace used throughout the geo components.
    await Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
      importLibrary("streetView"),
    ]);
    return google.maps;
  })());
}
