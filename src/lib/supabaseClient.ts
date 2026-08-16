import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DrawStroke } from "@/shared/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Browser Supabase client using the publishable/anon key. Read-only in practice:
 * RLS only grants SELECT to this role. Returns null when not configured so the
 * UI can show a friendly "not connected yet" state.
 */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: false } })
  : null;

export interface SeasonRow {
  name: string;
  games_played: number;
  total_score: number;
  best_score: number;
  wins: number;
  avg_score: number;
}

export type TypeSeasonRow = SeasonRow & { game_type: string };

/**
 * One kept drawing. `strokes` is the same shape the game renders from, so the
 * gallery re-draws it rather than showing a picture of it.
 */
export interface GalleryDrawing {
  id: string;
  word: string;
  drawer_name: string;
  drawer_color: string;
  score: number;
  solved: number;
  guessers: number;
  strokes: DrawStroke[];
  created_at: string;
}

export interface RecentGame {
  id: string;
  code: string;
  game_type: string;
  host_name: string;
  player_count: number;
  round_count: number;
  finished_at: string | null;
  game_players: {
    name: string;
    color: string;
    score: number;
    placement: number;
  }[];
}
