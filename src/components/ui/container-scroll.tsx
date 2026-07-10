'use client';

import { type ReactNode, useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { BlurFade } from '@/components/ui/blur-fade';

// The macOS-style scroll stage: a product shot in the Off Grid frame (charcoal bezel, emerald edge)
// that starts tilted back on the X axis and rotates flat + scales up as the section scrolls into
// view, settling upright when centered. Presentation only - holds no state or logic.
//
// Why it does NOT clip / reserve a dead band (the trap a prior static rewrite was avoiding): the
// scroll range is tied to the section entering-to-centered (`start end` -> `center center`), the
// transform settles at identity (rotateX 0, scale 1, y 0) so the promoted panel is never left
// mid-transform, `perspective` lives on the parent, and `transformOrigin: top` keeps the tilt
// pivoting away from the content below. Reduced-motion users get the static frame (BlurFade only).
interface ContainerScrollProps {
  header: ReactNode;
  children: ReactNode;
}

export function ContainerScroll({ header, children }: ContainerScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'center center'],
  });
  const rotateX = useTransform(scrollYProgress, [0, 1], [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.94, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [36, 0]);

  const frame = (
    <div className="rounded-xl border border-border bg-card p-2 shadow-[0_24px_80px_-24px_rgba(5,150,105,0.28)]">
      <div className="w-full min-w-0 overflow-hidden rounded-lg border border-border [&_img]:h-auto [&_img]:w-full">
        {children}
      </div>
    </div>
  );

  return (
    <div
      ref={ref}
      className="flex w-full flex-col items-center py-8"
      style={{ perspective: '1200px' }}
    >
      <div className="mx-auto w-full max-w-3xl">{header}</div>
      {reduce ? (
        <BlurFade inView className="mt-8 w-full max-w-6xl sm:mt-10">
          {frame}
        </BlurFade>
      ) : (
        <motion.div
          style={{ rotateX, scale, y, transformOrigin: 'top' }}
          className="mt-8 w-full max-w-6xl sm:mt-10"
        >
          {frame}
        </motion.div>
      )}
    </div>
  );
}
