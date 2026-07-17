'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageTransition } from '@/components/PageTransition';
import { consoleContentMode } from '@/lib/console-content';
import { cn } from '@/lib/utils';

export function ConsoleContent({ children }: Readonly<{ children: ReactNode }>) {
  const mode = consoleContentMode(usePathname());

  return (
    <main
      data-content-mode={mode}
      className={cn(
        'min-h-0 flex-1',
        mode === 'workspace' ? 'overflow-hidden' : 'overflow-y-auto p-4 md:p-6',
      )}
    >
      <PageTransition>{children}</PageTransition>
    </main>
  );
}
