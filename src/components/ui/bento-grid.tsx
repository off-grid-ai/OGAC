import { type ComponentType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A compact, asymmetric tile grid. Adapted from the Magic UI BentoGrid to the Off Grid
// charcoal/emerald system: hairline borders, a hover emerald wash, mono labels.
export function BentoGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6', className)}>
      {children}
    </div>
  );
}

export interface BentoTileProps {
  icon: ComponentType<{ className?: string; weight?: 'regular' | 'bold' | 'duotone' }>;
  title: string;
  body: string;
  className?: string;
}

export function BentoTile({ icon: Icon, title, body, className }: BentoTileProps) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-white/10 bg-[#0f0f0f] p-5 transition-colors hover:border-[#34D399]/40',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-[radial-gradient(closest-side,rgba(52,211,153,0.14),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      />
      <div className="relative flex size-9 items-center justify-center rounded-lg border border-white/10 bg-[#34D399]/10 text-[#34D399]">
        <Icon className="size-4" weight="bold" />
      </div>
      <h3 className="relative mt-4 text-sm font-semibold text-white">{title}</h3>
      <p className="relative mt-1.5 text-sm leading-relaxed text-white/55">{body}</p>
    </div>
  );
}
