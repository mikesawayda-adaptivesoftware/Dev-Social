"use client";

import { useMemo, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Avatar, Button } from "@/components/ui";
import { Leaderboard } from "./shared";

export function Reveal() {
  const { state, isHost, me, nextRound } = useGame();
  const [busy, setBusy] = useState(false);
  const reveal = state?.reveal;

  const owner = useMemo(
    () => state?.players.find((p) => p.id === reveal?.ownerId),
    [state, reveal]
  );
  const myResult = useMemo(
    () => reveal?.results.find((r) => r.playerId === me?.id),
    [reveal, me]
  );

  if (!state || !reveal || !owner) {
    return null;
  }

  const correctPlayers = reveal.results
    .filter((r) => r.correct)
    .map((r) => state.players.find((p) => p.id === r.playerId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const isLast = reveal.index + 1 >= reveal.total;
  const iAmOwner = owner.id === me?.id;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <p className="text-center text-sm text-white/50">
        Round {reveal.index + 1} / {reveal.total}
      </p>

      <div className="mt-3 flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={reveal.photoDataUrl}
          alt={`It was ${owner.name}`}
          className="aspect-square w-full max-w-xs rounded-2xl border-4 object-cover shadow-2xl animate-pop"
          style={{ borderColor: owner.color }}
        />
        <div className="mt-4 flex items-center gap-3 animate-pop">
          <Avatar name={owner.name} color={owner.color} size={48} />
          <p className="text-3xl font-black">
            It&apos;s {owner.name}!
          </p>
        </div>
      </div>

      {/* Personal result for non-host players */}
      {!isHost && (
        <div className="mt-5 text-center">
          {iAmOwner ? (
            <p className="text-lg text-white/70">That was your photo 😄</p>
          ) : myResult?.correct ? (
            <p className="text-2xl font-black text-emerald-400">
              Nailed it! +{myResult.points}
            </p>
          ) : (
            <p className="text-xl font-bold text-red-300">
              {myResult ? "Not quite!" : "Too slow — no guess in time!"}
            </p>
          )}
        </div>
      )}

      <div className="card mt-6 p-5">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/60">
          Got it right ({correctPlayers.length})
        </h3>
        {correctPlayers.length === 0 ? (
          <p className="text-white/50">Nobody! Sneaky photo. 🤫</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {correctPlayers.map((p) => (
              <span
                key={p.id}
                className="flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1.5 text-sm"
              >
                <Avatar name={p.name} color={p.color} size={22} />
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card mt-6 p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          Scoreboard
        </h3>
        <Leaderboard players={state.players} meId={me?.id} compact />
      </div>

      {isHost ? (
        <div className="mt-8 text-center">
          <Button
            onClick={async () => {
              setBusy(true);
              try {
                await nextRound();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="w-full max-w-sm"
          >
            {isLast ? "See final results 🏆" : "Next round →"}
          </Button>
        </div>
      ) : (
        <p className="mt-8 text-center text-white/50">
          Waiting for the host to continue…
        </p>
      )}
    </div>
  );
}
