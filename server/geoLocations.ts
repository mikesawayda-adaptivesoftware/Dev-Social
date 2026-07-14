// Curated pool of worldwide locations for the Real GeoGuessr game.
//
// Each game draws `geoRoundCount` of these at random. Coordinates point at
// recognizable, Street-View-covered spots. A panorama id (`panoId`) is what the
// client actually renders — we never send the answer coordinates to the browser
// until reveal (see server/rooms.ts + the anti-cheat note in the README).
//
// `panoId` may be pre-baked here (run `node scripts/resolvePanos.mjs` to fill
// them in). If it's missing, the server resolves it once at game start via the
// free Street View metadata API using GOOGLE_MAPS_API_KEY (or, if unrestricted,
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) and caches the result in memory.

export interface GeoLocation {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Optional pre-resolved Street View panorama id. */
  panoId?: string;
}

export const GEO_LOCATIONS: GeoLocation[] = [
  { id: "eiffel", lat: 48.8584, lng: 2.2945, label: "Eiffel Tower, Paris, France" },
  { id: "colosseum", lat: 41.8902, lng: 12.4922, label: "Colosseum, Rome, Italy" },
  { id: "times-square", lat: 40.758, lng: -73.9855, label: "Times Square, New York, USA" },
  { id: "sydney-opera", lat: -33.8568, lng: 151.2153, label: "Sydney Opera House, Australia" },
  { id: "brandenburg", lat: 52.5163, lng: 13.3777, label: "Brandenburg Gate, Berlin, Germany" },
  { id: "big-ben", lat: 51.5007, lng: -0.1246, label: "Big Ben, London, England" },
  { id: "trafalgar", lat: 51.508, lng: -0.1281, label: "Trafalgar Square, London, England" },
  { id: "shibuya", lat: 35.6595, lng: 139.7005, label: "Shibuya Crossing, Tokyo, Japan" },
  { id: "golden-gate", lat: 37.8199, lng: -122.4783, label: "Golden Gate Bridge, San Francisco, USA" },
  { id: "hollywood", lat: 34.1341, lng: -118.3215, label: "Hollywood Sign viewpoint, Los Angeles, USA" },
  { id: "sagrada", lat: 41.4036, lng: 2.1744, label: "Sagrada Família, Barcelona, Spain" },
  { id: "brandenburg2", lat: 40.4319, lng: 116.5704, label: "Great Wall at Mutianyu, China" },
  { id: "taj-mahal", lat: 27.1751, lng: 78.0421, label: "Taj Mahal, Agra, India" },
  { id: "christ-redeemer", lat: -22.9519, lng: -43.2105, label: "Christ the Redeemer, Rio de Janeiro, Brazil" },
  { id: "machu-picchu", lat: -13.1631, lng: -72.5450, label: "Machu Picchu, Peru" },
  { id: "table-mountain", lat: -33.9628, lng: 18.4098, label: "Cape Town waterfront, South Africa" },
  { id: "red-square", lat: 55.7539, lng: 37.6208, label: "Red Square, Moscow, Russia" },
  { id: "petronas", lat: 3.1578, lng: 101.7117, label: "Petronas Towers, Kuala Lumpur, Malaysia" },
  { id: "marina-bay", lat: 1.2834, lng: 103.8607, label: "Marina Bay, Singapore" },
  { id: "dubai-burj", lat: 25.1972, lng: 55.2744, label: "Burj Khalifa, Dubai, UAE" },
  { id: "acropolis", lat: 37.9715, lng: 23.7257, label: "Acropolis, Athens, Greece" },
  { id: "pisa", lat: 43.7229, lng: 11.5, label: "Leaning Tower of Pisa, Italy" },
  { id: "amsterdam-canal", lat: 52.3667, lng: 4.8945, label: "Amsterdam canals, Netherlands" },
  { id: "venice", lat: 45.4340, lng: 12.3388, label: "St. Mark's Square, Venice, Italy" },
  { id: "prague", lat: 50.0870, lng: 14.4207, label: "Old Town Square, Prague, Czechia" },
  { id: "reykjavik", lat: 64.1466, lng: -21.9426, label: "Reykjavík, Iceland" },
  { id: "cn-tower", lat: 43.6426, lng: -79.3871, label: "CN Tower, Toronto, Canada" },
  { id: "chichen-itza", lat: 20.6829, lng: -88.5686, label: "Chichén Itzá, Mexico" },
  { id: "santorini", lat: 36.4618, lng: 25.3753, label: "Oia, Santorini, Greece" },
  { id: "queenstown", lat: -45.0312, lng: 168.6626, label: "Queenstown, New Zealand" },
  { id: "wall-street", lat: 40.7069, lng: -74.0113, label: "Wall Street, New York, USA" },
  { id: "vegas-strip", lat: 36.1147, lng: -115.1728, label: "The Strip, Las Vegas, USA" },
  { id: "chicago-bean", lat: 41.8827, lng: -87.6233, label: "Cloud Gate, Chicago, USA" },
  { id: "seattle-needle", lat: 47.6205, lng: -122.3493, label: "Space Needle, Seattle, USA" },
  { id: "hawaii-waikiki", lat: 21.2793, lng: -157.8293, label: "Waikiki Beach, Honolulu, USA" },
  { id: "buenos-aires", lat: -34.6037, lng: -58.3816, label: "Plaza de Mayo, Buenos Aires, Argentina" },
  { id: "mexico-city", lat: 19.4326, lng: -99.1332, label: "Zócalo, Mexico City, Mexico" },
  { id: "bangkok", lat: 13.7510, lng: 100.4927, label: "Grand Palace, Bangkok, Thailand" },
  { id: "hong-kong", lat: 22.2940, lng: 114.1722, label: "Victoria Harbour, Hong Kong" },
  { id: "seoul", lat: 37.5700, lng: 126.9769, label: "Gyeongbokgung, Seoul, South Korea" },
  { id: "istanbul", lat: 41.0086, lng: 28.9802, label: "Hagia Sophia, Istanbul, Turkey" },
  { id: "cairo-pyramids", lat: 29.9765, lng: 31.1313, label: "Giza Pyramids, Egypt" },
  { id: "marrakech", lat: 31.6258, lng: -7.9891, label: "Jemaa el-Fnaa, Marrakech, Morocco" },
  { id: "lisbon", lat: 38.7139, lng: -9.1334, label: "Praça do Comércio, Lisbon, Portugal" },
  { id: "vienna", lat: 48.2060, lng: 16.3626, label: "St. Stephen's, Vienna, Austria" },
  { id: "copenhagen", lat: 55.6797, lng: 12.5913, label: "Nyhavn, Copenhagen, Denmark" },
  { id: "stockholm", lat: 59.3251, lng: 18.0711, label: "Gamla Stan, Stockholm, Sweden" },
  { id: "dublin", lat: 53.3441, lng: -6.2675, label: "Temple Bar, Dublin, Ireland" },
  { id: "edinburgh", lat: 55.9486, lng: -3.1999, label: "Royal Mile, Edinburgh, Scotland" },
  { id: "san-diego", lat: 32.7157, lng: -117.1611, label: "Gaslamp Quarter, San Diego, USA" },
  { id: "new-orleans", lat: 29.9584, lng: -90.0644, label: "French Quarter, New Orleans, USA" },
  { id: "miami-beach", lat: 25.7907, lng: -80.1300, label: "Ocean Drive, Miami Beach, USA" },
  { id: "cape-town-camps", lat: -33.9509, lng: 18.3776, label: "Camps Bay, Cape Town, South Africa" },
  { id: "nairobi", lat: -1.2864, lng: 36.8172, label: "Nairobi city center, Kenya" },
  { id: "melbourne", lat: -37.8183, lng: 144.9671, label: "Federation Square, Melbourne, Australia" },
  { id: "wellington", lat: -41.2865, lng: 174.7762, label: "Wellington waterfront, New Zealand" },
  { id: "vancouver", lat: 49.2827, lng: -123.1207, label: "Downtown Vancouver, Canada" },
  { id: "montreal", lat: 45.5017, lng: -73.5673, label: "Old Montreal, Canada" },
  { id: "helsinki", lat: 60.1699, lng: 24.9509, label: "Senate Square, Helsinki, Finland" },
  { id: "oslo", lat: 59.9139, lng: 10.7522, label: "Oslo city center, Norway" },
  { id: "louvre", lat: 48.8606, lng: 2.3376, label: "Louvre Museum, Paris, France" },
  { id: "arc-triomphe", lat: 48.8738, lng: 2.295, label: "Arc de Triomphe, Paris, France" },
  { id: "trevi", lat: 41.9009, lng: 12.4833, label: "Trevi Fountain, Rome, Italy" },
  { id: "st-peters", lat: 41.9022, lng: 12.4568, label: "St. Peter's Square, Vatican City" },
  { id: "florence-duomo", lat: 43.7731, lng: 11.256, label: "Florence Cathedral, Italy" },
  { id: "milan-duomo", lat: 45.4642, lng: 9.1919, label: "Piazza del Duomo, Milan, Italy" },
  { id: "puerta-del-sol", lat: 40.4169, lng: -3.7035, label: "Puerta del Sol, Madrid, Spain" },
  { id: "seville-plaza", lat: 37.3772, lng: -5.9869, label: "Plaza de España, Seville, Spain" },
  { id: "porto-ribeira", lat: 41.1408, lng: -8.6112, label: "Ribeira, Porto, Portugal" },
  { id: "tower-bridge", lat: 51.5055, lng: -0.0754, label: "Tower Bridge, London, England" },
  { id: "piccadilly", lat: 51.51, lng: -0.1345, label: "Piccadilly Circus, London, England" },
  { id: "grand-place", lat: 50.8467, lng: 4.3524, label: "Grand-Place, Brussels, Belgium" },
  { id: "bruges-markt", lat: 51.2085, lng: 3.2247, label: "Markt Square, Bruges, Belgium" },
  { id: "zurich-old", lat: 47.3701, lng: 8.5426, label: "Old Town, Zürich, Switzerland" },
  { id: "lucerne", lat: 47.0517, lng: 8.3093, label: "Chapel Bridge, Lucerne, Switzerland" },
  { id: "warsaw-old", lat: 52.2497, lng: 21.0122, label: "Old Town Market, Warsaw, Poland" },
  { id: "krakow-rynek", lat: 50.0617, lng: 19.9373, label: "Main Square, Kraków, Poland" },
  { id: "budapest-chain", lat: 47.4979, lng: 19.0438, label: "Chain Bridge, Budapest, Hungary" },
  { id: "tallinn-old", lat: 59.437, lng: 24.7454, label: "Old Town, Tallinn, Estonia" },
  { id: "dubrovnik", lat: 42.6407, lng: 18.1077, label: "Old Town, Dubrovnik, Croatia" },
  { id: "ljubljana", lat: 46.0511, lng: 14.5061, label: "Prešeren Square, Ljubljana, Slovenia" },
  { id: "tokyo-tower", lat: 35.6586, lng: 139.7454, label: "Tokyo Tower, Japan" },
  { id: "osaka-dotonbori", lat: 34.6687, lng: 135.5031, label: "Dōtonbori, Osaka, Japan" },
  { id: "taipei-101", lat: 25.0339, lng: 121.5645, label: "Taipei 101, Taiwan" },
  { id: "india-gate", lat: 28.6129, lng: 77.2295, label: "India Gate, New Delhi, India" },
  { id: "gateway-india", lat: 18.922, lng: 72.8347, label: "Gateway of India, Mumbai, India" },
  { id: "tel-aviv", lat: 32.0809, lng: 34.7806, label: "Rothschild Blvd, Tel Aviv, Israel" },
  { id: "doha-corniche", lat: 25.3, lng: 51.5333, label: "Corniche, Doha, Qatar" },
  { id: "boston-common", lat: 42.3551, lng: -71.0657, label: "Boston Common, Boston, USA" },
  { id: "dc-lincoln", lat: 38.8893, lng: -77.0502, label: "Lincoln Memorial, Washington, D.C., USA" },
  { id: "philly-liberty", lat: 39.9496, lng: -75.15, label: "Independence Hall, Philadelphia, USA" },
  { id: "nashville-broadway", lat: 36.1601, lng: -86.7785, label: "Broadway, Nashville, USA" },
  { id: "austin-congress", lat: 30.2669, lng: -97.7428, label: "Congress Avenue, Austin, USA" },
  { id: "denver-lodo", lat: 39.7525, lng: -104.9995, label: "Union Station, Denver, USA" },
  { id: "ottawa-parliament", lat: 45.4236, lng: -75.7009, label: "Parliament Hill, Ottawa, Canada" },
  { id: "quebec-city", lat: 46.8123, lng: -71.2059, label: "Château Frontenac, Québec City, Canada" },
  { id: "santiago-chile", lat: -33.4372, lng: -70.6506, label: "Plaza de Armas, Santiago, Chile" },
  { id: "bogota", lat: 4.5981, lng: -74.0758, label: "La Candelaria, Bogotá, Colombia" },
  { id: "cartagena", lat: 10.4236, lng: -75.5493, label: "Old City, Cartagena, Colombia" },
  { id: "montevideo", lat: -34.9055, lng: -56.1988, label: "Plaza Independencia, Montevideo, Uruguay" },
  { id: "casablanca", lat: 33.6084, lng: -7.6325, label: "Hassan II Mosque, Casablanca, Morocco" },
  { id: "brisbane", lat: -27.4705, lng: 153.026, label: "South Bank, Brisbane, Australia" },
  { id: "perth", lat: -31.9559, lng: 115.8606, label: "Elizabeth Quay, Perth, Australia" },
  { id: "auckland", lat: -36.8446, lng: 174.7676, label: "Viaduct Harbour, Auckland, New Zealand" },
];

