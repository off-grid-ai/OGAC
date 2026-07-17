'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageFrame } from '@/components/PageFrame';
import {
  contextualDestinationForPath,
  contextualModule,
  defaultContextualDestination,
  type ContextualModuleId,
} from '@/modules/contextual-navigation';

/**
 * Canonical management shell for a level-2 module. The global Sidebar owns the collapsible route
 * hierarchy; this shell owns the route's only H1 and content frame.
 */
export function ContextualModuleShell({
  moduleId,
  children,
}: Readonly<{ moduleId: ContextualModuleId; children: ReactNode }>) {
  const pathname = usePathname();
  const module = contextualModule(moduleId);
  const destination =
    contextualDestinationForPath(module, pathname) ?? defaultContextualDestination(module);

  return (
    <PageFrame>
      <section aria-labelledby={`context-heading-${destination.id}`} className="w-full space-y-6">
        <header className="space-y-1.5 border-b border-border/80 pb-4">
          <h2 id={`context-heading-${destination.id}`} className="text-base font-medium">
            {destination.label}
          </h2>
          <p className="max-w-3xl text-xs text-muted-foreground">{destination.description}</p>
        </header>
        <div data-og-context-content>{children}</div>
      </section>
    </PageFrame>
  );
}
