'use client';

import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { type ReactNode, useCallback, useRef } from 'react';
import { magneticOffset } from '@/lib/motion/magnetic';
import { cn } from '@/lib/utils';

// A hover-intent "magnetic" wrapper: the child eases a small distance toward the pointer, then
// springs back on leave. Transform-only, reduced-motion returns to rest and never tracks. The pull
// math lives in the pure, tested `lib/motion/magnetic.ts` (SOLID: this is thin glue).
interface MagneticProps {
  children: ReactNode;
  className?: string;
  strength?: number;
}

export function Magnetic({ children, className, strength = 0.3 }: Readonly<MagneticProps>) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 200, damping: 18, mass: 0.4 });

  const onMove = useCallback(
    (e: React.MouseEvent) => {
      if (reduce) return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const o = magneticOffset({
        dx: e.clientX - (r.left + r.width / 2),
        dy: e.clientY - (r.top + r.height / 2),
        halfWidth: r.width / 2,
        halfHeight: r.height / 2,
        strength,
      });
      x.set(o.x);
      y.set(o.y);
    },
    [reduce, strength, x, y],
  );

  const reset = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  return (
    <motion.span
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy }}
      className={cn('inline-flex', className)}
    >
      {children}
    </motion.span>
  );
}
