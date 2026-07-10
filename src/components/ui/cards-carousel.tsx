'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// A horizontal, scroll-snapping rail of real product surfaces with prev/next controls.
// Adapted from the Aceternity Apple Cards Carousel: native scroll-snap (keyboard- and
// touch-accessible) instead of drag, framed to the Off Grid charcoal/emerald system.
export interface CarouselCard {
  src: string;
  alt: string;
  label: string;
  caption: string;
}

export function CardsCarousel({ cards }: { cards: CarouselCard[] }) {
  const railRef = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const onScroll = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 8);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  }, []);

  const scrollBy = useCallback((dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 520), behavior: 'smooth' });
  }, []);

  return (
    <div className="relative">
      <ul
        ref={railRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((card) => (
          <li
            key={card.src}
            className="group relative w-[80%] shrink-0 snap-start sm:w-[52%] lg:w-[38%] xl:w-[30%]"
          >
            <figure className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="relative aspect-[16/10] overflow-hidden border-b border-border">
                <Image
                  src={card.src}
                  alt={card.alt}
                  fill
                  sizes="(max-width: 640px) 80vw, (max-width: 1280px) 40vw, 30vw"
                  className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <figcaption className="p-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                  {card.label}
                </span>
                <p className="mt-1.5 text-sm text-muted-foreground">{card.caption}</p>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          disabled={atStart}
          aria-label="Previous surfaces"
          className={cn(
            'flex size-9 items-center justify-center rounded-full border border-border text-foreground/80 transition',
            'hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
            'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-foreground/80',
          )}
        >
          <CaretLeft className="size-4" weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => scrollBy(1)}
          disabled={atEnd}
          aria-label="Next surfaces"
          className={cn(
            'flex size-9 items-center justify-center rounded-full border border-border text-foreground/80 transition',
            'hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
            'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-foreground/80',
          )}
        >
          <CaretRight className="size-4" weight="bold" />
        </button>
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Drag or scroll
        </span>
      </div>
    </div>
  );
}
