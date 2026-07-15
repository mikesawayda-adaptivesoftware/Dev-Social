"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { loadRecentSeat } from "@/lib/socket";
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
  const {
    state,
    identity,
    connected,
    isHost,
    seatLost,
    rejoinRecent,
    leave,
  } = useGame();

  // Do we already hold a live seat for this room? If so, the normal flow applies
  // and state will arrive over the socket. If not, we may still be able to
  // recover a dropped seat before falling back to the join screen.
  const hasActiveSeat = Boolean(
    identity && identity.code.toUpperCase() === code
  );

  const goHome = () => {
    leave();
    router.replace("/");
  };

  // --- The server rejected our reconnect: the game is gone. ---------------
  if (seatLost) {
    return (
      <CenteredCard>
        <p className="text-lg font-semibold text-white">
          This game is no longer available
        </p>
        <p className="max-w-xs text-sm text-white/60">
          It may have ended, or the game server restarted. You&rsquo;ll need to
          start or join a new one.
        </p>
        <button
          onClick={goHome}
          className="mt-1 rounded-full bg-fuchsia-500 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-400"
        >
          Back home
        </button>
      </CenteredCard>
    );
  }

  // --- No live seat: try to recover a dropped one, else send to join. -----
  if (!hasActiveSeat) {
    return <RejoinGate code={code} rejoinRecent={rejoinRecent} />;
  }

  // --- We have a seat but no state snapshot yet. --------------------------
  if (!state || state.code.toUpperCase() !== code) {
    return (
      <CenteredCard>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-fuchsia-400" />
        <p className="text-white/60">
          {connected ? "Joining room…" : "Connecting…"}
        </p>
      </CenteredCard>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      {!connected && (
        <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          Reconnecting… your spot is held.
        </div>
      )}
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
            onClick={goHome}
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

/** Shared centered layout for the non-game screens (spinner, prompts, errors). */
function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
      {children}
    </main>
  );
}

/**
 * Shown when we land on a room without a live seat. If a saved seat exists for
 * this room (persisted when the player first joined) we offer a one-tap rejoin;
 * otherwise we quietly send them to the join screen. Reading the saved seat
 * happens in an effect so it never runs during SSR (avoids hydration mismatch).
 */
function RejoinGate({
  code,
  rejoinRecent,
}: {
  code: string;
  rejoinRecent: (code: string) => Promise<void>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "prompt" | "none">(
    "checking"
  );
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reading the saved seat must happen here, not in a lazy initializer:
    // localStorage is unavailable during SSR, so touching it while rendering
    // would desync server/client and cause a hydration mismatch.
    const seat = loadRecentSeat(code);
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(seat?.name ?? "");
    setPhase(seat ? "prompt" : "none");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [code]);

  // No saved seat → head to the join screen after a short beat.
  useEffect(() => {
    if (phase !== "none") {
      return;
    }
    const t = setTimeout(() => router.replace(`/join?code=${code}`), 400);
    return () => clearTimeout(t);
  }, [phase, code, router]);

  if (phase === "checking" || phase === "none") {
    return (
      <CenteredCard>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-fuchsia-400" />
        <p className="text-white/60">Connecting…</p>
      </CenteredCard>
    );
  }

  const onRejoin = async () => {
    setBusy(true);
    setError(null);
    try {
      await rejoinRecent(code);
      // Success: identity is now set, so the room page re-renders into the game.
    } catch (e) {
      // The seat was gone. Fall back to a fresh join.
      setError(e instanceof Error ? e.message : "Couldn't rejoin.");
      setPhase("none");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredCard>
      <p className="text-lg font-semibold text-white">Welcome back</p>
      <p className="max-w-xs text-sm text-white/60">
        You have a seat in game{" "}
        <span className="font-mono font-bold tracking-widest text-white/80">
          {code}
        </span>{" "}
        as{" "}
        <span className="font-semibold text-white/80">{name}</span>. Jump back
        in?
      </p>
      {error && <p className="text-sm text-amber-300">{error}</p>}
      <div className="mt-1 flex items-center gap-3">
        <button
          onClick={onRejoin}
          disabled={busy}
          className="rounded-full bg-fuchsia-500 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-50"
        >
          {busy ? "Rejoining…" : "Rejoin game"}
        </button>
        <button
          onClick={() => router.replace(`/join?code=${code}`)}
          disabled={busy}
          className="text-sm text-white/50 hover:text-white disabled:opacity-50"
        >
          Join fresh
        </button>
      </div>
    </CenteredCard>
  );
}
