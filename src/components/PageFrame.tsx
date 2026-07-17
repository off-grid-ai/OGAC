import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A route opts into management-page presentation by rendering this frame. Immersive routes simply
// render their canvas directly, so Layout and ConsoleContent stay full-size and presentation-free.
export function PageFrame({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div className={cn('h-full min-h-0 w-full min-w-0 overflow-y-auto p-4 md:p-6', className)}>
      {children}
    </div>
  );
}
