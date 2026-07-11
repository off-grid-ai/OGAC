'use client';

import { Children, useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { DURATION, EASE, staggerDelay } from '@/lib/motion/timing';
import { cn } from '@/lib/utils';

interface AnimatedListProps {
  children: React.ReactNode;
  className?: string;
  /** Per-item stagger step in seconds (defaults to the shared STAGGER_STEP). */
  step?: number;
}

/**
 * Data-is-alive: an activity/audit/trace feed whose rows settle in with a brief staggered rise, so
 * new items feel like they ARRIVE rather than blink. Reveal timing + the capped stagger are the
 * shared `timing` tokens. Under reduced motion items appear at once with no transform (the guard is
 * per-item so the whole list respects the OS preference). Presentation only — the caller owns the
 * data and ordering.
 */
export function AnimatedList({ children, className, step }: Readonly<AnimatedListProps>) {
  const prefersReduced = useReducedMotion();
  const items = useMemo(() => Children.toArray(children), [children]);

  return (
    <div className={cn('flex flex-col', className)}>
      <AnimatePresence initial={false}>
        {items.map((child, i) => (
          <motion.div
            // Prefer the child's own key (stable across reorders); fall back to index.
            key={(child as { key?: string })?.key ?? i}
            initial={prefersReduced ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{
              duration: prefersReduced ? 0 : DURATION.reveal,
              delay: prefersReduced ? 0 : staggerDelay(i, step),
              ease: EASE.entrance,
            }}
          >
            {child}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
