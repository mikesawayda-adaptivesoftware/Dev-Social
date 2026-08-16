"use client";

import type { PublicPlayer, WordChainStanding } from "@/shared/types";
import { Avatar } from "@/components/ui";

/**
 * The chain itself, drawn top to bottom. The two ends are solid tiles; the
 * blanks between them are what everyone is racing to fill.
 *
 * Deliberately dumb: it renders whatever tiles it's handed, so the playing
 * screen and the reveal share one picture of the puzzle. The only thing that
 * differs between them is which tiles are already filled in.
 */
export function ChainColumn({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-stretch gap-1.5">{children}</div>;
}

/** A word that's on the board: either an end of the chain or a solved blank. */
export function ChainWordTile({
  word,
  tone,
}: {
  word: string;
  tone: "given" | "solved" | "answer";
}) {
  const styles = {
    given: "border-white/25 bg-white/10 text-white",
    solved: "border-emerald-400/60 bg-emerald-400/15 text-emerald-100",
    answer: "border-fuchsia-400/50 bg-fuchsia-400/15 text-fuchsia-100",
  }[tone];
  return (
    <div
      className={`animate-pop rounded-xl border-2 py-2.5 text-center font-mono text-lg font-black tracking-[0.2em] ${styles}`}
    >
      {word}
    </div>
  );
}

/**
 * An unsolved blank: how many letters it has, and the prefix this player has
 * earned. Everything else is dots — the answer isn't on the client to leak.
 */
export function ChainBlankTile({
  length,
  revealed,
  dimmed = false,
}: {
  length: number;
  revealed: string;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border-2 border-dashed border-white/15 py-2.5 text-center font-mono text-lg font-black tracking-[0.2em] ${
        dimmed ? "opacity-45" : ""
      }`}
    >
      <span className="text-fuchsia-300">{revealed}</span>
      <span className="text-white/25">
        {"•".repeat(Math.max(0, length - revealed.length))}
      </span>
    </div>
  );
}

/** The join between two tiles. Purely decorative, but it's what tells a new
 * player that neighbours combine rather than just sit next to each other. */
export function ChainLink() {
  return (
    <div aria-hidden className="text-center text-xs leading-none text-white/25">
      +
    </div>
  );
}

/**
 * Live race positions. Rooms go up to 100 players, so this shows the leaders
 * plus the viewer's own row — the same bargain the round scoreboard makes.
 */
export function RaceBoard({
  standings,
  players,
  meId,
  total,
  maxRows = 8,
}: {
  standings: WordChainStanding[];
  players: PublicPlayer[];
  meId?: string;
  total: number;
  maxRows?: number;
}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ranked = [...standings].sort(
    (a, b) =>
      Number(b.finished) - Number(a.finished) ||
      b.solved - a.solved ||
      (byId.get(a.playerId)?.name ?? "").localeCompare(
        byId.get(b.playerId)?.name ?? ""
      )
  );
  const myRank = meId ? ranked.findIndex((s) => s.playerId === meId) : -1;
  const rows = ranked.slice(0, maxRows);
  const meBelowCut = myRank >= maxRows ? ranked[myRank] : null;

  const row = (standing: WordChainStanding, rank: number) => {
    const player = byId.get(standing.playerId);
    if (!player) {
      return null;
    }
    const isMe = standing.playerId === meId;
    return (
      <li
        key={standing.playerId}
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
          isMe ? "bg-fuchsia-400/15 ring-1 ring-fuchsia-400/40" : "bg-white/5"
        }`}
      >
        <span className="w-4 text-center text-xs font-bold text-white/40">
          {rank}
        </span>
        <Avatar name={player.name} color={player.color} size={22} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {player.name}
        </span>
        {standing.finished ? (
          <span className="shrink-0 rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs font-bold text-emerald-200">
            ✓ done
          </span>
        ) : (
          <span className="shrink-0 font-mono text-xs font-bold text-white/60">
            {standing.solved}/{total}
          </span>
        )}
      </li>
    );
  };

  return (
    <ol className="space-y-1">
      {rows.map((s, i) => row(s, i + 1))}
      {meBelowCut && (
        <>
          <li
            aria-hidden
            className="text-center text-xs leading-none text-white/25"
          >
            ···
          </li>
          {row(meBelowCut, myRank + 1)}
        </>
      )}
    </ol>
  );
}
