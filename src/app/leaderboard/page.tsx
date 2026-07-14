"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  supabase,
  supabaseConfigured,
  type RecentGame,
  type SeasonRow,
  type TypeSeasonRow,
} from "@/lib/supabaseClient";
import { GAME_TYPE_LABELS, type GameType } from "@/shared/types";
import { Avatar } from "@/components/ui";

type Tab = "overall" | GameType;

const TABS: { id: Tab; label: string }[] = [
  { id: "overall", label: "Overall" },
  { id: "photo_guessr", label: GAME_TYPE_LABELS.photo_guessr },
  { id: "geo_guessr", label: GAME_TYPE_LABELS.geo_guessr },
];

function gameTypeLabel(type: string): string {
  return GAME_TYPE_LABELS[type as GameType] ?? type;
}

const medals = ["🥇", "🥈", "🥉"];

export default function LeaderboardPage() {
  const [season, setSeason] = useState<SeasonRow[] | null>(null);
  const [byType, setByType] = useState<TypeSeasonRow[] | null>(null);
  const [recent, setRecent] = useState<RecentGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Start "loading" only when Supabase is configured; otherwise there is
  // nothing to fetch, so the page renders its unconfigured state immediately.
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [tab, setTab] = useState<Tab>("overall");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase) {
      return;
    }
    let active = true;
    (async () => {
      const [
        { data: seasonData, error: seasonErr },
        { data: byTypeData, error: byTypeErr },
        { data: gamesData },
      ] = await Promise.all([
        supabase.from("season_leaderboard").select("*").limit(100),
        supabase.from("season_leaderboard_by_type").select("*").limit(200),
        supabase
          .from("games")
          .select(
            "id,code,game_type,host_name,player_count,round_count,finished_at,game_players(name,color,score,placement)"
          )
          .eq("status", "finished")
          .order("finished_at", { ascending: false })
          .limit(20),
      ]);
      if (!active) {
        return;
      }
      if (seasonErr || byTypeErr) {
        setError((seasonErr ?? byTypeErr)?.message ?? null);
      }
      setSeason((seasonData as SeasonRow[]) ?? []);
      setByType((byTypeData as TypeSeasonRow[]) ?? []);
      setRecent((gamesData as RecentGame[]) ?? []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Rows for the active tab, sorted appropriately.
  const rows = useMemo<SeasonRow[]>(() => {
    if (tab === "overall") {
      // Fair across scoring scales: wins, then games, then total.
      return [...(season ?? [])].sort(
        (a, b) =>
          b.wins - a.wins ||
          b.games_played - a.games_played ||
          b.total_score - a.total_score
      );
    }
    return [...(byType ?? [])]
      .filter((r) => r.game_type === tab)
      .sort((a, b) => b.total_score - a.total_score);
  }, [tab, season, byType]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

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
        All-time standings — overall and by game.
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

      {!loading && supabaseConfigured && (
        <>
          {/* Tabs */}
          <div className="mt-8 flex gap-2 rounded-xl bg-white/5 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
                  tab === t.id
                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="card mt-6 p-6 text-center text-white/60">
              {tab === "overall"
                ? "No games played yet. Host one and the standings will show up here!"
                : `No ${gameTypeLabel(tab)} games played yet.`}
            </div>
          ) : (
            <div className="mt-6">
              {/* Column headers (desktop) */}
              <div className="hidden px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-white/40 sm:flex sm:items-center sm:gap-3">
                <span className="w-8 text-center">#</span>
                <span className="flex-1">Player</span>
                <span className="w-12 text-right">Games</span>
                <span className="w-10 text-right">Wins</span>
                <span className="w-14 text-right">Avg</span>
                <span className="w-16 text-right">Best</span>
                <span className="w-20 text-right">Total</span>
              </div>

              <ol className="space-y-2">
                {rows.map((row, i) => (
                  <li
                    key={row.name + i}
                    className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3"
                  >
                    <span className="w-8 text-center text-lg font-black text-white/60">
                      {medals[i] ?? i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {row.name}
                      </span>
                      <span className="text-xs text-white/40 sm:hidden">
                        {row.games_played}g · {row.wins}🏆 · avg {row.avg_score}{" "}
                        · best {row.best_score}
                      </span>
                    </div>
                    <span className="hidden w-12 text-right font-mono text-sm text-white/70 sm:inline">
                      {row.games_played}
                    </span>
                    <span className="hidden w-10 text-right font-mono text-sm text-white/70 sm:inline">
                      {row.wins}
                    </span>
                    <span className="hidden w-14 text-right font-mono text-sm text-white/70 sm:inline">
                      {row.avg_score}
                    </span>
                    <span className="hidden w-16 text-right font-mono text-sm text-white/70 sm:inline">
                      {row.best_score}
                    </span>
                    <span className="w-20 text-right font-mono text-lg font-bold text-fuchsia-300">
                      {row.total_score.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {recent && recent.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
            Recent games
          </h2>
          <ul className="space-y-2">
            {recent.map((g) => {
              const isOpen = expanded.has(g.id);
              const standings = [...g.game_players].sort(
                (a, b) => (a.placement ?? 99) - (b.placement ?? 99)
              );
              const winner = standings.find((p) => p.placement === 1);
              return (
                <li
                  key={g.id}
                  className="overflow-hidden rounded-xl bg-white/5"
                >
                  <button
                    onClick={() => toggle(g.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-white/5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-xs font-semibold text-fuchsia-200">
                        {gameTypeLabel(g.game_type)}
                      </span>
                      <span className="truncate text-white/70">
                        <span className="font-mono font-bold text-white/90">
                          {g.code}
                        </span>{" "}
                        · {g.player_count}p · {g.round_count}r
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-white/60">
                      {winner ? `🏆 ${winner.name}` : "—"}
                      <span className="text-white/30">{isOpen ? "▴" : "▾"}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/10 px-4 py-3">
                      {g.finished_at && (
                        <p className="mb-2 text-xs text-white/40">
                          {new Date(g.finished_at).toLocaleString()}
                        </p>
                      )}
                      <ol className="space-y-1.5">
                        {standings.map((p, i) => (
                          <li
                            key={p.name + i}
                            className="flex items-center gap-3 text-sm"
                          >
                            <span className="w-6 text-center font-black text-white/50">
                              {medals[(p.placement ?? i + 1) - 1] ??
                                p.placement ??
                                i + 1}
                            </span>
                            <Avatar name={p.name} color={p.color} size={24} />
                            <span className="flex-1 truncate">{p.name}</span>
                            <span className="font-mono font-bold text-fuchsia-300">
                              {p.score.toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
