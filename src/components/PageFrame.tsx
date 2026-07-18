import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A route opts into management-page presentation by rendering this frame. Immersive routes simply
// render their canvas directly, so Layout and ConsoleContent stay full-size and presentation-free.
export function PageFrame({
  children,
  className,
  embedded = false,
}: Readonly<{ children: ReactNode; className?: string; embedded?: boolean }>) {
  // A contextual module shell already owns scrolling, padding, and the leaf heading. Reusing a
  // standalone management surface inside that shell must not create a second inset container.
  if (embedded) return children;

  return (
    <div
      data-og-shell="page"
      className={cn(
        'h-full min-h-0 w-full min-w-0 overflow-y-auto bg-background p-4 md:p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}
