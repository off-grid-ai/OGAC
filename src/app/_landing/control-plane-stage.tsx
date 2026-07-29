'use client';

import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ControlPlaneHero } from '@/app/_landing/control-plane-hero';

// ─── The scroll stage ─────────────────────────────────────────────────────────────────────────────
//
// The animation starts contained under the hero copy and GROWS as you scroll, until it is pinned at
// the full viewport — 100vw x 100vh. The camera work was authored for a 1600x900 stage, so the more
// width it gets the closer it runs to native; at full viewport on a 16:9 display it is exact.
//
// The wrapper is deliberately taller than the viewport: the `sticky` child pins the stage when the
// wrapper's top reaches the top of the screen, and the expansion plays out over the ~100vh of scroll
// for which it stays pinned. So the stage is contained on arrival, grows while held still, and is at
// full bleed by the time the page moves on.
//
// NOT ON MOBILE. A 16:9 stage expanded into a portrait phone viewport is mostly empty bars, and pinning
// a tall section hijacks the scroll on the device where that is most annoying. Phones keep the
// contained stage and get a landscape full-screen button instead (see ControlPlaneHero).
//
// NOT UNDER REDUCED MOTION: a viewport-filling growth tied to scroll is exactly what that setting is
// asking us not to do.

const STAGE_W = 1600;
const STAGE_H = 900;
/** Container width cap (max-w-[100rem]) and its horizontal padding, so the start size matches the page. */
const CONTAINER_MAX = 1600;
const CONTAINER_PAD = 48;
const MOBILE_BREAKPOINT = 768;

export function ControlPlaneStage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [vp, setVp] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ['start start', 'end end'] maps EXACTLY onto the interval the sticky child is pinned for: progress
  // 0 the moment the wrapper's top reaches the top of the screen, 1 when its bottom reaches the bottom.
  // The first attempt used ['start end', 'start start'], which begins counting as soon as the wrapper
  // enters the viewport — so at page load the stage was already ~50% expanded and bled past the
  // container before anyone had scrolled. It must sit contained until it pins, then grow.
  const { scrollYProgress } = useScroll({
    target: wrapRef,
    offset: ['start start', 'end end'],
  });

  const startW = Math.max(0, Math.min(CONTAINER_MAX, vp.w) - CONTAINER_PAD);
  const startH = (startW * STAGE_H) / STAGE_W;

  const width = useTransform(scrollYProgress, [0, 1], [startW, vp.w]);
  const height = useTransform(scrollYProgress, [0, 1], [startH, vp.h]);
  const radius = useTransform(scrollYProgress, [0, 1], [12, 0]);
  const borderOpacity = useTransform(scrollYProgress, [0, 0.85, 1], [1, 1, 0]);

  // Until measured (SSR / first paint) render the plain contained stage so nothing jumps.
  const expand = vp.w >= MOBILE_BREAKPOINT && !reduce;

  if (!expand) {
    return (
      <div className="mx-auto max-w-[100rem] px-4 pb-12 sm:px-6 sm:pb-16 lg:pb-20">
        <ControlPlaneHero />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-[200vh]">
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
        <motion.div
          style={{ width, height, borderRadius: radius, opacity: 1 }}
          className="relative overflow-hidden"
        >
          {/* The border fades out as the stage reaches full bleed — a 1px frame around the whole
              viewport reads as a rendering artifact rather than a frame. */}
          <motion.span
            aria-hidden
            style={{ opacity: borderOpacity, borderRadius: radius }}
            className="pointer-events-none absolute inset-0 z-30 border border-border"
          />
          <ControlPlaneHero fill />
        </motion.div>
      </div>
    </div>
  );
}
