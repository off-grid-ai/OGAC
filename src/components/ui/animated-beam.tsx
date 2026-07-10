'use client';

import { motion } from 'motion/react';
import { type RefObject, useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';

// A curved gradient beam that travels between two DOM nodes, measured live from their
// bounding boxes so the wiring stays correct through resize/reflow. Adapted from the
// Magic UI pattern to the Off Grid emerald palette and reduced-motion rules.
interface AnimatedBeamProps {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  className?: string;
}

export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 3,
  delay = 0,
  className,
}: AnimatedBeamProps) {
  const id = useId();
  const [d, setD] = useState('');
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const container = containerRef.current;
    const from = fromRef.current;
    const to = toRef.current;
    if (!container || !from || !to) return;

    const compute = () => {
      const c = container.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      setBox({ w: c.width, h: c.height });

      const x1 = a.left - c.left + a.width / 2;
      const y1 = a.top - c.top + a.height / 2;
      const x2 = b.left - c.left + b.width / 2;
      const y2 = b.top - c.top + b.height / 2;
      const midY = (y1 + y2) / 2 - curvature;
      setD(`M ${x1},${y1} Q ${(x1 + x2) / 2},${midY} ${x2},${y2}`);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [containerRef, fromRef, toRef, curvature]);

  const grad = `beam-${id}`;
  const gradientCoords = reverse
    ? { x1: ['90%', '-10%'], x2: ['100%', '0%'] }
    : { x1: ['10%', '110%'], x2: ['0%', '100%'] };

  return (
    <svg
      fill="none"
      width={box.w}
      height={box.h}
      className={cn('pointer-events-none absolute left-0 top-0', className)}
      viewBox={`0 0 ${box.w} ${box.h}`}
      aria-hidden="true"
    >
      <path d={d} stroke="var(--og-border)" strokeWidth={1.5} strokeOpacity={0.9} />
      <path d={d} strokeWidth={1.8} stroke={`url(#${grad})`} strokeOpacity={1} strokeLinecap="round" />
      <defs>
        <motion.linearGradient
          id={grad}
          gradientUnits="userSpaceOnUse"
          initial={{ x1: '0%', x2: '0%', y1: '0%', y2: '0%' }}
          animate={{ x1: gradientCoords.x1, x2: gradientCoords.x2, y1: ['0%', '0%'], y2: ['0%', '0%'] }}
          transition={{ delay, duration, ease: [0.16, 1, 0.3, 1], repeat: Infinity, repeatDelay: 0 }}
        >
          <stop stopColor="#34D399" stopOpacity="0" />
          <stop stopColor="#34D399" />
          <stop offset="32.5%" stopColor="#059669" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </svg>
  );
}
