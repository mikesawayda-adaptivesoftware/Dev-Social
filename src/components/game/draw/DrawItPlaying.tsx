"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { useCountdown } from "@/lib/useCountdown";
import { Avatar } from "@/components/ui";
import { DRAW_COLORS, DRAW_WIDTHS } from "@/shared/types";
import { DrawCanvas } from "./DrawCanvas";
import { DrawItBigScreen } from "./DrawItBigScreen";

export function DrawItPlaying() {
  const {
    state,
    pickDrawWord,
    sendDrawStroke,
    undoDrawStroke,
    clearDrawCanvas,
    submitDrawGuess,
  } = useGame();
  const draw = state?.drawRound;
  const picking = state?.phase === "picking";

  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(0);
  const [guess, setGuess] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const totalMs = picking
    ? 0
    : (state?.settings.roundDurationSec ?? 0) * 1000;
  const { secondsLeft, fraction } = useCountdown(draw?.endsAt, totalMs);

  if (!state || !draw) {
    return null;
  }

  if (draw.spectating) {
    return <DrawItBigScreen />;
  }

  const drawerName =
    state.players.find((p) => p.id === draw.drawerId)?.name ?? "Someone";
  const timerColor =
    fraction > 0.5 ? "#4ade80" : fraction > 0.25 ? "#facc15" : "#f87171";

  // --- Choosing a word ---------------------------------------------------
  if (picking) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-5 py-10 text-center">
        {draw.iAmDrawer && draw.wordChoices ? (
          <>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-fuchsia-300/80">
                Your turn to draw
              </p>
              <h1 className="mt-2 text-2xl font-black">Pick a word</h1>
            </div>
            <div className="flex w-full flex-col gap-3">
              {draw.wordChoices.map((word) => (
                <button
                  key={word}
                  onClick={() => pickDrawWord(word).catch(() => {})}
                  className="rounded-2xl border-2 border-white/15 bg-white/5 px-4 py-4 text-lg font-bold transition-all hover:border-fuchsia-400 hover:bg-fuchsia-400/10"
                >
                  {word}
                </button>
              ))}
            </div>
            <p className="text-sm text-white/40">
              {secondsLeft}s — we&apos;ll pick the first one for you
            </p>
          </>
        ) : (
          <>
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/15 border-t-fuchsia-400" />
            <p className="text-lg font-semibold">
              {drawerName} is picking a word…
            </p>
            <p className="text-sm text-white/45">Get your typing fingers ready.</p>
          </>
        )}
      </div>
    );
  }

  // --- Drawing / guessing ------------------------------------------------
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text || busy) {
      return;
    }
    setBusy(true);
    try {
      const res = await submitDrawGuess(text);
      setGuess("");
      setNote(res.correct ? null : null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 px-4 py-4">
      {/* Word, clock, progress */}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-lg font-black tracking-[0.35em] text-white">
          {draw.iAmDrawer ? draw.word : draw.wordMask}
        </span>
        <span className="flex items-center gap-2 text-sm">
          <span className="text-white/50">
            {draw.solvedCount}/{draw.guessCount}
          </span>
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-black"
            style={{ backgroundColor: timerColor, color: "#000" }}
          >
            {secondsLeft}
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-100 ease-linear"
          style={{ width: `${fraction * 100}%`, backgroundColor: timerColor }}
        />
      </div>

      <DrawCanvas
        strokes={draw.strokes}
        onSegment={draw.iAmDrawer ? sendDrawStroke : undefined}
        color={color}
        width={width}
        className="aspect-square w-full rounded-2xl border border-white/15 bg-[#0f0d1f]"
      />

      {draw.iAmDrawer ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            {DRAW_COLORS.map((hex, i) => (
              <button
                key={hex}
                onClick={() => setColor(i)}
                aria-label={`Colour ${i + 1}`}
                className={`h-8 flex-1 rounded-lg border-2 transition-transform ${
                  color === i
                    ? "border-white scale-110"
                    : "border-white/15 hover:border-white/40"
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {DRAW_WIDTHS.map((w, i) => (
              <button
                key={w}
                onClick={() => setWidth(i)}
                aria-label={i === 0 ? "Thin brush" : "Thick brush"}
                className={`flex h-10 flex-1 items-center justify-center rounded-xl border-2 ${
                  width === i
                    ? "border-fuchsia-400 bg-fuchsia-400/15"
                    : "border-white/15 bg-white/5"
                }`}
              >
                <span
                  className="rounded-full bg-white"
                  style={{ width: w / 2, height: w / 2 }}
                />
              </button>
            ))}
            <button
              onClick={() => undoDrawStroke().catch(() => {})}
              className="h-10 flex-1 rounded-xl border-2 border-white/15 bg-white/5 text-sm font-semibold hover:bg-white/10"
            >
              Undo
            </button>
            <button
              onClick={() => clearDrawCanvas().catch(() => {})}
              className="h-10 flex-1 rounded-xl border-2 border-white/15 bg-white/5 text-sm font-semibold hover:bg-white/10"
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={send} className="flex gap-2">
          <input
            value={guess}
            onChange={(e) => {
              setGuess(e.target.value);
              setNote(null);
            }}
            disabled={draw.iGuessed}
            maxLength={60}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Your guess"
            placeholder={draw.iGuessed ? "You got it! 🎉" : "Type your guess…"}
            className="min-w-0 flex-1 rounded-xl bg-black/30 px-4 py-3 text-base text-white outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-fuchsia-400 disabled:text-emerald-300"
          />
          <button
            type="submit"
            disabled={busy || draw.iGuessed || !guess.trim()}
            className="shrink-0 rounded-xl bg-fuchsia-500 px-5 font-bold text-white hover:bg-fuchsia-400 disabled:opacity-40"
          >
            →
          </button>
        </form>
      )}

      {note && <p className="text-center text-sm text-amber-300">{note}</p>}

      <GuessLog />
    </div>
  );
}

/**
 * The guess feed. Wrong answers scroll past verbatim — they're most of the
 * comedy — while a correct one is announced without the word, or the first
 * person to get it would hand it to everyone else.
 */
function GuessLog() {
  const { state, me } = useGame();
  const draw = state?.drawRound;
  const endRef = useRef<HTMLDivElement>(null);
  const count = draw?.chat.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [count]);

  if (!state || !draw) {
    return null;
  }

  return (
    <div className="card flex max-h-44 min-h-24 flex-col gap-1.5 overflow-y-auto p-3">
      {draw.chat.length === 0 ? (
        <p className="m-auto text-sm text-white/30">Guesses show up here</p>
      ) : (
        draw.chat.map((line) => {
          const player = state.players.find((p) => p.id === line.playerId);
          if (!player) {
            return null;
          }
          return (
            <div key={line.id} className="flex items-center gap-2 text-sm">
              <Avatar name={player.name} color={player.color} size={20} />
              <span className="shrink-0 font-semibold text-white/70">
                {player.name}
              </span>
              {line.solved ? (
                <span className="font-semibold text-emerald-300">
                  got it! {line.playerId === me?.id && "🎉"}
                </span>
              ) : (
                <span className="min-w-0 truncate text-white/60">
                  {line.text}
                </span>
              )}
            </div>
          );
        })
      )}
      <div ref={endRef} />
    </div>
  );
}
