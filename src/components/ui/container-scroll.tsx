'use client';

import { type ReactNode } from 'react';
import { BlurFade } from '@/components/ui/blur-fade';

// A clean, STATIC framed stage for a product shot - the Off Grid frame look (charcoal bezel,
// emerald edge, rounded, subtle shadow) with a gentle one-shot entrance reveal (opacity/translate
// via BlurFade). It does NOT couple any transform to scroll position, so the section is compact
// (sized to its image, no reserved dead band above/below), the promoted panel is never clipped,
// and the page scrolls normally at all times. Presentation only - holds no state or logic.
interface ContainerScrollProps {
  header: ReactNode;
  children: ReactNode;
}

export function ContainerScroll({ header, children }: ContainerScrollProps) {
  return (
    <div className="flex w-full flex-col items-center py-8">
      <div className="mx-auto w-full max-w-3xl">{header}</div>
      <BlurFade inView className="mt-8 w-full max-w-6xl sm:mt-10">
        <div className="rounded-xl border border-border bg-card p-2 shadow-[0_24px_80px_-24px_rgba(5,150,105,0.28)]">
          <div className="w-full min-w-0 overflow-hidden rounded-lg border border-border [&_img]:h-auto [&_img]:w-full">
            {children}
          </div>
        </div>
      </BlurFade>
    </div>
  );
}
