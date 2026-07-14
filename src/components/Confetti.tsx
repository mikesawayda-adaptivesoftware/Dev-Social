"use client";

import { useMemo } from "react";

const COLORS = ["#f87171", "#facc15", "#4ade80", "#22d3ee", "#a78bfa", "#f472b6"];

// Deterministic pseudo-random in [0, 1) from a seed. Pure (unlike Math.random),
// so it's safe to call during render and stays stable across SSR/hydration.
function rand(seed: number) {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

export function Confetti({ count = 80 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: rand(i * 3 + 1) * 100,
        delay: rand(i * 3 + 2) * 1.5,
        duration: 2.5 + rand(i * 3 + 3) * 2,
        color: COLORS[i % COLORS.length],
        rotate: rand(i * 7 + 5) * 360,
      })),
    [count]
  );

  return (
    <div aria-hidden className="pointer-events-none">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}vw`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
