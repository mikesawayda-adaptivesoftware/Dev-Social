// One-time authoring helper: resolve each curated GeoGuessr location to a
// Street View panorama id and print a ready-to-paste `GEO_LOCATIONS` array with
// `panoId` baked in. Baking pano ids means the game server never needs to hit
// the metadata API at runtime (and can use a referrer-restricted key only).
//
// Usage:
//   GOOGLE_MAPS_API_KEY=... npx tsx scripts/resolvePanos.ts
//   # (or put GOOGLE_MAPS_API_KEY in .env.local)
//
// Then copy the printed array back into server/geoLocations.ts.

import "../server/loadEnv";
import { GEO_LOCATIONS, resolvePano } from "../server/geoLocations";

async function main() {
  const key =
    process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.error(
      "Missing GOOGLE_MAPS_API_KEY (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY). " +
        "For server-side calls, use a key WITHOUT an HTTP-referrer restriction."
    );
    process.exit(1);
  }

  const out: string[] = [];
  let ok = 0;
  let failed = 0;

  for (const loc of GEO_LOCATIONS) {
    // Clear any cached id so we always re-resolve from the source coords.
    const fresh = { ...loc, panoId: undefined };
    const resolved = await resolvePano(fresh);
    if (resolved) {
      ok += 1;
      out.push(
        `  { id: ${JSON.stringify(loc.id)}, lat: ${resolved.lat}, ` +
          `lng: ${resolved.lng}, label: ${JSON.stringify(loc.label)}, ` +
          `panoId: ${JSON.stringify(resolved.panoId)} },`
      );
      console.error(`OK   ${loc.label}`);
    } else {
      failed += 1;
      out.push(
        `  { id: ${JSON.stringify(loc.id)}, lat: ${loc.lat}, ` +
          `lng: ${loc.lng}, label: ${JSON.stringify(loc.label)} }, // UNRESOLVED`
      );
      console.error(`MISS ${loc.label}`);
    }
    // Be gentle with the API.
    await new Promise((r) => setTimeout(r, 60));
  }

  console.error(`\nResolved ${ok}/${GEO_LOCATIONS.length} (${failed} missing).\n`);
  console.log("export const GEO_LOCATIONS: GeoLocation[] = [");
  console.log(out.join("\n"));
  console.log("];");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
