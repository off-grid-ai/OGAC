'use client';

import { motion, useScroll, useTransform } from 'motion/react';
import { type ReactNode, useRef } from 'react';

// A screenshot that tilts back on a 3D plane then rises and flattens as you scroll it
// into view — a "device coming to rest on the desk" moment. Adapted from Aceternity's
// ContainerScrollAnimation to the Off Grid frame (charcoal bezel, emerald edge).
interface ContainerScrollProps {
  header: ReactNode;
  children: ReactNode;
}

export function ContainerScroll({ header, children }: ContainerScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'center center'],
  });

  const rotate = useTransform(scrollYProgress, [0, 1], [22, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const translateY = useTransform(scrollYProgress, [0, 1], [40, 0]);

  return (
    <div ref={ref} className="relative flex w-full flex-col items-center justify-center overflow-hidden py-8">
      <div className="w-full min-w-0" style={{ perspective: '1000px' }}>
        <div className="mx-auto max-w-3xl">{header}</div>
        <motion.div
          style={{ rotateX: rotate, scale, translateY }}
          className="mx-auto mt-10 w-full max-w-6xl rounded-xl border border-border bg-card p-2 shadow-[0_24px_80px_-24px_rgba(5,150,105,0.28)]"
        >
          <div className="relative w-full min-w-0 overflow-hidden rounded-lg border border-border [&_img]:h-auto [&_img]:w-full">
            {children}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
