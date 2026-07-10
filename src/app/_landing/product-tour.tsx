'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useCallback } from 'react';
import { resolveShot, togglePromoted, type TourShot } from '@/lib/landing-hero';
import { BlurFade } from '@/components/ui/blur-fade';
import { CardsCarousel } from '@/components/ui/cards-carousel';
import { ContainerScroll } from '@/components/ui/container-scroll';
import { BookCallDialog } from '@/components/auth/BookCallDialog';

// The centerpiece: the whole real product, live. The top stage shows one product shot; the rail
// below lets a visitor click any surface to zoom it full-res OR promote it onto the stage. The
// promoted shot is held in the URL (?shot=<id>) so the tour is deep-linkable and Back-coherent
// (the nav rule). The pure decisions (resolve / toggle / active index) live in lib/landing-hero.
export function ProductTour({ shots }: { shots: TourShot[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const shotParam = params.get('shot');

  const hero = resolveShot(shots, shotParam);
  // The rail marks a card "on stage" only when the URL explicitly promoted a known shot - not the
  // default fallback. resolveShot returning a shot whose id equals the param proves it was explicit.
  const promotedId = hero.id === shotParam ? hero.id : null;

  const promote = useCallback(
    (id: string) => {
      const next = togglePromoted(shotParam, id);
      const qs = new URLSearchParams(Array.from(params.entries()));
      if (next) qs.set('shot', next);
      else qs.delete('shot');
      const query = qs.toString();
      router.push(query ? `/?${query}#tour` : '/#tour', { scroll: false });
    },
    [params, router, shotParam],
  );

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
        <Image
          key={hero.id}
          src={hero.src}
          alt={hero.alt}
          width={1600}
          height={1000}
          priority
          className="og-fade-in h-auto w-full"
        />
      </ContainerScroll>

      <BlurFade inView>
        <div className="mt-10">
          <p className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Tap a surface to zoom, or send it to the stage above
          </p>
          <CardsCarousel cards={shots} onPromote={promote} promotedId={promotedId} />
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
