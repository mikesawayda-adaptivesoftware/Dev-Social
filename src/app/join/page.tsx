"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Button } from "@/components/ui";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { joinRoom, connected } = useGame();
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    if (code.trim().length !== 4) {
      setError("Room codes are 4 letters.");
      return;
    }
    if (!name.trim()) {
      setError("Don't forget your name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const joined = await joinRoom(code.trim(), name.trim());
      router.push(`/room/${joined}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join the room.");
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-block text-sm text-white/50 hover:text-white"
        >
          ← Back
        </Link>
        <h1 className="text-3xl font-black">Join a game</h1>
        <p className="mt-2 text-white/60">
          Enter the 4-letter code from the host&apos;s screen.
        </p>

        <div className="card mt-8 space-y-4 p-6">
          <label className="block text-sm font-medium text-white/70">
            Room code
            <input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))
              }
              placeholder="ABCD"
              autoCapitalize="characters"
              className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-center text-3xl font-black tracking-[0.5em] text-white outline-none placeholder:text-white/20 focus:border-fuchsia-400"
            />
          </label>
          <label className="block text-sm font-medium text-white/70">
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              maxLength={20}
              placeholder="e.g. Sam"
              className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-lg text-white outline-none placeholder:text-white/30 focus:border-fuchsia-400"
            />
          </label>

          <Button
            onClick={handleJoin}
            disabled={busy || !connected}
            className="w-full"
          >
            {busy ? "Joining…" : "Join game"}
          </Button>
          {error && <p className="text-center text-sm text-red-300">{error}</p>}
          {!connected && (
            <p className="text-center text-xs text-amber-300/80">
              Connecting to game server…
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinForm />
    </Suspense>
  );
}
