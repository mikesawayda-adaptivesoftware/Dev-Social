"use client";

import { useCallback, useEffect, useState } from "react";
import { clearRecentSeat, getSocket, listRecentSeats } from "@/lib/socket";
import type { AckResult, SeatStatus } from "@/shared/types";

/**
 * The games this browser is still sitting in.
 *
 * localStorage remembers every seat we ever took, but a remembered seat is only
 * a hint — the room may have ended, or the server may have restarted and lost
 * it. So the list is always confirmed against the server, and anything it
 * doesn't recognise is forgotten on the spot rather than offered as a dead
 * "rejoin" button.
 *
 * This is the fix for the two-games-at-once problem: someone whose phone lost a
 * game had no way to see it was still running, so they hosted another one.
 */
export function useResumableSeats(): {
  seats: SeatStatus[];
  forget: (code: string) => void;
} {
  // Starts empty rather than "loading": there is nothing to show until the
  // server confirms something, so a pending state would only ever render as
  // nothing anyway — and setting it from the effect body would be a cascading
  // render for no gain.
  const [seats, setSeats] = useState<SeatStatus[]>([]);

  const check = useCallback(() => {
    const remembered = listRecentSeats();
    if (remembered.length === 0) {
      return;
    }
    getSocket().emit(
      "seats:check",
      {
        seats: remembered.map(({ code, playerId }) => ({ code, playerId })),
      },
      (res: AckResult<{ seats: SeatStatus[] }>) => {
        if (!res.ok) {
          return;
        }
        // Absent means gone: drop the local record so we stop asking about it.
        const alive = new Set(res.seats.map((s) => s.code.toUpperCase()));
        for (const seat of remembered) {
          if (!alive.has(seat.code.toUpperCase())) {
            clearRecentSeat(seat.code);
          }
        }
        setSeats(res.seats);
      }
    );
  }, []);

  useEffect(() => {
    const socket = getSocket();
    // A check needs a live socket, and the first paint often beats the connect.
    socket.on("connect", check);
    if (socket.connected) {
      check();
    }
    return () => {
      socket.off("connect", check);
    };
  }, [check]);

  const forget = useCallback((code: string) => {
    clearRecentSeat(code);
    setSeats((prev) =>
      prev.filter((s) => s.code.toUpperCase() !== code.toUpperCase())
    );
  }, []);

  return { seats, forget };
}
