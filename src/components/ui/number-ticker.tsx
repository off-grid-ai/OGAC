'use client';

import { useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { formatFrame, isAnimatableNumber, parseFormattedNumber } from '@/lib/motion/count-up';

// One canonical stat primitive. Counts up once it scrolls into view, then holds. Tabular mono
// digits, prefers-reduced-motion honored. Accepts a raw number (+ optional prefix/suffix) OR a
// pre-formatted string ("1,200", "98.6%", "$4.2M", "n/a"): the numeric magnitude animates, the
// surrounding text renders verbatim, and a non-numeric string renders as-is, un-animated.
interface NumberTickerProps {
  value: number | string;
  decimalPlaces?: number;
  className?: string;
  suffix?: string;
  prefix?: string;
}

export function NumberTicker({
  value,
  decimalPlaces = 0,
  className,
  suffix = '',
  prefix = '',
}: Readonly<NumberTickerProps>) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  // Normalize both call styles onto the pure count-up format (DRY: src/lib/motion/count-up.ts).
  const fmt =
    typeof value === 'number'
      ? { prefix, suffix, value, decimals: decimalPlaces, grouped: false }
      : parseFormattedNumber(value);
  const animatable = isAnimatableNumber(fmt);
  const finalText = animatable ? formatFrame(fmt.value, fmt) : `${fmt.prefix}${fmt.suffix}`;

  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const inView = useInView(ref, { once: true, margin: '0px 0px -80px 0px' });

  useEffect(() => {
    if (inView && animatable && !reduce) motionValue.set(fmt.value);
  }, [inView, animatable, reduce, fmt.value, motionValue]);

  useEffect(() => {
    if (!animatable || reduce) return;
    return spring.on('change', (latest) => {
      if (ref.current) ref.current.textContent = formatFrame(latest, fmt);
    });
    // fmt is derived from value; value in deps covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spring, animatable, reduce, value]);

  return (
    <span ref={ref} className={cn('inline-block tabular-nums tracking-tight', className)}>
      {reduce || !animatable ? finalText : `${fmt.prefix}0${fmt.suffix}`}
    </span>
  );
}
