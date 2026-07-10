'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, useMotionValueEvent, useReducedMotion, useSpring } from 'motion/react';

import {
  countUpStart,
  formatFrame,
  isAnimatableNumber,
  parseFormattedNumber,
} from '@/lib/motion/count-up';
import { DURATION } from '@/lib/motion/timing';
import { cn } from '@/lib/utils';

interface NumberTickerProps {
  /**
   * The final, pre-formatted value the surface already computes — "1,200", "$4.2M", "98.6%", "3d".
   * The ticker counts up to it and lands on this exact string, so it is a drop-in for the static
   * value it replaces. Non-numeric strings ("n/a", "—") render verbatim, un-animated.
   */
  value: string;
  /** Where the count-up begins, as a fraction of the target (0 = from zero). */
  startFraction?: number;
  className?: string;
  /** Fires the count-up only once the element scrolls into view (default true). */
  animateOnView?: boolean;
}

/**
 * Data-is-alive: a stat that counts up when it first appears, then holds. The magnitude/format
 * parsing and frame rendering are the pure `count-up` module; this component is only the spring +
 * the reduced-motion guard. Under reduced motion it paints the final value immediately (no spring),
 * honoring the OS preference per DESIGN_PHILOSOPHY §7.
 */
export function NumberTicker({
  value,
  startFraction = 0,
  className,
  animateOnView = true,
}: NumberTickerProps) {
  const fmt = parseFormattedNumber(value);
  const animatable = isAnimatableNumber(fmt);
  const prefersReduced = useReducedMotion();

  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -40px 0px' });
  const [display, setDisplay] = useState(() =>
    animatable && !prefersReduced ? formatFrame(countUpStart(fmt.value, startFraction), fmt) : value,
  );

  const spring = useSpring(countUpStart(fmt.value, startFraction), {
    bounce: 0,
    duration: DURATION.data * 1000,
  });

  useMotionValueEvent(spring, 'change', (latest) => {
    setDisplay(formatFrame(latest, fmt));
  });

  useEffect(() => {
    // Reduced motion or a non-numeric value: skip the spring, show the final string.
    if (!animatable || prefersReduced) {
      setDisplay(value);
      return;
    }
    if (!animateOnView || inView) spring.set(fmt.value);
  }, [animatable, prefersReduced, animateOnView, inView, spring, fmt.value, value]);

  return (
    <span ref={ref} className={cn('inline-block tabular-nums', className)}>
      {display}
    </span>
  );
}
