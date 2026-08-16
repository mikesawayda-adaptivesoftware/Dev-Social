"use client";

import { useGame } from "@/components/GameProvider";
import { useCountdown } from "@/lib/useCountdown";
import { Avatar } from "@/components/ui";
import { WORD_CHAIN_DIFFICULTY_LABELS } from "@/shared/types";

/**
 * What the room looks at while everyone solves on their phones.
 *
 * The host's phone-shaped view was the same board with the input taken out,
 * which reads as a broken player screen rather than a scoreboard. This is the
 * other half of the format the rest of the app is built for: the puzzle big
 * enough to read across a room, and the race as lanes that visibly fill.
 *
 * It never shows an answer. The spectator has no progress of their own, so the
 * server sends them the same untouched blanks it sends a player who has solved
 * nothing — the reveal is still the reveal.
 */
export function WordChainBigScreen() {
  const { state } = useGame();
  const word = state?.wordRound;
  const totalMs = (state?.settings.roundDurationSec ?? 0) * 1000;
  const { secondsLeft, fraction } = useCountdown(word?.endsAt, totalMs);

  if (!state || !word) {
    return null;
  }

  const total = word.blanks.length;
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const ranked = [...word.standings].sort(
    (a, b) =>
      Number(b.finished) - Number(a.finished) ||
      b.solved - a.solved ||
      (byId.get(a.playerId)?.name ?? "").localeCompare(
        byId.get(b.playerId)?.name ?? ""
      )
  );
  // A hundred lanes is a wall, and the back of the field isn't the story.
  const LANES = 10;
  const lanes = ranked.slice(0, LANES);
  const overflow = ranked.length - lanes.length;
  const done = ranked.filter((s) => s.finished).length;

  const timerColor =
    fraction > 0.5 ? "#4ade80" : fraction > 0.25 ? "#facc15" : "#f87171";

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-6 lg:flex-row lg:gap-10 lg:px-10">
      {/* The puzzle, readable across a room */}
      <section className="flex flex-col items-center lg:w-2/5">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">
          Word Chain · {WORD_CHAIN_DIFFICULTY_LABELS[word.difficulty]}
        </p>
        {/* Tiles shrink as the chain grows: a marathon chain is seventeen of
            them, and a TV is only so tall. Still far larger than the phone. */}
        <div
          className={`mt-4 flex w-full max-w-sm flex-col ${
            total > 8 ? "gap-1" : "gap-2"
          }`}
        >
          <BigTile text={word.startWord} given size={total} />
          {word.blanks.map((blank, i) => (
            <BigTile
              key={i}
              size={total}
              text={
                blank.revealed +
                "•".repeat(Math.max(0, blank.length - blank.revealed.length))
              }
            />
          ))}
          <BigTile text={word.endWord} given size={total} />
        </div>
      </section>

      {/* Clock + the race */}
      <section className="flex flex-1 flex-col">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-black sm:text-3xl">
            {done > 0 ? `${done} finished` : "Everyone's solving…"}
          </h2>
          <span
            className="font-mono text-4xl font-black tabular-nums sm:text-5xl"
            style={{ color: timerColor }}
          >
            {secondsLeft}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-100 ease-linear"
            style={{ width: `${fraction * 100}%`, backgroundColor: timerColor }}
          />
        </div>

        <ol className="mt-5 flex flex-col gap-2.5">
          {lanes.map((standing, rank) => {
            const player = byId.get(standing.playerId);
            if (!player) {
              return null;
            }
            return (
              <li key={standing.playerId} className="flex items-center gap-3">
                <span className="w-6 text-right font-mono text-sm font-bold text-white/35">
                  {rank + 1}
                </span>
                <Avatar name={player.name} color={player.color} size={32} />
                <span className="w-28 truncate text-lg font-semibold sm:w-40">
                  {player.name}
                </span>
                {/* One segment per link, so progress is countable at a glance
                    rather than a bar you have to estimate — until there are so
                    many that the segments are thinner than the gaps between
                    them, at which point a plain bar reads better. */}
                {total <= 10 ? (
                  <span className="flex flex-1 gap-1.5">
                    {Array.from({ length: total }, (_, i) => (
                      <span
                        key={i}
                        className={`h-4 flex-1 rounded-full transition-colors duration-300 ${
                          i < standing.solved ? "" : "bg-white/10"
                        }`}
                        style={
                          i < standing.solved
                            ? { backgroundColor: player.color }
                            : undefined
                        }
                      />
                    ))}
                  </span>
                ) : (
                  <span className="h-4 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${(standing.solved / total) * 100}%`,
                        backgroundColor: player.color,
                      }}
                    />
                  </span>
                )}
                <span className="w-16 text-right font-mono text-sm font-bold">
                  {standing.finished ? (
                    <span className="text-emerald-300">done</span>
                  ) : (
                    <span className="text-white/50">
                      {standing.solved}/{total}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {overflow > 0 && (
          <p className="mt-3 text-sm text-white/35">+{overflow} more playing</p>
        )}
      </section>
    </div>
  );
}

function BigTile({
  text,
  given = false,
  size,
}: {
  text: string;
  given?: boolean;
  /** Blanks in the chain — the more there are, the smaller each tile gets. */
  size: number;
}) {
  // Tuned so the tallest chain still fits a 1280x800 screen without scrolling —
  // nobody is going to scroll the TV.
  const scale =
    size > 12
      ? "py-0.5 text-base sm:text-lg"
      : size > 8
        ? "py-1.5 text-lg sm:text-xl"
        : "py-3 text-2xl sm:text-3xl";
  return (
    <div
      className={`rounded-xl border-2 text-center font-mono font-black tracking-[0.25em] ${scale} ${
        given
          ? "border-white/25 bg-white/10 text-white"
          : "border-dashed border-white/15 text-white/30"
      }`}
    >
      {text}
    </div>
  );
}
