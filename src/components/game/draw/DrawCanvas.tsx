"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  DRAW_CANVAS_UNITS,
  DRAW_COLORS,
  DRAW_WIDTHS,
  type DrawStroke,
} from "@/shared/types";

/**
 * How far the pen must travel before another point is recorded, in canvas
 * units. Pointer events fire far faster than a drawing needs; without this a
 * slow deliberate line becomes hundreds of near-identical points.
 */
const MIN_POINT_DISTANCE = 6;

/**
 * How often an in-progress stroke is flushed to the room, in ms.
 *
 * The reason segments exist. Waiting for the pen to lift means a guesser stares
 * at a blank canvas through the several seconds it takes to draw a careful
 * outline — in a timed race that's most of their thinking time. Segments share
 * a stroke id, so undo still takes back the whole line.
 */
const SEGMENT_MS = 180;

/** Points beyond which a segment is flushed regardless of the clock. */
const SEGMENT_POINTS = 40;

function newStrokeId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Renders a drawing, and optionally captures one.
 *
 * The same component is the drawer's easel, every guesser's live view and the
 * big screen — they differ only in whether `onSegment` is supplied. That keeps
 * one renderer, so nobody has to notice that the drawer's canvas and the
 * room's canvas agree.
 */
export function DrawCanvas({
  strokes,
  onSegment,
  color = 0,
  width = 0,
  className = "",
}: {
  strokes: DrawStroke[];
  /** Supply to make the canvas drawable. Called with each finished segment. */
  onSegment?: (stroke: DrawStroke) => void;
  color?: number;
  width?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The stroke under the pen right now. Held in a ref, not state: it changes on
  // every pointer move and only the canvas needs to know.
  const liveRef = useRef<{ id: string; points: number[] } | null>(null);
  const flushedAtRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  // Read inside the paint loop and the pointer handlers, which must not be
  // rebuilt every time the drawer taps a different colour. Mirrored in an
  // effect rather than assigned during render — both readers run after paint.
  const styleRef = useRef({ color, width });
  useEffect(() => {
    styleRef.current = { color, width };
  }, [color, width]);

  const paint = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    // Match the backing store to the display size, allowing for a retina
    // screen. Done here rather than on resize so a canvas that changes size
    // (rotating a phone, expanding a panel) can never render at the wrong
    // scale.
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const scale = w / DRAW_CANVAS_UNITS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const line = (points: number[], colorIndex: number, widthIndex: number) => {
      if (points.length < 2) {
        return;
      }
      ctx.strokeStyle = DRAW_COLORS[colorIndex] ?? DRAW_COLORS[0];
      ctx.lineWidth = DRAW_WIDTHS[widthIndex] ?? DRAW_WIDTHS[0];
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      if (points.length === 2) {
        // A tap is a dot, not nothing.
        ctx.lineTo(points[0] + 0.01, points[1]);
      }
      for (let i = 2; i < points.length; i += 2) {
        ctx.lineTo(points[i], points[i + 1]);
      }
      ctx.stroke();
    };

    for (const stroke of strokes) {
      line(stroke.points, stroke.color, stroke.width);
    }
    const live = liveRef.current;
    if (live) {
      line(live.points, styleRef.current.color, styleRef.current.width);
    }
  }, [strokes]);

  const schedule = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(paint);
    }
  }, [paint]);

  useEffect(() => {
    schedule();
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [schedule]);

  // Repaint when the element changes size — the canvas is laid out by CSS, so
  // React re-renders don't cover a rotation or a panel opening.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => schedule());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [schedule]);

  const toUnits = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.max(0, Math.min(DRAW_CANVAS_UNITS, n));
    return [
      clamp(((e.clientX - rect.left) / rect.width) * DRAW_CANVAS_UNITS),
      clamp(((e.clientY - rect.top) / rect.height) * DRAW_CANVAS_UNITS),
    ];
  };

  /** Hand the points drawn so far to the room and keep drawing from the last. */
  const flush = (final: boolean) => {
    const live = liveRef.current;
    if (!live || !onSegment || live.points.length < 2) {
      return;
    }
    onSegment({
      id: live.id,
      color: styleRef.current.color,
      width: styleRef.current.width,
      points: [...live.points],
    });
    flushedAtRef.current = Date.now();
    if (final) {
      liveRef.current = null;
    } else {
      // Carry the last point over so the next segment joins seamlessly rather
      // than leaving a gap where the flush happened.
      const [x, y] = live.points.slice(-2);
      live.points = [x, y];
    }
  };

  if (!onSegment) {
    return <canvas ref={canvasRef} className={className} aria-hidden />;
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      // Without this a drag on the canvas scrolls the page instead of drawing,
      // which is the single most likely way this breaks on a phone.
      style={{ touchAction: "none" }}
      aria-label="Drawing canvas"
      onPointerDown={(e) => {
        // Ignore extra fingers: a second contact mid-stroke would otherwise
        // yank the line across the canvas.
        if (liveRef.current) {
          return;
        }
        // Capture keeps the line going if the pen leaves the canvas mid-stroke.
        // Browsers throw here for a pointer they no longer consider active, and
        // that must not take the stroke down with it.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not capturable — drawing still works, it just stops at the edge.
        }
        liveRef.current = { id: newStrokeId(), points: toUnits(e) };
        flushedAtRef.current = Date.now();
        schedule();
      }}
      onPointerMove={(e) => {
        const live = liveRef.current;
        if (!live) {
          return;
        }
        const [x, y] = toUnits(e);
        const [px, py] = live.points.slice(-2);
        if (Math.hypot(x - px, y - py) < MIN_POINT_DISTANCE) {
          return;
        }
        live.points.push(x, y);
        if (
          live.points.length / 2 >= SEGMENT_POINTS ||
          Date.now() - flushedAtRef.current >= SEGMENT_MS
        ) {
          flush(false);
        }
        schedule();
      }}
      onPointerUp={() => {
        flush(true);
        schedule();
      }}
      onPointerCancel={() => {
        flush(true);
        schedule();
      }}
    />
  );
}
