'use client';

import { ArrowsOut, CaretLeft, CaretRight } from '@phosphor-icons/react';
import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';
import { BookCallDialog } from '@/components/auth/BookCallDialog';
import { BlurFade } from '@/components/ui/blur-fade';
import { CardsCarousel, Lightbox } from '@/components/ui/cards-carousel';
import { ContainerScroll } from '@/components/ui/container-scroll';
import { stepIndex, type TourShot } from '@/lib/landing-hero';
import { cn } from '@/lib/utils';

// The centerpiece: the whole real product, live, in ONE viewer. The hero shows the selected surface
// on the macOS scroll-rotate frame with on-screen prev/next arrows (and ←/→ keys); clicking it opens
// the full-screen lightbox (which steps through every surface too). The filmstrip below promotes any
// surface to the hero and scrolls the page up to it. This component owns the shared selection so the
// hero, the strip, and the lightbox all stay in sync.
export function ProductTour({ shots }: Readonly<{ shots: TourShot[] }>) {
  const [index, setIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const current = shots[index];
  const atStart = index <= 0;
  const atEnd = index >= shots.length - 1;

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => stepIndex(shots.length, i, dir)),
    [shots.length],
  );

  // Selecting a surface from the filmstrip promotes it to the hero AND scrolls the page up to the
  // hero so the visitor sees their choice in the big viewer (the "scroll to this one" behaviour).
  const selectFromRail = useCallback((i: number) => {
    setIndex(i);
    heroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const onHeroKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    },
    [go],
  );

  return (
    <div id="tour" className="scroll-mt-20">
      <div ref={heroRef} className="scroll-mt-24">
        <ContainerScroll
          header={
            <div className="text-center">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                Take the tour
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                See the whole product.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
                A tour of the real console, screen by screen. Use the arrows, or tap any surface
                below. Book a demo and we will walk you through it on your own data.
              </p>
            </div>
          }
        >
          {current ? (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- arrow keys are a
            // convenience over the always-present buttons; the frame is not itself a control.
            <div
              className="group relative h-full w-full outline-none"
              tabIndex={0}
              onKeyDown={onHeroKey}
              aria-label="Product tour viewer - use left and right arrow keys to change surface"
            >
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                aria-label={`Open ${current.label} full screen`}
                className="relative block h-full w-full cursor-zoom-in overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Image
                  src={current.src}
                  alt={current.alt}
                  width={1600}
                  height={1000}
                  priority
                  className="h-auto w-full"
                />
                <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-border bg-background/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-foreground/80 opacity-0 backdrop-blur transition-opacity duration-200 group-hover:opacity-100">
                  <ArrowsOut className="size-3.5" weight="bold" />
                  Full screen
                </span>
              </button>

              <button
                type="button"
                onClick={() => go(-1)}
                disabled={atStart}
                aria-label="Previous surface"
                className={cn(
                  'absolute left-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 text-foreground/80 backdrop-blur transition sm:left-4',
                  'hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                  'disabled:cursor-not-allowed disabled:opacity-25',
                )}
              >
                <CaretLeft className="size-5" weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={atEnd}
                aria-label="Next surface"
                className={cn(
                  'absolute right-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 text-foreground/80 backdrop-blur transition sm:right-4',
                  'hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                  'disabled:cursor-not-allowed disabled:opacity-25',
                )}
              >
                <CaretRight className="size-5" weight="bold" />
              </button>

              <span className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/85 px-3 py-1 backdrop-blur">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                  {current.label}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {index + 1} / {shots.length}
                </span>
              </span>
            </div>
          ) : null}
        </ContainerScroll>
      </div>

      <BlurFade inView>
        <div className="mt-10">
          <p className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Tap any surface to show it above, or click the viewer to open it full screen
          </p>
          <CardsCarousel cards={shots} activeIndex={index} onSelect={selectFromRail} />
        </div>
      </BlurFade>

      <BlurFade inView>
        <div className="mx-auto mt-10 flex max-w-xs justify-center">
          <BookCallDialog label="Book a demo" variant="default" size="lg" className="w-full" />
        </div>
      </BlurFade>

      {zoomOpen && (
        <Lightbox
          cards={shots}
          index={index}
          onIndex={setIndex}
          onClose={() => setZoomOpen(false)}
        />
      )}
    </div>
  );
}
