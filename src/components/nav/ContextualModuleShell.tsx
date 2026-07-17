'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageFrame } from '@/components/PageFrame';
import { Disclosure, DisclosureContent, DisclosureTrigger } from '@/components/ui/disclosure';
import {
  contextualDestinationForPath,
  contextualModule,
  type ContextualModule as ContextualModuleModel,
  type ContextualModuleId,
} from '@/modules/contextual-navigation';
import { cn } from '@/lib/utils';

export function ContextualRail({
  module,
  pathname,
}: Readonly<{ module: ContextualModuleModel; pathname: string }>) {
  const active = contextualDestinationForPath(module, pathname);

  return (
    <aside
      data-og-context-rail={module.id}
      className="w-60 shrink-0 overflow-y-auto border-r border-border/80 bg-card px-3 py-5"
    >
      <Disclosure
        open={module.railDefaultOpen}
        data-default-open={module.railDefaultOpen || undefined}
        className="border-0 bg-transparent shadow-none"
      >
        <DisclosureTrigger className="rounded-md px-2.5 py-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground hover:bg-muted/60 hover:text-foreground">
          {module.label}
        </DisclosureTrigger>
        <DisclosureContent className="p-0 pt-1.5">
          <nav aria-label={`${module.label} destinations`} className="space-y-1">
            {module.destinations.map((destination) => {
              const isActive = active?.id === destination.id;
              return (
                <Link
                  key={destination.id}
                  href={destination.route}
                  data-og-interactive
                  data-active={isActive || undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'block rounded-md px-2.5 py-2.5 transition-colors',
                    isActive
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                  )}
                >
                  <span className="block text-[13px] font-medium">{destination.label}</span>
                  <span
                    className={cn(
                      'mt-1 block text-[10px] leading-relaxed',
                      isActive ? 'text-background/70' : 'text-muted-foreground',
                    )}
                  >
                    {destination.description}
                  </span>
                </Link>
              );
            })}
          </nav>
        </DisclosureContent>
      </Disclosure>
    </aside>
  );
}

export function ContextualModuleHeader({ module }: Readonly<{ module: ContextualModuleModel }>) {
  return (
    <header data-og-page-identity={module.ownerId} className="space-y-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Solutions</p>
      <h1 className="text-lg font-semibold text-foreground">{module.label}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">{module.description}</p>
    </header>
  );
}

/**
 * Canonical management shell for a level-2 module with several level-3 destinations. Presentation
 * state (the disclosure) stays local; every navigational position is a real Link-backed route.
 */
export function ContextualModuleShell({
  moduleId,
  children,
}: Readonly<{ moduleId: ContextualModuleId; children: ReactNode }>) {
  const pathname = usePathname();
  const module = contextualModule(moduleId);

  return (
    <PageFrame className="overflow-hidden p-0 md:p-0">
      <div className="flex h-full min-h-0 w-full">
        <ContextualRail module={module} pathname={pathname} />
        <section className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="w-full space-y-6">
            <ContextualModuleHeader module={module} />
            <div data-og-context-content>{children}</div>
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
