"use client";

import { useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Avatar, Button } from "@/components/ui";
import { Leaderboard } from "../shared";
import { ChainColumn, ChainLink, ChainWordTile } from "./ChainBoard";

function formatTime(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const secs = ms / 1000;
  return secs < 60
    ? `${secs.toFixed(1)}s`
    : `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
}

export function WordChainReveal() {
  const { state, isHost, me, nextRound } = useGame();
  const [busy, setBusy] = useState(false);
  const reveal = state?.wordReveal;

  if (!state || !reveal) {
    return null;
  }

  const myResult = reveal.results.find((r) => r.playerId === me?.id);
  const lastIndex = reveal.words.length - 1;

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6">
      <p className="text-center text-sm uppercase tracking-[0.3em] text-fuchsia-300/80">
        The chain
      </p>

      <div className="card mt-4 p-4">
        <ChainColumn>
          {reveal.words.map((word, i) => (
            <div key={i}>
              {i > 0 && <ChainLink />}
              <ChainWordTile
                word={word}
                tone={i === 0 || i === lastIndex ? "given" : "answer"}
              />
            </div>
          ))}
        </ChainColumn>
      </div>

      {myResult && (
        <p className="mt-5 text-center">
          {myResult.finished ? (
            <span className="text-2xl font-black text-emerald-400">
              Solved in {formatTime(myResult.timeMs)} · +
              {myResult.points.toLocaleString()}
            </span>
          ) : (
            <span className="text-xl font-bold text-amber-300">
              {myResult.solved}/{myResult.total} links · +
              {myResult.points.toLocaleString()}
            </span>
          )}
        </p>
      )}

      <div className="card mt-6 p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          This puzzle
        </h3>
        <ol className="space-y-2">
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
                <span className="text-right text-xs text-white/50">
                  {r.finished ? formatTime(r.timeMs) : `${r.solved}/${r.total}`}
                  {r.hintsUsed > 0 && (
                    <span className="block text-white/35">
                      💡 {r.hintsUsed}
                    </span>
                  )}
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
            See final results 🏆
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
