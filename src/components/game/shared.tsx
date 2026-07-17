"use client";

import type { PublicPlayer } from "@/shared/types";
import { Avatar } from "@/components/ui";

/**
 * Roster chips. Rooms hold up to MAX_PLAYERS_PER_ROOM, and a hundred chips is a
 * wall of noise that buries the join link, so past `maxVisible` this collapses
 * to a count. The viewer is always shown even if they joined 80th — "am I in?"
 * is the one question this list has to answer.
 */
export function PlayerList({
  players,
  highlightId,
  maxVisible = 24,
}: {
  players: PublicPlayer[];
  highlightId?: string;
  maxVisible?: number;
}) {
  const overflow = Math.max(0, players.length - maxVisible);
  let visible = players;
  if (overflow > 0) {
    visible = players.slice(0, maxVisible);
    if (highlightId && !visible.some((p) => p.id === highlightId)) {
      const me = players.find((p) => p.id === highlightId);
      if (me) {
        visible = [...visible.slice(0, maxVisible - 1), me];
      }
    }
  }

  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {visible.map((p) => (
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
      {overflow > 0 && (
        <li className="flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white/50">
          +{overflow} more
        </li>
      )}
    </ul>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

function LeaderboardRow({
  player,
  rank,
  isMe,
  compact,
}: {
  player: PublicPlayer;
  rank: number; // 1-based
  isMe: boolean;
  compact: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${
        isMe ? "bg-fuchsia-400/15 ring-1 ring-fuchsia-400/40" : "bg-white/5"
      }`}
    >
      <span className="w-7 text-center text-lg font-black text-white/60">
        {MEDALS[rank - 1] ?? rank}
      </span>
      <Avatar name={player.name} color={player.color} size={compact ? 28 : 36} />
      <span className="flex-1 truncate font-semibold">{player.name}</span>
      <span className="font-mono text-lg font-bold text-fuchsia-300">
        {player.score}
      </span>
    </li>
  );
}

/**
 * Windowed scoreboard: the top `maxRows`, plus the viewer's own row if they
 * didn't make the cut. A hundred rows is a scroll marathon on a phone, and the
 * two things anyone wants are who's winning and where they landed.
 */
export function Leaderboard({
  players,
  meId,
  compact = false,
  maxRows = 10,
}: {
  players: PublicPlayer[];
  meId?: string;
  compact?: boolean;
  maxRows?: number;
}) {
  const ranked = [...players]
    .filter((p) => !p.spectator)
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, maxRows);
  const myRank = meId ? ranked.findIndex((p) => p.id === meId) : -1;
  const meBelowCut = myRank >= maxRows ? ranked[myRank] : null;

  return (
    <ol className="space-y-2">
      {top.map((p, i) => (
        <LeaderboardRow
          key={p.id}
          player={p}
          rank={i + 1}
          isMe={p.id === meId}
          compact={compact}
        />
      ))}
      {meBelowCut && (
        <>
          <li
            aria-hidden
            className="py-1 text-center text-lg leading-none tracking-widest text-white/30"
          >
            ···
          </li>
          <LeaderboardRow
            player={meBelowCut}
            rank={myRank + 1}
            isMe
            compact={compact}
          />
        </>
      )}
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
