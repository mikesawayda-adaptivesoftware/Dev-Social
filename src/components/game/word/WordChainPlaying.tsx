"use client";

import { useState } from "react";
import { useGame } from "@/components/GameProvider";
import { useCountdown } from "@/lib/useCountdown";
import {
  ChainBlankTile,
  ChainColumn,
  ChainLink,
  ChainWordTile,
  RaceBoard,
} from "./ChainBoard";

export function WordChainPlaying() {
  const { state, me, submitWordGuess, revealWordHint } = useGame();
  const word = state?.wordRound;
  const totalMs = (state?.settings.roundDurationSec ?? 0) * 1000;
  const { secondsLeft, fraction } = useCountdown(word?.endsAt, totalMs);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // A wrong answer shakes the tile and leaves a note until the next keystroke.
  // Both clear themselves — the shake on its own animationend, the note on the
  // next edit — so neither needs a timer to tidy up after it.
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!state || !word) {
    return null;
  }

  const total = word.blanks.length;
  const active = word.blanks[word.activeIndex];
  const solving = !word.finished && !word.spectating && Boolean(active);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const guess = value.trim();
    if (!guess || busy || !word) {
      return;
    }
    setBusy(true);
    try {
      const res = await submitWordGuess(word.activeIndex, guess);
      if (res.correct) {
        setValue("");
        setNote(null);
      } else {
        setWrong(true);
        setNote(`${guess.toUpperCase()} isn't it — try another word.`);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send that answer.");
    } finally {
      setBusy(false);
    }
  }

  async function hint() {
    try {
      await revealWordHint();
      setNote(null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "No hint available.");
    }
  }

  const timerColor =
    fraction > 0.5 ? "#4ade80" : fraction > 0.25 ? "#facc15" : "#f87171";

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6">
      {/* Clock + banked points */}
      <div className="flex items-center justify-between text-sm">
        <span className="rounded-full bg-white/10 px-3 py-1 font-semibold">
          🔗 {word.activeIndex}/{total} links
        </span>
        <span className="font-mono font-bold text-fuchsia-300">
          {word.myPoints.toLocaleString()} pts
        </span>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-base font-black"
          style={{ backgroundColor: timerColor, color: "#000" }}
        >
          {secondsLeft}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-100 ease-linear"
          style={{ width: `${fraction * 100}%`, backgroundColor: timerColor }}
        />
      </div>

      <p className="mt-4 text-center text-xs text-white/45">
        Every neighbouring pair makes a word — like{" "}
        <span className="font-semibold text-white/70">
          SUN·FLOWER·BED
        </span>
        . Fill the chain top to bottom.
      </p>

      {/* The chain */}
      <div className="card mt-4 p-4">
        <ChainColumn>
          <ChainWordTile word={word.startWord} tone="given" />
          {word.blanks.map((blank, i) => {
            const isActive = solving && i === word.activeIndex;
            return (
              <div key={i}>
                <ChainLink />
                {blank.solvedWord ? (
                  <ChainWordTile word={blank.solvedWord} tone="solved" />
                ) : isActive ? (
                  <form
                    onSubmit={submit}
                    className={`rounded-xl border-2 border-fuchsia-400 bg-fuchsia-400/10 p-2 ${
                      wrong ? "animate-shake" : ""
                    }`}
                    onAnimationEnd={() => setWrong(false)}
                  >
                    <div className="mb-1.5 text-center font-mono text-sm font-black tracking-[0.3em]">
                      <span className="text-fuchsia-300">{blank.revealed}</span>
                      <span className="text-white/25">
                        {"•".repeat(
                          Math.max(0, blank.length - blank.revealed.length)
                        )}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        // It's a race, and this input is the only thing on the
                        // screen to interact with — the keyboard should be up.
                        autoFocus
                        value={value}
                        onChange={(e) => {
                          setValue(e.target.value);
                          setNote(null);
                        }}
                        maxLength={blank.length}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        aria-label={`Link ${i + 1}, ${blank.length} letters`}
                        placeholder={`${blank.length} letters`}
                        className="min-w-0 flex-1 rounded-lg bg-black/30 px-3 py-2 text-center font-mono text-lg font-black uppercase tracking-[0.2em] text-white outline-none placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-white/25"
                      />
                      <button
                        type="submit"
                        disabled={busy || !value.trim()}
                        className="shrink-0 rounded-lg bg-fuchsia-500 px-4 font-bold text-white hover:bg-fuchsia-400 disabled:opacity-40"
                      >
                        →
                      </button>
                    </div>
                  </form>
                ) : (
                  <ChainBlankTile
                    length={blank.length}
                    revealed={blank.revealed}
                    dimmed
                  />
                )}
              </div>
            );
          })}
          <ChainLink />
          <ChainWordTile word={word.endWord} tone="given" />
        </ChainColumn>

        {note && (
          <p className="mt-3 text-center text-sm text-amber-300">{note}</p>
        )}

        {solving && (
          <button
            onClick={hint}
            className="mt-3 w-full rounded-xl border border-white/15 bg-white/5 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
          >
            💡 Reveal a letter{" "}
            <span className="text-white/40">
              (−100 pts{word.hintsUsed > 0 ? ` · ${word.hintsUsed} used` : ""})
            </span>
          </button>
        )}
      </div>

      {word.finished && (
        <div className="card animate-pop mt-4 p-5 text-center">
          <p className="text-3xl">🎉</p>
          <p className="mt-1 text-lg font-bold text-emerald-300">
            Chain complete!
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-fuchsia-300">
            {word.myPoints.toLocaleString()} pts
          </p>
          <p className="mt-2 text-sm text-white/50">
            Hang tight — the round ends when everyone finishes or the clock runs
            out.
          </p>
        </div>
      )}

      {word.spectating && (
        <p className="mt-4 text-center text-sm text-white/50">
          You&rsquo;re running the big screen — everyone else is solving on their
          phones.
        </p>
      )}

      <div className="card mt-4 p-4">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">
          The race
        </h2>
        <RaceBoard
          standings={word.standings}
          players={state.players}
          meId={me?.id}
          total={total}
        />
      </div>
    </div>
  );
}
