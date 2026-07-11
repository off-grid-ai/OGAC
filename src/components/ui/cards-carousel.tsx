'use client';

import { CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nextFocusTarget, stepIndex } from '@/lib/landing-hero';
import { cn } from '@/lib/utils';

// The product-tour surfaces. The RAIL below the hero is a filmstrip SELECTOR: tapping a card
// promotes that surface to the big hero viewer (onSelect) and the page scrolls up to it - it no
// longer opens the lightbox directly. The hero is the single viewer; clicking the hero opens the
// full-screen Lightbox, which itself steps through every surface with the arrow keys / on-screen
// arrows. Framed to the Off Grid charcoal/emerald system, both themes via tokens.
export interface CarouselCard {
  id: string;
  src: string;
  alt: string;
  label: string;
  caption: string;
}

interface CardsCarouselProps {
  cards: CarouselCard[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export function CardsCarousel({ cards, activeIndex, onSelect }: Readonly<CardsCarouselProps>) {
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
        {cards.map((card, i) => (
          <li
            key={card.id}
            className="group relative w-[82%] shrink-0 snap-start sm:w-[52%] lg:w-[38%] xl:w-[30%]"
          >
            <figure
              className={cn(
                'overflow-hidden rounded-xl border bg-card transition-colors',
                i === activeIndex
                  ? 'border-primary ring-1 ring-primary/40'
                  : 'border-border hover:border-primary/40',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-label={`Show ${card.label} in the viewer`}
                aria-current={i === activeIndex ? 'true' : undefined}
                className="relative block aspect-[16/10] w-full overflow-hidden border-b border-border/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Image
                  src={card.src}
                  alt={card.alt}
                  fill
                  sizes="(max-width: 640px) 82vw, (max-width: 1280px) 40vw, 30vw"
                  className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                />
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
          aria-label="Scroll surfaces left"
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
          aria-label="Scroll surfaces right"
          className={cn(
            'flex size-11 items-center justify-center rounded-full border border-border text-foreground/80 transition',
            'hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
            'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-foreground/80',
          )}
        >
          <CaretRight className="size-4" weight="bold" />
        </button>
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Tap a surface to show it above
        </span>
      </div>
    </div>
  );
}

// A focus-trapped, backdrop/esc-closable FULL-SCREEN viewer that steps through ALL surfaces:
// ArrowRight/ArrowLeft (and the on-screen prev/next arrows) move to the neighbouring surface,
// CLAMPED at the ends (stepIndex). The active index is lifted to the parent (onIndex) so the hero
// underneath stays in sync. Focus is trapped inside so keyboard users cannot tab out behind it.
interface LightboxProps {
  cards: CarouselCard[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

export function Lightbox({ cards, index, onIndex, onClose }: Readonly<LightboxProps>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const card = cards[index];
  const atStart = index <= 0;
  const atEnd = index >= cards.length - 1;

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
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        onIndex(stepIndex(cards.length, index, e.key === 'ArrowRight' ? 1 : -1));
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
  }, [onClose, onIndex, cards.length, index]);

  // Portal to <body> so `fixed inset-0` resolves against the VIEWPORT, not a transformed ancestor.
  if (typeof document === 'undefined' || !card) return null;
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
        <span className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {index + 1} / {cards.length}
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
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-6">
        {/* Prev / next arrows overlaid on the image, clamped at the ends. */}
        <button
          type="button"
          onClick={() => onIndex(stepIndex(cards.length, index, -1))}
          disabled={atStart}
          aria-label="Previous surface"
          className={cn(
            'absolute left-3 top-1/2 z-10 flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 text-foreground/80 backdrop-blur transition sm:left-6',
            'hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
            'disabled:cursor-not-allowed disabled:opacity-25',
          )}
        >
          <CaretLeft className="size-5" weight="bold" />
        </button>
        <Image
          src={card.src}
          alt={card.alt}
          width={2400}
          height={1500}
          priority
          className="h-auto max-h-[86vh] w-auto max-w-full rounded-lg border border-border object-contain shadow-2xl"
        />
        <button
          type="button"
          onClick={() => onIndex(stepIndex(cards.length, index, 1))}
          disabled={atEnd}
          aria-label="Next surface"
          className={cn(
            'absolute right-3 top-1/2 z-10 flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 text-foreground/80 backdrop-blur transition sm:right-6',
            'hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
            'disabled:cursor-not-allowed disabled:opacity-25',
          )}
        >
          <CaretRight className="size-5" weight="bold" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
