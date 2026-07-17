import type { ReactNode } from 'react';
import { PageTransition } from '@/components/PageTransition';

export function ConsoleContent({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 has-[[data-console-layout=full-bleed]]:overflow-hidden has-[[data-console-layout=full-bleed]]:p-0 md:p-6">
      <PageTransition>{children}</PageTransition>
    </main>
  );
}

export function FullBleedContent({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div data-console-layout="full-bleed" className="h-full min-h-0">
      {children}
    </div>
  );
}
