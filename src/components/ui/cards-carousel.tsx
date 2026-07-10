'use client';

import { ArrowsOut, CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nextFocusTarget } from '@/lib/landing-hero';
import { cn } from '@/lib/utils';

// A horizontal, scroll-snapping rail of real product surfaces. Each card can be (a) opened in a
// full-res, focus-trapped LIGHTBOX (a transient overlay, closed by esc / backdrop / the button) and
// (b) PROMOTED to the top hero shot via `onPromote` (the page drives that through the URL, so the
// tour is deep-linkable and Back-coherent). Native scroll-snap keeps it keyboard/touch accessible;
// framed to the Off Grid charcoal/emerald system, both themes via semantic tokens.
export interface CarouselCard {
  id: string;
  src: string;
  alt: string;
  label: string;
  caption: string;
}

interface CardsCarouselProps {
  cards: CarouselCard[];
  /** Called when a card is chosen as the hero shot. The page reflects it in the URL. */
  onPromote?: (id: string) => void;
  /** The id currently promoted to the hero, so the rail can mark it. */
  promotedId?: string | null;
}

export function CardsCarousel({ cards, onPromote, promotedId }: CardsCarouselProps) {
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
        {cards.map((card) => {
          const isHero = card.id === promotedId;
          return (
            <li
              key={card.id}
              className="group relative w-[82%] shrink-0 snap-start sm:w-[52%] lg:w-[38%] xl:w-[30%]"
            >
              <figure
                className={cn(
                  'overflow-hidden rounded-xl border bg-card transition-colors',
                  isHero ? 'border-primary/70' : 'border-border hover:border-primary/40',
                )}
              >
                <button
                  type="button"
                  onClick={() => setZoomed(card)}
                  aria-label={`Open ${card.label} full size`}
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
                <figcaption className="flex items-start justify-between gap-3 p-4">
                  <span className="min-w-0">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                      {card.label}
                    </span>
                    <span className="mt-1.5 block text-sm text-muted-foreground">
                      {card.caption}
                    </span>
                  </span>
                  {onPromote && (
                    <button
                      type="button"
                      onClick={() => onPromote(card.id)}
                      aria-pressed={isHero}
                      className={cn(
                        'mt-0.5 flex min-h-[44px] shrink-0 items-center rounded-md border px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                        isHero
                          ? 'border-primary/60 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                      )}
                    >
                      {isHero ? 'On stage' : 'To hero'}
                    </button>
                  )}
                </figcaption>
              </figure>
            </li>
          );
        })}
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

// A focus-trapped, backdrop/esc-closable full-res view of one surface. The final image is always
// rendered (never hidden behind an animation); the fade is opacity-only, honored under reduced
// motion by globals.css. Focus is trapped inside so keyboard users cannot tab out behind it.
function Lightbox({ card, onClose }: { card: CarouselCard; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Lock body scroll for the life of the overlay ONLY - a mount/unmount effect with no deps, so a
  // parent re-render (e.g. the rail's onScroll updating atStart/atEnd) can never re-run it and leave
  // the lock stranded. prevOverflow is captured once at mount and restored once at unmount, so
  // closing (esc / backdrop / button) always restores page scroll.
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${card.label} - full size`}
      className="og-fade-in fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="relative flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_40px_120px_-30px_rgba(5,150,105,0.35)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <span className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
              {card.label}
            </span>
            <span className="ml-3 text-sm text-muted-foreground">{card.caption}</span>
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
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 sm:p-3">
          <Image
            src={card.src}
            alt={card.alt}
            width={1600}
            height={1000}
            className="h-auto max-h-[82vh] w-auto max-w-full rounded-lg object-contain"
          />
        </div>
      </div>
    </div>
  );
}
