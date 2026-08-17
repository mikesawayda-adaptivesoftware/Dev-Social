"use client";

import Link from "next/link";
import { useResumableSeats } from "@/lib/useResumableSeats";
import { GAME_TYPE_LABELS, type GamePhase } from "@/shared/types";

const PHASE_BLURB: Record<GamePhase, string> = {
  lobby: "waiting in the lobby",
  submission: "collecting photos",
  picking: "picking a word",
  playing: "in progress",
  reveal: "between rounds",
  final: "showing the results",
};

/**
 * "You're still in a game" — shown on the landing page when this browser holds
 * a seat the server still recognises.
 *
 * The whole point is to be seen *before* the Host button. Someone whose phone
 * dropped a game has no way of knowing it's still running, so they host a
 * second one; that's how the same person ended up with two live games. Linking
 * to the room rather than rejoining here keeps one rejoin path in the app — the
 * room page's existing prompt does the work.
 */
export function ResumeSeats() {
  const { seats, forget } = useResumableSeats();

  if (seats.length === 0) {
    return null;
  }

  return (
    <section className="card mb-6 space-y-3 p-5 text-left">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white/60">
        {seats.length > 1 ? "You're still in these games" : "You're still in a game"}
      </h2>
      <ul className="space-y-2">
        {seats.map((seat) => (
          <li
            key={seat.code}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2">
                <span className="font-mono font-bold tracking-widest text-white">
                  {seat.code}
                </span>
                <span className="truncate text-sm text-white/60">
                  {GAME_TYPE_LABELS[seat.gameType]}
                </span>
              </p>
              <p className="truncate text-xs text-white/40">
                as {seat.name}
                {seat.isHost && " 👑"} · {seat.playerCount} playing ·{" "}
                {PHASE_BLURB[seat.phase]}
              </p>
            </div>
            <Link
              href={`/room/${seat.code}`}
              className="shrink-0 rounded-full bg-fuchsia-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-fuchsia-400"
            >
              Jump back in
            </Link>
            <button
              onClick={() => forget(seat.code)}
              aria-label={`Forget game ${seat.code}`}
              className="shrink-0 px-1 text-white/30 hover:text-white/70"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
