"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import type { AckResult, PublicRoomSummary } from "@/shared/types";

/**
 * Subscribes to the live list of public lobbies for as long as the component is
 * mounted. Unlike room state (which lives in GameProvider because it follows the
 * player across pages), this is scoped to whoever is actually looking at the
 * browser — the server skips rebuilding the list when nobody is subscribed.
 *
 * `loading` is true only before the first list arrives, so an empty list renders
 * as "no games right now" rather than a spinner that never resolves.
 */
export function usePublicRooms(): {
  rooms: PublicRoomSummary[];
  loading: boolean;
} {
  const [rooms, setRooms] = useState<PublicRoomSummary[] | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const onList = (next: PublicRoomSummary[]) => setRooms(next);
    const subscribe = () => {
      socket.emit(
        "rooms:subscribe",
        (res: AckResult<{ rooms: PublicRoomSummary[] }>) => {
          if (res.ok) {
            setRooms(res.rooms);
          }
        }
      );
    };

    socket.on("rooms:list", onList);
    // Socket.IO room membership is per-connection, so a reconnect silently drops
    // the subscription and the list would freeze. Re-subscribe on every connect.
    socket.on("connect", subscribe);
    if (socket.connected) {
      subscribe();
    }

    return () => {
      socket.off("rooms:list", onList);
      socket.off("connect", subscribe);
      if (socket.connected) {
        socket.emit("rooms:unsubscribe");
      }
    };
  }, []);

  return { rooms: rooms ?? [], loading: rooms === null };
}
