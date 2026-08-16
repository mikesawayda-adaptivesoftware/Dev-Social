"use client";

import { useState } from "react";
import { useGame } from "@/components/GameProvider";
import { useCountdown } from "@/lib/useCountdown";
import { WORD_CHAIN_DIFFICULTY_LABELS } from "@/shared/types";
import {
  ChainBlankTile,
  ChainColumn,
  ChainLink,
  ChainWordTile,
  RaceBoard,
} from "./ChainBoard";
import { WordChainBigScreen } from "./WordChainBigScreen";

export function WordChainPlaying() {
  const { state, me, submitWordGuess, revealWordHint } = useGame();
  const word = state?.wordRound;
  const totalMs = (state?.settings.roundDurationSec ?? 0) * 1000;
  const { secondsLeft, fraction } = useCountdown(word?.endsAt, totalMs);

  // One draft per blank — two are open at once, and typing in one must not
  // clobber the other.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  // A wrong answer shakes that tile and leaves a note until the next keystroke.
  // Both clear themselves — the shake on its own animationend, the note on the
  // next edit — so neither needs a timer to tidy up after it.
  const [shakeAt, setShakeAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Which end the player is working from, so that solving a blank hands focus
  // to the next one on *that* side instead of jumping across the chain.
  const [side, setSide] = useState<"front" | "back">("front");

  if (!state || !word) {
    return null;
  }

  // The host running the big screen gets a different screen entirely.
  if (word.spectating) {
    return <WordChainBigScreen />;
  }

  const total = word.blanks.length;
  const solved = word.blanks.filter((b) => b.solvedWord).length;
  const active = word.activeIndexes;
  const focused = side === "front" ? active[0] : active[active.length - 1];

  async function submit(e: React.FormEvent, index: number) {
    e.preventDefault();
    const guess = (drafts[index] ?? "").trim();
    if (!guess || busy) {
      return;
    }
    // Remember which end this came from *before* awaiting: on success the
    // frontier moves, this input unmounts and the next one autofocuses, and it
    // should be the one on the end the player is actually working from.
    setSide(index === active[0] ? "front" : "back");
    setBusy(true);
    try {
      const res = await submitWordGuess(index, guess);
      if (res.correct) {
        setDrafts((d) => ({ ...d, [index]: "" }));
        setNote(null);
      } else {
        setShakeAt(index);
        setNote(`${guess.toUpperCase()} isn't it — try another word.`);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send that answer.");
    } finally {
      setBusy(false);
    }
  }

  async function hint(index: number) {
    try {
      await revealWordHint(index);
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
          🔗 {solved}/{total}
          <span className="ml-1.5 text-xs font-medium text-white/40">
            {WORD_CHAIN_DIFFICULTY_LABELS[word.difficulty]}
          </span>
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
        <span className="font-semibold text-white/70">SUN·FLOWER·BED</span>. Work
        in from either end.
      </p>

      {/* The chain */}
      <div className="card mt-4 p-4">
        <ChainColumn>
          <ChainWordTile word={word.startWord} tone="given" />
          {word.blanks.map((blank, i) => {
            const isActive = !word.finished && active.includes(i);
            return (
              <div key={i}>
                <ChainLink />
                {blank.solvedWord ? (
                  <ChainWordTile word={blank.solvedWord} tone="solved" />
                ) : isActive ? (
                  <form
                    onSubmit={(e) => submit(e, i)}
                    className={`rounded-xl border-2 border-fuchsia-400 bg-fuchsia-400/10 p-2 ${
                      shakeAt === i ? "animate-shake" : ""
                    }`}
                    onAnimationEnd={() => setShakeAt(null)}
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
                      <button
                        type="button"
                        onClick={() => hint(i)}
                        title="Reveal a letter (−100 pts)"
                        aria-label="Reveal a letter, costs 100 points"
                        className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-2 text-sm hover:bg-white/10"
                      >
                        💡
                      </button>
                      <input
                        // Focus follows the end the player is working from, so
                        // solving a blank continues the run instead of hopping.
                        autoFocus={i === focused}
                        value={drafts[i] ?? ""}
                        onFocus={() =>
                          setSide(i === active[0] ? "front" : "back")
                        }
                        onChange={(e) => {
                          setDrafts((d) => ({ ...d, [i]: e.target.value }));
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
                        disabled={busy || !(drafts[i] ?? "").trim()}
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
        {!word.finished && (
          <p className="mt-3 text-center text-xs text-white/35">
            💡 reveals a letter for −100 pts
            {word.hintsUsed > 0 && ` · ${word.hintsUsed} used`}
          </p>
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
