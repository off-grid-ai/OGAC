'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import {
  beamGradientCoordinates,
  buildBeamPath,
  clampCurvature,
  relativeCenter,
} from '@/lib/motion/beam-geometry';
import { DURATION, EASE, shouldAnimateLoop } from '@/lib/motion/timing';
import { cn } from '@/lib/utils';

interface AnimatedBeamProps {
  /** The element the beam lives inside; the SVG fills it and coordinates are relative to it. */
  containerRef: RefObject<HTMLElement | null>;
  /** The source node (data flows FROM here). */
  fromRef: RefObject<HTMLElement | null>;
  /** The target node (data flows TO here). */
  toRef: RefObject<HTMLElement | null>;
  /** Upward bow of the curve in px; use to fan parallel beams apart in a topology. */
  curvature?: number;
  /** Reverse the sweep direction (response travelling back). */
  reverse?: boolean;
  /** Seconds between sweep repeats. */
  duration?: number;
  delay?: number;
  className?: string;
}

/**
 * Data-is-alive: an emerald pulse travelling a curved connector between two nodes — the standard for
 * "data moves between things" (gateway -> node, source -> collection, pipeline stage -> stage). The
 * geometry is the pure `beam-geometry` module; this component only measures the live rects and drives
 * the sweep. Under reduced motion the static connector line is drawn but the pulse does not loop.
 */
export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = DURATION.data * 3,
  delay = 0,
  className,
}: AnimatedBeamProps) {
  const id = useId();
  const gradientId = `beam-${id}`;
  const prefersReduced = useReducedMotion();
  const [path, setPath] = useState('');
  const [box, setBox] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const container = containerRef.current;
    const from = fromRef.current;
    const to = toRef.current;
    if (!container || !from || !to) return;
    const cRect = container.getBoundingClientRect();
    const start = relativeCenter(from.getBoundingClientRect(), cRect);
    const end = relativeCenter(to.getBoundingClientRect(), cRect);
    setBox({ width: cRect.width, height: cRect.height });
    setPath(buildBeamPath(start, end, clampCurvature(curvature)));
  }, [containerRef, fromRef, toRef, curvature]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [containerRef, measure]);

  if (!path) return null;
  const coords = beamGradientCoordinates(reverse);
  const loop = shouldAnimateLoop(!!prefersReduced);

  return (
    <svg
      fill="none"
      width={box.width}
      height={box.height}
      viewBox={`0 0 ${box.width} ${box.height}`}
      className={cn('pointer-events-none absolute inset-0 z-0', className)}
      aria-hidden="true"
    >
      {/* Static rail — always visible so the topology reads even with motion off. */}
      <path d={path} stroke="var(--color-border)" strokeWidth={1.5} strokeOpacity={0.6} />
      {loop ? (
        <motion.path
          d={path}
          stroke={`url(#${gradientId})`}
          strokeWidth={2}
          strokeLinecap="round"
          initial={{ pathLength: 0, pathOffset: reverse ? 1 : 0 }}
          animate={{ pathOffset: reverse ? [1, 0] : [0, 1] }}
          transition={{ duration, delay, repeat: Infinity, ease: EASE.standard, repeatDelay: 0.4 }}
        />
      ) : null}
      <defs>
        <linearGradient id={gradientId} x1={coords.x1} y1="0" x2={coords.x2} y2="0">
          <stop stopColor="var(--og-primary)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--og-primary)" />
          <stop offset="1" stopColor="var(--og-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
