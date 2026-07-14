"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useGame } from "@/components/GameProvider";
import { Lobby } from "@/components/game/Lobby";
import { Submission } from "@/components/game/Submission";
import { Playing } from "@/components/game/Playing";
import { Reveal } from "@/components/game/Reveal";
import { Final } from "@/components/game/Final";
import { GeoPlaying } from "@/components/game/geo/GeoPlaying";
import { GeoReveal } from "@/components/game/geo/GeoReveal";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code ?? "").toUpperCase();
  const { state, identity, connected, isHost, leave } = useGame();

  // If we have no saved seat for this room, send the player to the join screen.
  useEffect(() => {
    if (identity === null) {
      const t = setTimeout(() => {
        router.replace(`/join?code=${code}`);
      }, 400);
      return () => clearTimeout(t);
    }
    if (identity && identity.code.toUpperCase() !== code) {
      router.replace(`/join?code=${code}`);
    }
  }, [identity, code, router]);

  if (!state || state.code.toUpperCase() !== code) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-fuchsia-400" />
        <p className="text-white/60">
          {connected ? "Joining room…" : "Connecting…"}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 py-3 text-sm">
        <span className="font-mono font-bold tracking-widest text-white/70">
          {state.code}
        </span>
        <span className="flex items-center gap-2 text-white/40">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          {isHost ? "Host" : "Player"}
          <button
            onClick={() => {
              leave();
              router.replace("/");
            }}
            className="ml-2 text-white/40 hover:text-white"
          >
            Leave
          </button>
        </span>
      </header>

      <div className="flex flex-1 flex-col">
        {state.phase === "lobby" && <Lobby />}
        {state.gameType === "geo_guessr" ? (
          <>
            {state.phase === "playing" && <GeoPlaying />}
            {state.phase === "reveal" && <GeoReveal />}
          </>
        ) : (
          <>
            {state.phase === "submission" && <Submission />}
            {state.phase === "playing" && <Playing />}
            {state.phase === "reveal" && <Reveal />}
          </>
        )}
        {state.phase === "final" && <Final />}
      </div>
    </main>
  );
}
