"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  supabase,
  supabaseConfigured,
  type RecentGame,
  type SeasonRow,
} from "@/lib/supabaseClient";

export default function LeaderboardPage() {
  const [season, setSeason] = useState<SeasonRow[] | null>(null);
  const [recent, setRecent] = useState<RecentGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const [{ data: seasonData, error: seasonErr }, { data: gamesData }] =
        await Promise.all([
          supabase
            .from("season_leaderboard")
            .select("*")
            .order("total_score", { ascending: false })
            .limit(50),
          supabase
            .from("games")
            .select(
              "id,code,host_name,player_count,round_count,finished_at,game_players(name,score,placement)"
            )
            .eq("status", "finished")
            .order("finished_at", { ascending: false })
            .limit(8),
        ]);
      if (!active) {
        return;
      }
      if (seasonErr) {
        setError(seasonErr.message);
      }
      setSeason((seasonData as SeasonRow[]) ?? []);
      setRecent((gamesData as RecentGame[]) ?? []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
      <Link
        href="/"
        className="mb-6 inline-block text-sm text-white/50 hover:text-white"
      >
        ← Back
      </Link>
      <h1 className="text-4xl font-black">
        🏆 Season{" "}
        <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
          Leaderboard
        </span>
      </h1>
      <p className="mt-2 text-white/60">
        All-time points across every happy hour game.
      </p>

      {!supabaseConfigured && (
        <div className="card mt-8 p-6 text-center text-amber-200/90">
          Supabase isn&apos;t configured yet. Add your keys to{" "}
          <code className="text-white">.env.local</code> to start tracking the
          season.
        </div>
      )}

      {loading && supabaseConfigured && (
        <div className="mt-10 flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-fuchsia-400" />
        </div>
      )}

      {error && (
        <p className="mt-6 text-center text-sm text-red-300">{error}</p>
      )}

      {!loading && supabaseConfigured && season && season.length === 0 && (
        <div className="card mt-8 p-6 text-center text-white/60">
          No games played yet. Host one and the standings will show up here!
        </div>
      )}

      {season && season.length > 0 && (
        <ol className="mt-8 space-y-2">
          {season.map((row, i) => (
            <li
              key={row.name + i}
              className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3"
            >
              <span className="w-8 text-center text-lg font-black text-white/60">
                {medals[i] ?? i + 1}
              </span>
              <span className="flex-1 truncate font-semibold">{row.name}</span>
              <span className="hidden text-xs text-white/40 sm:inline">
                {row.games_played} games · {row.wins} 🏆
              </span>
              <span className="font-mono text-lg font-bold text-fuchsia-300">
                {row.total_score}
              </span>
            </li>
          ))}
        </ol>
      )}

      {recent && recent.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
            Recent games
          </h2>
          <ul className="space-y-2">
            {recent.map((g) => {
              const winner = g.game_players.find((p) => p.placement === 1);
              return (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-sm"
                >
                  <span className="text-white/70">
                    <span className="font-mono font-bold text-white/90">
                      {g.code}
                    </span>{" "}
                    · {g.player_count} players · {g.round_count} rounds
                  </span>
                  <span className="text-white/60">
                    {winner ? `🏆 ${winner.name}` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
