"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Button } from "@/components/ui";
import { PlayerList, RoomCodeBadge } from "./shared";

export function Lobby() {
  const { state, isHost, me, startSubmission } = useGame();
  const [joinUrl, setJoinUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state) {
      setJoinUrl(`${window.location.origin}/join?code=${state.code}`);
    }
  }, [state]);

  if (!state) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 text-center">
      <RoomCodeBadge code={state.code} />
      <p className="mt-3 text-white/60">
        Join at{" "}
        <span className="font-semibold text-white">
          {joinUrl.replace(/^https?:\/\//, "")}
        </span>
      </p>

      <div className="card mt-8 p-6">
        <h2 className="mb-4 text-lg font-bold text-white/80">
          Players ({state.players.length})
        </h2>
        <PlayerList players={state.players} highlightId={me?.id} />
      </div>

      {isHost ? (
        <div className="mt-8 space-y-3">
          <Button
            onClick={async () => {
              setBusy(true);
              try {
                await startSubmission();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || state.players.length < 2}
            className="w-full max-w-sm"
          >
            {state.players.length < 2
              ? "Waiting for players…"
              : "Start Photo Guessr →"}
          </Button>
          <p className="text-xs text-white/40">
            You&apos;re the host. Start when everyone has joined.
          </p>
        </div>
      ) : (
        <p className="mt-8 text-lg text-white/70">
          You&apos;re in! Waiting for the host to start…
        </p>
      )}
    </div>
  );
}
