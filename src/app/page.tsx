"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useGame } from "@/components/GameProvider";
import { NameClaimFields } from "@/components/NameClaimFields";
import { Button } from "@/components/ui";
import {
  DEFAULT_GAME_TYPE,
  GAME_TYPE_BLURB,
  GAME_TYPE_LABELS,
  PIN_PATTERN,
} from "@/shared/types";

export default function Home() {
  const router = useRouter();
  const { createRoom, connected } = useGame();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleHost() {
    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }
    if (!PIN_PATTERN.test(pin)) {
      setError("Your PIN must be 4 to 6 digits.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const code = await createRoom(
        name.trim(),
        pin,
        isPublic ? "public" : "private"
      );
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the room.");
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-fuchsia-300/80">
          Team Happy Hour
        </p>
        <h1 className="text-5xl font-black tracking-tight sm:text-6xl">
          Dev{" "}
          <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            Social
          </span>
        </h1>
        <p className="mt-4 text-balance text-white/70">
          Live party games for the whole team. Host on the big screen, everyone
          plays from their phone.
        </p>

        <div className="card mt-10 space-y-4 p-6 text-left">
          <NameClaimFields
            name={name}
            setName={setName}
            pin={pin}
            setPin={setPin}
            onEnter={handleHost}
          />

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="h-5 w-5 accent-fuchsia-500"
            />
            <span className="text-sm">
              <span className="font-semibold">List this game publicly</span>
              <span className="block text-xs text-white/40">
                Anyone can find and join it from Live games until you start. Off =
                only people with your link can join.
              </span>
            </span>
          </label>

          <Button
            onClick={handleHost}
            disabled={busy || !connected}
            className="w-full"
          >
            {busy ? "Creating room…" : "Host a game"}
          </Button>

          <div className="flex items-center gap-3 text-xs text-white/40">
            <span className="h-px flex-1 bg-white/10" />
            OR
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <Link href="/games" className="block">
            <Button variant="secondary" className="w-full">
              Browse live games
            </Button>
          </Link>

          <Link href="/join" className="block">
            <Button variant="secondary" className="w-full">
              Join with a code
            </Button>
          </Link>

          {error && (
            <p className="text-center text-sm text-red-300">{error}</p>
          )}
          {!connected && (
            <p className="text-center text-xs text-amber-300/80">
              Connecting to game server…
            </p>
          )}
        </div>

        <Link
          href="/leaderboard"
          className="mt-6 inline-block text-sm font-medium text-fuchsia-300/90 hover:text-fuchsia-200"
        >
          🏆 Season leaderboard →
        </Link>

        <p className="mt-4 text-xs text-white/40">
          Now playing:{" "}
          <span className="text-white/70">
            {GAME_TYPE_LABELS[DEFAULT_GAME_TYPE]}
          </span>{" "}
          — {GAME_TYPE_BLURB[DEFAULT_GAME_TYPE]}
        </p>
      </div>
    </main>
  );
}
