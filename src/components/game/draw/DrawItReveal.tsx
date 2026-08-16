"use client";

import { useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Avatar, Button } from "@/components/ui";
import { Leaderboard } from "../shared";
import { DrawCanvas } from "./DrawCanvas";

function formatTime(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export function DrawItReveal() {
  const { state, isHost, me, nextRound } = useGame();
  const [busy, setBusy] = useState(false);
  const reveal = state?.drawReveal;

  if (!state || !reveal) {
    return null;
  }

  const drawer = state.players.find((p) => p.id === reveal.drawerId);
  const mine = reveal.results.find((r) => r.playerId === me?.id);
  const solved = reveal.results.filter((r) => r.correct).length;
  const isLast = reveal.index + 1 >= reveal.total;

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6">
      <p className="text-center text-xs uppercase tracking-[0.3em] text-fuchsia-300/80">
        Round {reveal.index + 1} of {reveal.total}
      </p>
      <h1 className="mt-2 text-center text-3xl font-black">{reveal.word}</h1>
      <p className="mt-1 text-center text-sm text-white/50">
        drawn by {drawer?.name ?? "someone"} · {solved}/{reveal.results.length}{" "}
        got it
      </p>

      <div className="mt-4">
        <DrawCanvas
          strokes={reveal.strokes}
          className="aspect-square w-full rounded-2xl border border-white/15 bg-[#0f0d1f]"
        />
      </div>

      {mine && (
        <p className="mt-4 text-center">
          {mine.correct ? (
            <span className="text-2xl font-black text-emerald-400">
              Got it in {formatTime(mine.timeMs)} · +
              {mine.points.toLocaleString()}
            </span>
          ) : (
            <span className="text-lg font-bold text-amber-300">
              Missed that one
            </span>
          )}
        </p>
      )}
      {me?.id === reveal.drawerId && (
        <p className="mt-4 text-center text-2xl font-black text-fuchsia-300">
          +{reveal.drawerPoints.toLocaleString()} for the drawing
        </p>
      )}

      <div className="card mt-6 p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          This round
        </h3>
        <ol className="space-y-2">
          {drawer && (
            <li className="flex items-center gap-3 rounded-xl bg-fuchsia-400/10 px-3 py-2 ring-1 ring-fuchsia-400/25">
              <Avatar name={drawer.name} color={drawer.color} size={28} />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {drawer.name}
              </span>
              <span className="text-xs text-white/50">drew it</span>
              <span className="w-16 text-right font-mono font-bold text-fuchsia-300">
                +{reveal.drawerPoints.toLocaleString()}
              </span>
            </li>
          )}
          {reveal.results.map((r) => {
            const p = state.players.find((pl) => pl.id === r.playerId);
            if (!p) {
              return null;
            }
            return (
              <li
                key={r.playerId}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                  r.playerId === me?.id
                    ? "bg-fuchsia-400/15 ring-1 ring-fuchsia-400/40"
                    : "bg-white/5"
                }`}
              >
                <Avatar name={p.name} color={p.color} size={28} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {p.name}
                </span>
                <span className="text-xs text-white/50">
                  {r.correct ? formatTime(r.timeMs) : "—"}
                </span>
                <span className="w-16 text-right font-mono font-bold text-fuchsia-300">
                  +{r.points.toLocaleString()}
                </span>
              </li>
            );
          })}
        </ol>
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
            {isLast ? "See final results 🏆" : "Next drawer →"}
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
