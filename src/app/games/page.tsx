"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { usePublicRooms } from "@/lib/usePublicRooms";
import { Button } from "@/components/ui";
import {
  GAME_TYPE_EMOJI,
  GAME_TYPE_LABELS,
  type PublicRoomSummary,
} from "@/shared/types";

function openedAgo(createdAt: number): string {
  const mins = Math.floor((Date.now() - createdAt) / 60_000);
  if (mins < 1) {
    return "just opened";
  }
  if (mins < 60) {
    return `opened ${mins}m ago`;
  }
  return `opened ${Math.floor(mins / 60)}h ago`;
}

function GameCard({ room }: { room: PublicRoomSummary }) {
  return (
    <li className="animate-pop card flex items-center gap-4 p-4 text-left">
      <span className="rounded-xl border-2 border-white/10 bg-black/20 px-3 py-2 font-mono text-xl font-black tracking-[0.2em] text-fuchsia-300">
        {room.code}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {GAME_TYPE_EMOJI[room.gameType]} {GAME_TYPE_LABELS[room.gameType]}
        </span>
        <span className="block truncate text-xs text-white/50">
          {room.hostName}&apos;s game
        </span>
        <span className="block text-xs text-white/40">
          {room.playerCount}/{room.maxPlayers} players · {openedAgo(room.createdAt)}
        </span>
      </span>
      <Link href={`/join?code=${room.code}`} className="shrink-0">
        <Button className="px-4 py-2 text-sm">Join</Button>
      </Link>
    </li>
  );
}

export default function GamesPage() {
  const { connected } = useGame();
  const { rooms, loading } = usePublicRooms();

  // The list pushes on every change, but "opened 3m ago" goes stale on a quiet
  // lobby where nothing is changing. Re-render on a slow tick to keep it honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-block text-sm text-white/50 hover:text-white"
        >
          ← Back
        </Link>
        <h1 className="text-3xl font-black">Live games</h1>
        <p className="mt-2 text-white/60">
          Open lobbies waiting for players. Games disappear from this list once
          the host starts them.
        </p>

        <div className="mt-8">
          {loading ? (
            <p className="card p-6 text-center text-sm text-white/40">
              Looking for games…
            </p>
          ) : rooms.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-4xl">🎲</p>
              <p className="mt-3 font-semibold text-white/80">
                No open games right now
              </p>
              <p className="mt-1 text-sm text-white/50">
                Host one and it&apos;ll show up here for everyone else.
              </p>
              <Link href="/" className="mt-4 inline-block">
                <Button variant="secondary">Host a game</Button>
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {rooms.map((room) => (
                <GameCard key={room.code} room={room} />
              ))}
            </ul>
          )}
        </div>

        {!connected && (
          <p className="mt-4 text-center text-xs text-amber-300/80">
            Connecting to game server…
          </p>
        )}
      </div>
    </main>
  );
}
