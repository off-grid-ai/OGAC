'use client';

import { ArrowsOut, CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nextFocusTarget } from '@/lib/landing-hero';
import { cn } from '@/lib/utils';

// A horizontal, scroll-snapping rail of real product surfaces. Tap any card to open it FULL-SCREEN
// in a focus-trapped lightbox (closed by esc / backdrop / the button). Native scroll-snap keeps it
// keyboard/touch accessible; framed to the Off Grid charcoal/emerald system, both themes via tokens.
export interface CarouselCard {
  id: string;
  src: string;
  alt: string;
  label: string;
  caption: string;
}

interface CardsCarouselProps {
  cards: CarouselCard[];
}

export function CardsCarousel({ cards }: CardsCarouselProps) {
  const railRef = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [zoomed, setZoomed] = useState<CarouselCard | null>(null);

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
            key={card.id}
            className="group relative w-[82%] shrink-0 snap-start sm:w-[52%] lg:w-[38%] xl:w-[30%]"
          >
            <figure className="overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40">
              <button
                type="button"
                onClick={() => setZoomed(card)}
                aria-label={`Open ${card.label} full screen`}
                className="relative block aspect-[16/10] w-full overflow-hidden border-b border-border/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Image
                  src={card.src}
                  alt={card.alt}
                  fill
                  sizes="(max-width: 640px) 82vw, (max-width: 1280px) 40vw, 30vw"
                  className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <span className="pointer-events-none absolute right-2 top-2 flex size-7 items-center justify-center rounded-md border border-border bg-background/80 text-foreground opacity-0 backdrop-blur transition-opacity duration-200 group-hover:opacity-100">
                  <ArrowsOut className="size-4" weight="bold" />
                </span>
              </button>
              <figcaption className="p-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                  {card.label}
                </span>
                <span className="mt-1.5 block text-sm text-muted-foreground">{card.caption}</span>
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
            'flex size-11 items-center justify-center rounded-full border border-border text-foreground/80 transition',
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
            'flex size-11 items-center justify-center rounded-full border border-border text-foreground/80 transition',
            'hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
            'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-foreground/80',
          )}
        >
          <CaretRight className="size-4" weight="bold" />
        </button>
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Tap to zoom
        </span>
      </div>

      {zoomed && <Lightbox card={zoomed} onClose={() => setZoomed(null)} />}
    </div>
  );
}

// A focus-trapped, backdrop/esc-closable FULL-SCREEN view of one surface. Rendered plainly (no
// entrance animation that could leave it invisible); the image fills the viewport, object-contain.
// Focus is trapped inside so keyboard users cannot tab out behind it.
function Lightbox({ card, onClose }: { card: CarouselCard; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Lock body scroll for the life of the overlay ONLY - a mount/unmount effect with no deps.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const activeIndex = Array.from(focusables).indexOf(document.activeElement as HTMLElement);
      const target = nextFocusTarget(focusables.length, activeIndex, e.shiftKey);
      if (!target) return;
      e.preventDefault();
      (target === 'first' ? focusables[0] : focusables[focusables.length - 1]).focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal to <body> so `fixed inset-0` resolves against the VIEWPORT, not a transformed ancestor.
  // The carousel sits inside a motion/BlurFade wrapper whose `transform` would otherwise make this
  // fixed overlay position relative to that box (trapping it mid-page instead of full-screen).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${card.label} - full screen`}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <span className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
            {card.label}
          </span>
          <span className="ml-3 hidden text-sm text-muted-foreground sm:inline">{card.caption}</span>
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border text-foreground/80 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <X className="size-4" weight="bold" />
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close full screen"
        className="flex min-h-0 flex-1 cursor-zoom-out items-center justify-center overflow-auto p-3 sm:p-6"
      >
        <Image
          src={card.src}
          alt={card.alt}
          width={2400}
          height={1500}
          priority
          className="h-auto max-h-[86vh] w-auto max-w-full rounded-lg border border-border object-contain shadow-2xl"
        />
      </button>
    </div>,
    document.body,
  );
}
