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
  // Same idea for word_chain: the seeded puzzle ids played this game.
  wordPuzzleIds?: string[];
  // …and for draw_it: the words that actually got drawn.
  drawWordIds?: string[];
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

    // Record which content each competitor saw so future games can steer away
    // from repeats.
    const nameKeys = game.players.map((p) => p.name);
    if (game.gameType === "geo_guessr" && game.geoLocationIds?.length) {
      await recordSeenLocations(nameKeys, game.geoLocationIds);
    }
    if (game.gameType === "word_chain" && game.wordPuzzleIds?.length) {
      await recordSeenPuzzles(nameKeys, game.wordPuzzleIds);
    }
    if (game.gameType === "draw_it" && game.drawWordIds?.length) {
      await recordSeenDrawWords(nameKeys, game.drawWordIds);
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

// ---- Per-player content history ----
//
// Both GeoGuessr and Word Chain draw from a fixed bank and want to avoid
// re-dealing content a player has already had. The two tables are the same
// shape — (name_key, <content id>, last_seen_at) — so the read and write live
// here once and each game just names its table and id column.

interface SeenTable {
  table: string;
  idColumn: string;
}

const SEEN_LOCATIONS: SeenTable = {
  table: "player_locations_seen",
  idColumn: "location_id",
};

const SEEN_PUZZLES: SeenTable = {
  table: "player_word_chains_seen",
  idColumn: "puzzle_id",
};

const SEEN_DRAW_WORDS: SeenTable = {
  table: "player_draw_words_seen",
  idColumn: "word_id",
};

/**
 * Record that each of the given players (by name) has now seen each of the
 * given content ids. Upserts, so re-seeing something just refreshes
 * last_seen_at. No-op in local mode.
 */
async function recordSeen(
  { table, idColumn }: SeenTable,
  names: string[],
  ids: string[]
): Promise<void> {
  if (!supabase || names.length === 0 || ids.length === 0) {
    return;
  }
  const now = new Date().toISOString();
  const keys = [...new Set(names.map(nameKey).filter(Boolean))];
  const rows = keys.flatMap((name_key) =>
    ids.map((id) => ({ name_key, [idColumn]: id, last_seen_at: now }))
  );
  if (rows.length === 0) {
    return;
  }
  try {
    const { error } = await supabase
      .from(table)
      .upsert(rows, { onConflict: `name_key,${idColumn}` });
    if (error) {
      console.error(`recordSeen(${table}) failed:`, error.message);
    }
  } catch (err) {
    console.error(`recordSeen(${table}) error:`, err);
  }
}

/**
 * For the given players (by name), how many of them have already seen each
 * content id. Drives the "prefer unseen" selection at game start. Returns an
 * empty map in local mode, so selection there stays purely random.
 */
async function getSeen(
  { table, idColumn }: SeenTable,
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
      .from(table)
      .select(idColumn)
      .in("name_key", keys);
    if (error) {
      console.error(`getSeen(${table}) failed:`, error.message);
      return counts;
    }
    // `select()` with a column name the compiler can't see through gives up on
    // the row type, so name it ourselves.
    for (const row of (data ?? []) as unknown as Record<string, string>[]) {
      const id = row[idColumn];
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    console.error(`getSeen(${table}) error:`, err);
    return counts;
  }
}

/** GeoGuessr: which curated locations these players have already been shown. */
export function getSeenCounts(names: string[]): Promise<Map<string, number>> {
  return getSeen(SEEN_LOCATIONS, names);
}

export function recordSeenLocations(
  names: string[],
  locationIds: string[]
): Promise<void> {
  return recordSeen(SEEN_LOCATIONS, names, locationIds);
}

/** Word Chain: which seeded puzzles these players have already been dealt. */
export function getSeenPuzzleCounts(
  names: string[]
): Promise<Map<string, number>> {
  return getSeen(SEEN_PUZZLES, names);
}

export function recordSeenPuzzles(
  names: string[],
  puzzleIds: string[]
): Promise<void> {
  return recordSeen(SEEN_PUZZLES, names, puzzleIds);
}

/** Draw It: which words these players have already been dealt. */
export function getSeenDrawCounts(
  names: string[]
): Promise<Map<string, number>> {
  return getSeen(SEEN_DRAW_WORDS, names);
}

export function recordSeenDrawWords(
  names: string[],
  wordIds: string[]
): Promise<void> {
  return recordSeen(SEEN_DRAW_WORDS, names, wordIds);
}
