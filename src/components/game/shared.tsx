"use client";

import type { PublicPlayer } from "@/shared/types";
import { Avatar } from "@/components/ui";

export function PlayerList({
  players,
  highlightId,
}: {
  players: PublicPlayer[];
  highlightId?: string;
}) {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {players.map((p) => (
        <li
          key={p.id}
          className={`animate-pop flex items-center gap-2 rounded-full border px-3 py-1.5 ${
            p.id === highlightId
              ? "border-fuchsia-400 bg-fuchsia-400/10"
              : "border-white/10 bg-white/5"
          } ${p.connected ? "" : "opacity-40"}`}
        >
          <Avatar name={p.name} color={p.color} size={24} />
          <span className="text-sm font-medium">{p.name}</span>
          {p.isHost && <span className="text-xs">👑</span>}
        </li>
      ))}
    </ul>
  );
}

export function Leaderboard({
  players,
  meId,
  compact = false,
}: {
  players: PublicPlayer[];
  meId?: string;
  compact?: boolean;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <ol className="space-y-2">
      {ranked.map((p, i) => (
        <li
          key={p.id}
          className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${
            p.id === meId ? "bg-fuchsia-400/15 ring-1 ring-fuchsia-400/40" : "bg-white/5"
          }`}
        >
          <span className="w-7 text-center text-lg font-black text-white/60">
            {medals[i] ?? i + 1}
          </span>
          <Avatar name={p.name} color={p.color} size={compact ? 28 : 36} />
          <span className="flex-1 truncate font-semibold">{p.name}</span>
          <span className="font-mono text-lg font-bold text-fuchsia-300">
            {p.score}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RoomCodeBadge({ code }: { code: string }) {
  return (
    <div className="text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-white/50">
        Room code
      </p>
      <p className="font-mono text-5xl font-black tracking-[0.3em] text-white sm:text-6xl">
        {code}
      </p>
    </div>
  );
}