interface ResolvedPano {
  panoId: string;
  lat: number;
  lng: number;
}

function serverMapsKey(): string | undefined {
  // A dedicated, unrestricted server key is preferred. As a convenience we fall
  // back to the public browser key, which only works server-side if it has no
  // HTTP-referrer restriction.
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    undefined
  );
}

export function geoMapsConfigured(): boolean {
  return Boolean(serverMapsKey());
}

/**
 * Resolve a location to a Street View panorama id (+ the panorama's actual
 * coordinates, used as the scoring answer). Uses the free metadata endpoint and
 * caches the result on the location so each spot is only looked up once per
 * server lifetime. Returns null if nothing usable is found or no key is set.
 */
export async function resolvePano(
  loc: GeoLocation,
  radiusMeters = 150
): Promise<ResolvedPano | null> {
  if (loc.panoId) {
    return { panoId: loc.panoId, lat: loc.lat, lng: loc.lng };
  }
  const key = serverMapsKey();
  if (!key) {
    return null;
  }
  const url =
    `https://maps.googleapis.com/maps/api/streetview/metadata` +
    `?location=${loc.lat},${loc.lng}&radius=${radiusMeters}&source=outdoor&key=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as {
      status: string;
      pano_id?: string;
      location?: { lat: number; lng: number };
    };
    if (data.status !== "OK" || !data.pano_id || !data.location) {
      return null;
    }
    loc.panoId = data.pano_id; // cache for the rest of the server's lifetime
    return {
      panoId: data.pano_id,
      lat: data.location.lat,
      lng: data.location.lng,
    };
  } catch {
    return null;
  }
}
