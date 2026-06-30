"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Avatar, Button } from "@/components/ui";
import { Confetti } from "@/components/Confetti";
import { Leaderboard } from "./shared";

export function Final() {
  const { state, isHost, me, playAgain } = useGame();
  const [busy, setBusy] = useState(false);

  const ranked = useMemo(
    () => [...(state?.players ?? [])].sort((a, b) => b.score - a.score),
    [state]
  );

  if (!state) {
    return null;
  }

  const champion = ranked[0];
  const iWon = champion?.id === me?.id;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 text-center">
      <Confetti />
      <p className="text-sm uppercase tracking-[0.3em] text-fuchsia-300/80">
        Game over
      </p>
      <h1 className="mt-2 text-4xl font-black sm:text-5xl">
        🏆 {champion?.name} wins!
      </h1>
      {!isHost && (
        <p className="mt-3 text-lg text-white/70">
          {iWon ? "That's you — champion of the happy hour! 🎉" : "GG! Better luck next round."}
        </p>
      )}

      {champion && (
        <div className="mt-8 flex flex-col items-center">
          <Avatar name={champion.name} color={champion.color} size={96} />
          <p className="mt-3 font-mono text-3xl font-black text-fuchsia-300">
            {champion.score} pts
          </p>
        </div>
      )}

      <div className="card mt-8 p-6 text-left">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          Final standings
        </h3>
        <Leaderboard players={state.players} meId={me?.id} />
      </div>

      {isHost && (
        <div className="mt-8">
          <Button
            onClick={async () => {
              setBusy(true);
              try {
                await playAgain();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="w-full max-w-sm"
          >
            Play again (new photos) ↻
          </Button>
        </div>
      )}

      <Link
        href="/leaderboard"
        className="mt-6 inline-block text-sm font-medium text-fuchsia-300/90 hover:text-fuchsia-200"
      >
        🏆 View season leaderboard →
      </Link>
    </div>
  );
}
