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
  actions,
}: Readonly<{ moduleId: ContextualModuleId; children: ReactNode; actions?: ReactNode }>) {
  const pathname = usePathname();
  const module = contextualModule(moduleId);
  const destination =
    contextualDestinationForPath(module, pathname) ?? defaultContextualDestination(module);

  return (
    <PageFrame>
      <section aria-labelledby={`context-heading-${destination.id}`} className="w-full space-y-6">
        <header className="flex flex-col gap-3 border-b border-border/80 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h2 id={`context-heading-${destination.id}`} className="text-base font-medium">
              {destination.label}
            </h2>
            <p className="max-w-3xl text-xs text-muted-foreground">{destination.description}</p>
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {actions}
            </div>
          ) : null}
        </header>
        <div data-og-context-content>{children}</div>
      </section>
    </PageFrame>
  );
}
