"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { PIN_MAX_LENGTH } from "@/shared/types";

interface Props {
  name: string;
  setName: (v: string) => void;
  pin: string;
  setPin: (v: string) => void;
  onEnter?: () => void;
}

/**
 * Name + PIN inputs with a live "new name / taken" hint. A player's PIN claims
 * their name for the season leaderboard; the hint (debounced) tells them whether
 * they're claiming a fresh name or logging into an existing one.
 */
export function NameClaimFields({ name, setName, pin, setPin, onEnter }: Props) {
  const { checkName } = useGame();
  // Holds the last resolved lookup. Kept in a single state object updated only
  // inside the async callback, so we never call setState synchronously in the
  // effect body. `checking`/`claimed` are derived from it below.
  const [result, setResult] = useState<{ name: string; claimed: boolean } | null>(
    null
  );

  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      const claimed = await checkName(trimmed);
      if (active) {
        setResult({ name: trimmed, claimed });
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [name, checkName]);

  const trimmed = name.trim();
  const settled = Boolean(trimmed) && result?.name === trimmed;
  const checking = Boolean(trimmed) && !settled;
  const claimed = settled ? result!.claimed : null;

  const pinLabel =
    claimed === true ? "Enter your PIN" : claimed === false ? "Create a PIN" : "PIN";

  return (
    <>
      <label className="block text-sm font-medium text-white/70">
        Your name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          maxLength={20}
          placeholder="e.g. Sam"
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-lg text-white outline-none placeholder:text-white/30 focus:border-fuchsia-400"
        />
      </label>

      {trimmed && (
        <p
          className={`-mt-1 text-xs ${
            checking
              ? "text-white/40"
              : claimed
                ? "text-amber-300/90"
                : "text-emerald-300/90"
          }`}
        >
          {checking
            ? "Checking name…"
            : claimed
              ? "🔒 This name is taken — enter its PIN to log in."
              : "✨ New name — create a PIN to claim it."}
        </p>
      )}

      <label className="block text-sm font-medium text-white/70">
        {pinLabel}
        <input
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX_LENGTH))
          }
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          inputMode="numeric"
          autoComplete="off"
          placeholder="4–6 digits"
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-lg tracking-[0.3em] text-white outline-none placeholder:tracking-normal placeholder:text-white/30 focus:border-fuchsia-400"
        />
      </label>
    </>
  );
}
