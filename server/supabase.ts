import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  } catch (err) {
    console.error("persistFinishedGame error:", err);
  }
}
