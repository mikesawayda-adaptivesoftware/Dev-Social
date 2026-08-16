"use client";

import { useGame } from "@/components/GameProvider";
import { useCountdown } from "@/lib/useCountdown";
import { Avatar } from "@/components/ui";
import { DrawCanvas } from "./DrawCanvas";

/**
 * What the room watches while someone draws.
 *
 * The spectating host is the one person here who is neither drawing nor
 * guessing, so this is the only screen that can afford to be all canvas. It
 * shows exactly what a guesser sees — the server builds a spectator's view the
 * same way it builds the view of a player who hasn't solved it, so the word is
 * masked here too and the big screen can't be read over someone's shoulder for
 * the answer.
 */
export function DrawItBigScreen() {
  const { state } = useGame();
  const draw = state?.drawRound;
  const picking = state?.phase === "picking";
  const totalMs = picking ? 0 : (state?.settings.roundDurationSec ?? 0) * 1000;
  const { secondsLeft, fraction } = useCountdown(draw?.endsAt, totalMs);

  if (!state || !draw) {
    return null;
  }

  const drawer = state.players.find((p) => p.id === draw.drawerId);
  const solvers = new Set(
    draw.chat.filter((l) => l.solved).map((l) => l.playerId)
  );
  const timerColor =
    fraction > 0.5 ? "#4ade80" : fraction > 0.25 ? "#facc15" : "#f87171";

  if (picking) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
        <Avatar
          name={drawer?.name ?? "?"}
          color={drawer?.color ?? "#a78bfa"}
          size={96}
        />
        <h1 className="text-4xl font-black sm:text-5xl">
          {drawer?.name} is picking a word
        </h1>
        <p className="text-xl text-white/50">Everyone else: get ready to guess</p>
        <span className="font-mono text-6xl font-black" style={{ color: timerColor }}>
          {secondsLeft}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-5 lg:flex-row lg:gap-8 lg:px-10">
      {/* The drawing, as large as the screen allows */}
      <section className="flex min-h-0 flex-1 items-center justify-center">
        <DrawCanvas
          strokes={draw.strokes}
          className="aspect-square max-h-full w-auto max-w-full rounded-2xl border border-white/15 bg-[#0f0d1f]"
        />
      </section>

      <section className="flex w-full flex-col gap-4 lg:w-80">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">
            {drawer?.name} is drawing
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="font-mono text-3xl font-black tracking-[0.3em]">
              {draw.wordMask}
            </span>
            <span
              className="font-mono text-4xl font-black tabular-nums"
              style={{ color: timerColor }}
            >
              {secondsLeft}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-[width] duration-100 ease-linear"
              style={{
                width: `${fraction * 100}%`,
                backgroundColor: timerColor,
              }}
            />
          </div>
        </div>

        <p className="text-lg font-semibold">
          {draw.solvedCount}
          <span className="text-white/40"> / {draw.guessCount} have it</span>
        </p>

        {/* Who's in, at a glance — the drawer is marked rather than ranked. */}
        <ul className="flex flex-wrap gap-2">
          {state.players
            .filter((p) => !p.spectator)
            .map((p) => {
              const isDrawer = p.id === draw.drawerId;
              const got = solvers.has(p.id);
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${
                    isDrawer
                      ? "bg-fuchsia-400/15 ring-1 ring-fuchsia-400/40"
                      : got
                        ? "bg-emerald-400/15 ring-1 ring-emerald-400/40"
                        : "bg-white/5"
                  }`}
                >
                  <Avatar name={p.name} color={p.color} size={22} />
                  <span className="text-sm font-medium">{p.name}</span>
                  {isDrawer && <span className="text-xs">✏️</span>}
                  {got && <span className="text-xs">✓</span>}
                </li>
              );
            })}
        </ul>

        {/* Wrong guesses, biggest and last. The comedy is here. */}
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden">
          {draw.chat.slice(-8).map((line) => {
            const player = state.players.find((p) => p.id === line.playerId);
            if (!player) {
              return null;
            }
            return (
              <p key={line.id} className="truncate text-base">
                <span className="font-semibold" style={{ color: player.color }}>
                  {player.name}
                </span>{" "}
                {line.solved ? (
                  <span className="font-semibold text-emerald-300">got it!</span>
                ) : (
                  <span className="text-white/60">{line.text}</span>
                )}
              </p>
            );
          })}
        </div>
      </section>
    </div>
  );
}
