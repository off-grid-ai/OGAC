'use client';

import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// A curved wire between two DOM nodes with an emerald pulse traveling along it.
//
// Geometry is measured ONCE on mount and only recomputed on a real, debounced resize of
// the container - never on every scroll/render - so entrance animations elsewhere on the
// page cannot thrash it. The travelling pulse is a CSS `stroke-dashoffset` animation on a
// fixed path, which runs on the compositor and never restarts when React re-renders (a
// `motion`-driven gradient keyframe, by contrast, resets mid-flight on any re-render, which
// is what made this stutter). Honors `prefers-reduced-motion` with a static wire.
interface AnimatedBeamProps {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  duration?: number;
  delay?: number;
  className?: string;
}

interface Geometry {
  w: number;
  h: number;
  d: string;
  len: number;
}

const EMPTY: Geometry = { w: 0, h: 0, d: '', len: 0 };

export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  duration = 3,
  delay = 0,
  className,
}: AnimatedBeamProps) {
  const id = useId();
  const pathRef = useRef<SVGPathElement>(null);
  const [geo, setGeo] = useState<Geometry>(EMPTY);

  useEffect(() => {
    const container = containerRef.current;
    const from = fromRef.current;
    const to = toRef.current;
    if (!container || !from || !to) return;

    // Recompute geometry from the live bounding boxes. Only called on mount and on a real
    // container resize (debounced) - not on scroll or unrelated re-renders.
    const compute = () => {
      const c = container.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.left - c.left + a.width / 2;
      const y1 = a.top - c.top + a.height / 2;
      const x2 = b.left - c.left + b.width / 2;
      const y2 = b.top - c.top + b.height / 2;
      const midY = (y1 + y2) / 2 - curvature;
      const d = `M ${x1},${y1} Q ${(x1 + x2) / 2},${midY} ${x2},${y2}`;
      const len = pathRef.current?.getTotalLength() ?? Math.hypot(x2 - x1, y2 - y1);
      setGeo((prev) =>
        prev.w === c.width && prev.h === c.height && prev.d === d
          ? prev
          : { w: c.width, h: c.height, d, len },
      );
    };

    // Measure once now, then again on the next frame so the path element exists and
    // `getTotalLength()` returns a real value for the dash animation.
    compute();
    const raf = requestAnimationFrame(compute);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(compute, 120);
    };
    const ro = new ResizeObserver(debounced);
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [containerRef, fromRef, toRef, curvature]);

  const grad = `beam-grad-${id}`;
  // A single lit segment (a fraction of the wire) that slides end-to-end. Sized to the
  // measured path length so the pulse reads the same on short and long wires.
  const dash = Math.max(geo.len * 0.28, 24);

  return (
    <svg
      fill="none"
      width={geo.w}
      height={geo.h}
      className={cn('pointer-events-none absolute left-0 top-0', className)}
      viewBox={`0 0 ${geo.w} ${geo.h}`}
      aria-hidden="true"
    >
      {/* Static wire - the resting connection. */}
      <path
        ref={pathRef}
        d={geo.d}
        stroke="var(--og-border)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Travelling emerald pulse: a dashed overlay whose offset animates on the compositor. */}
      {geo.len > 0 && (
        <path
          d={geo.d}
          stroke={`url(#${grad})`}
          strokeWidth={2}
          strokeLinecap="round"
          className="og-beam-pulse"
          style={
            {
              '--beam-len': `${geo.len}`,
              '--beam-dash': `${dash}`,
              strokeDasharray: `${dash} ${geo.len}`,
              animationDuration: `${duration}s`,
              animationDelay: `${delay}s`,
            } as React.CSSProperties
          }
        />
      )}
      <defs>
        <linearGradient id={grad} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={geo.w} y2="0">
          <stop stopColor="#34D399" stopOpacity="0" />
          <stop offset="40%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
    </svg>
  );
}
