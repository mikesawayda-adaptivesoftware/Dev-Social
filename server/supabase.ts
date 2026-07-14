import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hashPin, verifyPin } from "./pins";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseEnabled = Boolean(url && serviceKey);

/**
 * Service-role client used by the trusted game server only. It bypasses RLS,
 * so it must never be exposed to the browser. When credentials are absent the
 * app keeps working fully in-memory (local-first), just without persistence.
 */
const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const PHOTO_BUCKET = "photos";

/**
 * Upload a base64 data URL to Supabase Storage and return its public URL.
 * Returns null when Supabase isn't configured or on failure, so callers can
 * fall back to keeping the data URL in memory.
 */
export async function uploadPhoto(
  code: string,
  photoId: string,
  dataUrl: string
): Promise<string | null> {
  if (!supabase) {
    return null;
  }
  try {
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      return null;
    }
    const contentType = match[1];
    const ext = contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const buffer = Buffer.from(match[2], "base64");
    const path = `${code}/${photoId}.${ext}`;
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      console.error("Photo upload failed:", error.message);
      return null;
    }
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.error("Photo upload error:", err);
    return null;
  }
}

export interface FinishedGame {
  code: string;
  gameType: string;
  hostName: string;
  roundCount: number;
  players: {
    name: string;
    color: string;
    score: number;
    placement: number;
    isHost: boolean;
  }[];
  // For geo_guessr: the curated location ids shown this game, recorded per
  // competitor so future games can avoid repeating them.
  geoLocationIds?: string[];
}

/** Persist a completed game and its players for the season leaderboard. */
export async function persistFinishedGame(game: FinishedGame): Promise<void> {
  if (!supabase) {
    return;
  }
  try {
    const { data: gameRow, error: gameErr } = await supabase
      .from("games")
      .insert({
        code: game.code,
        game_type: game.gameType,
        host_name: game.hostName,
        status: "finished",
        player_count: game.players.length,
        round_count: game.roundCount,
        finished_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (gameErr || !gameRow) {
      console.error("Failed to persist game:", gameErr?.message);
      return;
    }
    const rows = game.players.map((p) => ({
      game_id: gameRow.id,
      name: p.name,
      color: p.color,
      score: p.score,
      placement: p.placement,
      is_host: p.isHost,
    }));
    const { error: playersErr } = await supabase
      .from("game_players")
      .insert(rows);
    if (playersErr) {
      console.error("Failed to persist players:", playersErr.message);
    }

    // Record which locations each competitor saw (geo games only) so future
    // games can steer away from repeats.
    if (game.gameType === "geo_guessr" && game.geoLocationIds?.length) {
      const nameKeys = game.players.map((p) => p.name);
      await recordSeenLocations(nameKeys, game.geoLocationIds);
    }
  } catch (err) {
    console.error("persistFinishedGame error:", err);
  }
}

// ---- Name + PIN identity ("claim the name") ----

/** Normalize a name to its identity key, matching the SQL `lower(btrim(name))`. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export type ClaimResult = { ok: true } | { ok: false; reason: string };

const NAME_TAKEN =
  "That name is taken — enter its PIN or pick another name.";

/**
 * Claim a name on first use (storing a hashed PIN) or verify the PIN on later
 * use. Returns ok:false with a user-facing reason when the PIN doesn't match.
 *
 * When Supabase isn't configured we bypass enforcement entirely — there's no
 * persisted leaderboard to protect in local mode.
 */
export async function claimOrVerifyName(
  name: string,
  pin: string
): Promise<ClaimResult> {
  if (!supabase) {
    return { ok: true };
  }
  const key = nameKey(name);
  const display = name.trim().slice(0, 20);
  try {
    const existing = await supabase
      .from("players")
      .select("pin_hash")
      .eq("name_key", key)
      .maybeSingle();

    if (existing.data) {
      const matches = await verifyPin(pin, existing.data.pin_hash);
      if (!matches) {
        return { ok: false, reason: NAME_TAKEN };
      }
      await supabase
        .from("players")
        .update({ display_name: display, last_seen_at: new Date().toISOString() })
        .eq("name_key", key);
      return { ok: true };
    }

    // Unclaimed: attempt to claim it. A unique-violation means someone claimed
    // it in the race between our select and insert, so fall through to verify.
    const pinHash = await hashPin(pin);
    const insert = await supabase
      .from("players")
      .insert({ name_key: key, display_name: display, pin_hash: pinHash });

    if (!insert.error) {
      return { ok: true };
    }

    const raced = await supabase
      .from("players")
      .select("pin_hash")
      .eq("name_key", key)
      .maybeSingle();
    if (raced.data) {
      const matches = await verifyPin(pin, raced.data.pin_hash);
      return matches ? { ok: true } : { ok: false, reason: NAME_TAKEN };
    }
    console.error("claimOrVerifyName insert failed:", insert.error.message);
    return { ok: false, reason: "Couldn't verify your name. Try again." };
  } catch (err) {
    console.error("claimOrVerifyName error:", err);
    return { ok: false, reason: "Couldn't verify your name. Try again." };
  }
}

/**
 * Whether a name is already claimed. Powers the live "new vs taken" hint on the
 * join/host forms. Never returns PIN data. Returns false in local mode.
 */
export async function isNameClaimed(name: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }
  const key = nameKey(name);
  if (!key) {
    return false;
  }
  try {
    const { data } = await supabase
      .from("players")
      .select("name_key")
      .eq("name_key", key)
      .maybeSingle();
    return Boolean(data);
  } catch (err) {
    console.error("isNameClaimed error:", err);
    return false;
  }
}

// ---- Per-player GeoGuessr location history ----

/**
 * Record that each of the given players (by name) has now seen each of the given
 * location ids. Upserts so re-seeing a location just refreshes last_seen_at.
 * No-op in local mode.
 */
export async function recordSeenLocations(
  names: string[],
  locationIds: string[]
): Promise<void> {
  if (!supabase || names.length === 0 || locationIds.length === 0) {
    return;
  }
  const now = new Date().toISOString();
  const keys = [...new Set(names.map(nameKey).filter(Boolean))];
  const rows = keys.flatMap((name_key) =>
    locationIds.map((location_id) => ({ name_key, location_id, last_seen_at: now }))
  );
  if (rows.length === 0) {
    return;
  }
  try {
    const { error } = await supabase
      .from("player_locations_seen")
      .upsert(rows, { onConflict: "name_key,location_id" });
    if (error) {
      console.error("recordSeenLocations failed:", error.message);
    }
  } catch (err) {
    console.error("recordSeenLocations error:", err);
  }
}

/**
 * For the given players (by name), return how many of them have already seen
 * each location id. Powers the soft "prefer unseen" ordering at game start.
 * Returns an empty map in local mode (so selection stays purely random).
 */
export async function getSeenCounts(
  names: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!supabase || names.length === 0) {
    return counts;
  }
  const keys = [...new Set(names.map(nameKey).filter(Boolean))];
  if (keys.length === 0) {
    return counts;
  }
  try {
    const { data, error } = await supabase
      .from("player_locations_seen")
      .select("location_id")
      .in("name_key", keys);
    if (error) {
      console.error("getSeenCounts failed:", error.message);
      return counts;
    }
    for (const row of data ?? []) {
      const id = (row as { location_id: string }).location_id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    console.error("getSeenCounts error:", err);
    return counts;
  }
}
