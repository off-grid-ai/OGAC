'use client';

import { useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { decryptFrame } from '@/lib/motion/decrypt';
import { DURATION } from '@/lib/motion/timing';
import { cn } from '@/lib/utils';

// A one-shot "decrypt" reveal for a single accent word: scrambled glyphs resolve to the real text,
// left to right, when it scrolls into view. The frame math is pure/tested (lib/motion/decrypt.ts);
// this drives progress from a rAF loop. Reduced motion paints the final text immediately, and the
// final text is always the accessible content (aria) so it is never hidden behind the animation.
interface DecryptTextProps {
  text: string;
  className?: string;
  /** Reveal duration in seconds. Defaults to the "data" band (a value resolving reads as thinking). */
  duration?: number;
}

export function DecryptText({ text, className, duration = DURATION.data }: Readonly<DecryptTextProps>) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: '0px 0px -40px 0px' });
  const [frame, setFrame] = useState(text);

  useEffect(() => {
    if (reduce || !inView) {
      setFrame(text);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const ms = duration * 1000;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setFrame(decryptFrame(text, p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, text, duration]);

  return (
    <span ref={ref} className={cn('inline-block tabular-nums', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{frame}</span>
    </span>
  );
}
