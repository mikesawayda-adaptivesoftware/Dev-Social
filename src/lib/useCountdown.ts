"use client";

import { useEffect, useState } from "react";

/** Returns seconds remaining (rounded up) and a 0..1 fraction remaining. */
export function useCountdown(endsAt: number | undefined, totalMs: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [endsAt]);

  if (!endsAt) {
    return { secondsLeft: 0, fraction: 0 };
  }
  const remaining = Math.max(0, endsAt - now);
  return {
    secondsLeft: Math.ceil(remaining / 1000),
    fraction: totalMs > 0 ? Math.max(0, Math.min(1, remaining / totalMs)) : 0,
  };
}
