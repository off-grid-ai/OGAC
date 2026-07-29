'use client';

import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ControlPlaneHero } from '@/app/_landing/control-plane-hero';

// ─── The scroll stage ─────────────────────────────────────────────────────────────────────────────
//
// The animation starts contained under the hero copy and GROWS as you scroll, until it is pinned at
// the full viewport — 100vw x 100vh. The camera work was authored for a 1600x900 stage, so the more
// width it gets the closer it runs to native; at full viewport on a 16:9 display it is exact.
//
// The wrapper is deliberately taller than the viewport: the `sticky` child pins the stage when the
// wrapper's top reaches the top of the screen, and the growth plays out over the scroll for which it
// stays pinned. The growth finishes EARLY in that window and then holds at full bleed, so the stage
// dwells at 100vw x 100vh long enough to actually watch — rather than reaching full size exactly as
// it starts scrolling away, which is the same as never getting there.
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
/** Wrapper height in vh. The sticky child is 100vh, so the pinned scroll range is this minus 100. */
const WRAP_VH = 260;
/** Fraction of the pinned scroll over which the stage grows; it holds at full bleed after this. */
const GROW_END = 0.35;

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

  // ['start start', 'end end'] maps EXACTLY onto the interval the sticky child is pinned for: progress 0
  // the moment the wrapper's top reaches the top of the screen, 1 when its bottom reaches the bottom.
  // An earlier attempt used ['start end', 'start start'], which starts counting as soon as the wrapper
  // enters the viewport — so at page load the stage was already ~50% expanded and bled past the
  // container before anyone had scrolled. It must sit contained until it pins, then grow.
  const { scrollYProgress } = useScroll({ target: wrapRef, offset: ['start start', 'end end'] });

  const expand = vp.w >= MOBILE_BREAKPOINT && !reduce;
  const startW = Math.max(0, Math.min(CONTAINER_MAX, vp.w) - CONTAINER_PAD);
  const startH = (startW * STAGE_H) / STAGE_W;

  // GROW EARLY, THEN HOLD. Spreading the growth across the whole pin meant the stage only reached full
  // bleed at the instant it began leaving — you watched it get bigger and then it was gone, which is no
  // payoff at all. It finishes in the first GROW_END of the pinned scroll and STAYS at 100vw x 100vh for
  // the rest, so there is a real dwell on the product.
  const width = useTransform(scrollYProgress, [0, GROW_END, 1], [startW, vp.w, vp.w]);
  const height = useTransform(scrollYProgress, [0, GROW_END, 1], [startH, vp.h, vp.h]);
  const radius = useTransform(scrollYProgress, [0, GROW_END, 1], [12, 0, 0]);
  const borderOpacity = useTransform(scrollYProgress, [0, GROW_END * 0.8, GROW_END], [1, 1, 0]);

  /** Document offset at which the stage is exactly full bleed — the snap target. */
  const snapOffset = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    return top + GROW_END * (WRAP_VH - 100) * window.innerHeight * 0.01;
  }, []);

  // While the stage owns the whole viewport the sticky site header sits on top of the artwork and
  // obscures it. Flagged on the document root rather than prop-drilled, because the header is rendered
  // by a server component — CSS keys off `[data-stage-immersed]` (see globals.css).
  //
  // The UPPER bound is load-bearing: progress stays at 1 forever once the wrapper has been scrolled
  // past, so keying only on "expanded" would hide the header for the rest of the page.
  const immersedRef = useRef(false);
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const immersed = expand && p >= GROW_END * 0.85 && p <= 0.99;
    immersedRef.current = immersed;
    document.documentElement.toggleAttribute('data-stage-immersed', immersed);
  });

  // Never leave the header hidden if this unmounts mid-scroll (route change, theme remount).
  useEffect(() => () => document.documentElement.removeAttribute('data-stage-immersed'), []);

  // ── Resistance ──────────────────────────────────────────────────────────────────────────────────
  //
  // Native proximity snap (the marker below) settles the stage into full bleed. This adds two things on
  // top:
  //
  //   ASSIST — once the reader is close and has stopped, the stage glides itself into the exact
  //   position, so nobody has to land the scroll precisely to see it framed properly. It arms on
  //   APPROACH as well as on hold, which is the difference between "it snaps if you get it right" and
  //   "it finishes the job for you".
  //
  //   RESISTANCE — once settled, small scrolls are absorbed so it does not immediately roll back off,
  //   and a deliberate scroll leaves.
  //
  // It ACCUMULATES INTENT rather than blocking events. Deltas are summed while immersed; under the
  // budget the stage eases back to the snap point, and once the sum crosses it the resistance
  // disengages until the reader leaves and returns. Nothing is preventDefault-ed, so trackpad momentum,
  // keyboard, scrollbar dragging and find-in-page all keep working — the failure mode of scroll
  // hijacking is a page that fights the reader, and by construction this one cannot.
  useEffect(() => {
    if (!expand || reduce) return;
    const RELEASE_PX = 220;
    // How close counts as "close enough to help". Generous on approach (you are heading here) and a
    // little tighter on the far side (you may be leaving on purpose).
    const ASSIST_BEFORE = 0.24;
    const ASSIST_AFTER = 0.30;
    let intent = 0;
    let released = false;
    let timer: number | undefined;

    /** Near enough that finishing the job for the reader is a help rather than a hijack. */
    const inAssistBand = () => {
      const p = scrollYProgress.get();
      return p > GROW_END - ASSIST_BEFORE && p < Math.min(0.99, GROW_END + ASSIST_AFTER);
    };

    const settle = () => {
      if (released || !inAssistBand()) return;
      const target = snapOffset();
      if (target === null || Math.abs(window.scrollY - target) < 4) return;
      window.scrollTo({ top: target, behavior: 'smooth' });
    };

    const onDelta = (dy: number) => {
      // Outside the band nothing is armed, and the release budget resets — so leaving and coming back
      // gets the assist again rather than being permanently opted out.
      if (!inAssistBand()) {
        intent = 0;
        released = false;
        return;
      }
      // Only the HOLD costs intent. Approaching the snap point should not spend the budget that exists
      // to let someone leave, otherwise arriving would immediately disarm the assist.
      if (immersedRef.current) {
        intent += Math.abs(dy);
        if (intent >= RELEASE_PX) {
          released = true;
          return;
        }
      }
      window.clearTimeout(timer);
      // Only act once the reader has paused, so this never fights an in-flight gesture.
      timer = window.setTimeout(settle, 140);
    };

    const onWheel = (e: WheelEvent) => onDelta(e.deltaY);
    let lastTouch = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastTouch = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      onDelta(lastTouch - y);
      lastTouch = y;
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [expand, reduce, snapOffset, scrollYProgress]);

  // Until measured (SSR / first paint), and on mobile, render the plain contained stage.
  if (!expand) {
    return (
      <div className="mx-auto max-w-[100rem] px-4 pb-12 sm:px-6 sm:pb-16 lg:pb-20">
        <ControlPlaneHero />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative" style={{ height: `${WRAP_VH}vh` }}>
      {/* The snap point, at exactly the offset where the stage reaches full bleed. Native CSS
          scroll-snap does the settling — `proximity` (not `mandatory`) means the browser eases into it
          when the reader comes to rest nearby and NEVER blocks scrolling past. It clicks into place; it
          does not trap. Derived from the geometry rather than hardcoded. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 h-px w-px"
        style={{ top: `${GROW_END * (WRAP_VH - 100)}vh`, scrollSnapAlign: 'start' }}
      />
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
        <motion.div style={{ width, height, borderRadius: radius }} className="relative overflow-hidden">
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
