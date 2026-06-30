"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Button } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  const { createRoom, connected } = useGame();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleHost() {
    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const code = await createRoom(name.trim());
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
          <label className="block text-sm font-medium text-white/70">
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleHost()}
              maxLength={20}
              placeholder="e.g. Alex"
              className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-lg text-white outline-none placeholder:text-white/30 focus:border-fuchsia-400"
            />
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
          First game: <span className="text-white/70">Photo Guessr</span> — match
          the baby photo to the teammate.
        </p>
      </div>
    </main>
  );
}
