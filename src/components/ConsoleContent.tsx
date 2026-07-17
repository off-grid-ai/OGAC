import type { ReactNode } from 'react';
import { PageTransition } from '@/components/PageTransition';

export function ConsoleContent({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
      <PageTransition>{children}</PageTransition>
    </main>
  );
}
