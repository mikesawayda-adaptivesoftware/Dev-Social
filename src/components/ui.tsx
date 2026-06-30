"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30 hover:from-violet-400 hover:to-fuchsia-400",
  secondary:
    "bg-white/10 text-white border border-white/15 hover:bg-white/15",
  ghost: "bg-transparent text-white/70 hover:text-white hover:bg-white/5",
  danger: "bg-red-500/90 text-white hover:bg-red-500",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", className = "", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
        {...props}
      />
    );
  }
);

export function Avatar({
  name,
  color,
  size = 40,
  dimmed = false,
}: {
  name: string;
  color: string;
  size?: number;
  dimmed?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-black/80"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: size * 0.38,
        opacity: dimmed ? 0.4 : 1,
      }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}
