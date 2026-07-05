import * as React from 'react';

import { cn } from '@/lib/utils';

// Shared loading placeholder. Pulses via Tailwind's `animate-pulse`, which the global
// `prefers-reduced-motion: reduce` rule in globals.css neutralizes — so it degrades to a
// static block for users who opt out of motion.
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
