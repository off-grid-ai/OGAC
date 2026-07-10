'use client';

import Image from 'next/image';
import { type TourShot } from '@/lib/landing-hero';
import { BlurFade } from '@/components/ui/blur-fade';
import { CardsCarousel } from '@/components/ui/cards-carousel';
import { ContainerScroll } from '@/components/ui/container-scroll';
import { BookCallDialog } from '@/components/auth/BookCallDialog';

// The centerpiece: the whole real product, live. The top stage shows the lead product shot on the
// macOS scroll-rotate frame; the rail below lets a visitor tap any surface to open it full screen.
// Presentation only - holds no state or logic.
export function ProductTour({ shots }: { shots: TourShot[] }) {
  const hero = shots[0];

  return (
    <div id="tour" className="scroll-mt-20">
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
              A tour of the real console, screen by screen. Book a demo and we will walk you through
              it on your own data.
            </p>
          </div>
        }
      >
        {hero ? (
          <Image
            src={hero.src}
            alt={hero.alt}
            width={1600}
            height={1000}
            priority
            className="h-auto w-full"
          />
        ) : null}
      </ContainerScroll>

      <BlurFade inView>
        <div className="mt-10">
          <p className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Tap any surface to open it full screen
          </p>
          <CardsCarousel cards={shots} />
        </div>
      </BlurFade>

      <BlurFade inView>
        <div className="mx-auto mt-10 flex max-w-xs justify-center">
          <BookCallDialog label="Book a demo" variant="default" size="lg" className="w-full" />
        </div>
      </BlurFade>
    </div>
  );
}
