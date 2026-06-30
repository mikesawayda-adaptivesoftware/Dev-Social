"use client";

import { useMemo, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Avatar } from "@/components/ui";
import { useCountdown } from "@/lib/useCountdown";

export function Playing() {
  const { state, isHost, submitGuess } = useGame();
  const [pending, setPending] = useState<string | null>(null);
  const round = state?.round;
  const totalMs = (state?.settings.roundDurationSec ?? 0) * 1000;
  const { secondsLeft, fraction } = useCountdown(round?.endsAt, totalMs);

  const optionPlayers = useMemo(() => {
    if (!state || !round) {
      return [];
    }
    return round.optionIds
      .map((id) => state.players.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [state, round]);

  if (!state || !round) {
    return null;
  }

  const timerColor =
    fraction > 0.5 ? "#4ade80" : fraction > 0.25 ? "#facc15" : "#f87171";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-8">
      <div className="flex w-full items-center justify-between text-sm text-white/60">
        <span className="font-semibold">
          Round {round.index + 1} / {round.total}
        </span>
        <span>
          {round.answeredCount} answered
        </span>
      </div>

      {/* Timer bar */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-100 ease-linear"
          style={{ width: `${fraction * 100}%`, backgroundColor: timerColor }}
        />
      </div>

      <h1 className="mt-6 text-center text-2xl font-black sm:text-3xl">
        Whose photo is this?
      </h1>

      <div className="relative mt-4 w-full max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={round.photoDataUrl}
          alt="Guess whose photo this is"
          className="aspect-square w-full rounded-2xl border border-white/10 object-cover shadow-2xl"
        />
        <div
          className="absolute -right-3 -top-3 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-black shadow-lg"
          style={{ backgroundColor: timerColor, color: "#000" }}
        >
          {secondsLeft}
        </div>
      </div>

      {isHost ? (
        <p className="mt-6 text-center text-white/60">
          Everyone, lock in your guess on your phone!
        </p>
      ) : round.iAmOwner ? (
        <div className="mt-6 rounded-xl bg-white/5 px-6 py-4 text-center">
          <p className="text-lg font-semibold">😎 This one&apos;s you!</p>
          <p className="text-sm text-white/60">Sit back and watch the chaos.</p>
        </div>
      ) : (
        <div className="mt-6 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
          {optionPlayers.map((p) => {
            const chosen = round.myGuess === p.id;
            const locked = Boolean(round.myGuess);
            return (
              <button
                key={p.id}
                disabled={locked || pending !== null}
                onClick={async () => {
                  setPending(p.id);
                  try {
                    await submitGuess(p.id);
                  } catch {
                    setPending(null);
                  }
                }}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-3 py-4 font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                  chosen
                    ? "border-fuchsia-400 bg-fuchsia-400/20"
                    : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                <Avatar name={p.name} color={p.color} size={44} />
                <span className="truncate text-sm">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {!isHost && !round.iAmOwner && round.myGuess && (
        <p className="mt-5 text-center text-emerald-300">
          ✓ Locked in! Waiting for the others…
        </p>
      )}
    </div>
  );
}
