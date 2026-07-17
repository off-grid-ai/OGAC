'use client';

import { BookOpen, CaretRight } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Disclosure, DisclosureContent, DisclosureTrigger } from '@/components/ui/disclosure';
import { getEnabledModules } from '@/lib/modules';
import { cn } from '@/lib/utils';
import {
  contextualDestinationForPath,
  contextualModuleForOwner,
  contextualModuleForPath,
  type ContextualModuleId,
} from '@/modules/contextual-navigation';
import {
  sidebarActiveIdForPath,
  sidebarSectionIdForActiveId,
  sidebarSections,
} from '@/modules/groups';
import { MODULE_ICONS } from '@/modules/icons';

// The nav body (logo header + grouped rows + docs footer). Rendered in TWO places — the fixed
// desktop `<aside>` below and the mobile slide-in drawer (Topbar) — so it lives here ONCE as the
// single source of truth (DRY). `onNavigate` lets the drawer close itself when a row is tapped;
// the desktop aside passes nothing.
export function SidebarNav({ onNavigate }: Readonly<{ onNavigate?: () => void }>) {
  const pathname = usePathname();
  const modules = getEnabledModules();
  const sections = sidebarSections(modules);

  // Resolve which sidebar row the current URL should light (longest-matching route wins), including
  // contextual resources that deliberately highlight their owning collection. Pure resolution lives
  // in groups.ts so the desktop rail and mobile drawer cannot drift.
  const activeId = sidebarActiveIdForPath(pathname);
  const activeSectionId = sidebarSectionIdForActiveId(sections, activeId);
  const activeContextualModule = contextualModuleForPath(pathname);
  // Inactive domains start collapsed. Deep links expose their active ancestors, and both levels can
  // still be collapsed manually after that reveal.
  const [openSectionId, setOpenSectionId] = useState<string | null>(activeSectionId ?? null);
  const [openContextualModuleId, setOpenContextualModuleId] = useState<ContextualModuleId | null>(
    activeContextualModule?.id ?? null,
  );

  useEffect(() => {
    setOpenSectionId(activeSectionId ?? null);
  }, [activeSectionId]);

  useEffect(() => {
    setOpenContextualModuleId(activeContextualModule?.id ?? null);
  }, [activeContextualModule?.id]);

  return (
    <>
      <div
        data-og-shell="brand"
        className="flex h-14 items-center gap-3 border-b border-border/80 px-4"
      >
        <div
          data-og-surface="raised"
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background"
        >
          <Image src="/logo.png" alt="" width={26} height={26} priority />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-medium tracking-tight text-foreground">
            Off Grid AI
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Control plane
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Primary navigation">
        {sections.map((section) => {
          const expanded = openSectionId === section.id;
          const containsActiveItem = activeSectionId === section.id;
          const SectionIcon = MODULE_ICONS[section.items[0].gate];
          const directItem = section.navigation === 'direct' ? section.items[0] : undefined;

          if (directItem) {
            const active = activeId === directItem.id;
            return (
              <div key={section.id} className="mb-1 last:mb-0">
                <Link
                  href={directItem.route}
                  data-og-interactive
                  data-current-section={active || undefined}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                  className={cn(
                    'group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors',
                    active
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-md border transition-colors',
                      active
                        ? 'border-background/20 bg-background/10 text-background'
                        : 'border-border/80 bg-background text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    <SectionIcon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{section.label}</span>
                </Link>
              </div>
            );
          }

          return (
            <div key={section.id} className="mb-1 last:mb-0">
              <button
                type="button"
                data-og-interactive
                aria-expanded={expanded}
                aria-controls={`nav-section-${section.id}`}
                data-current-section={containsActiveItem || undefined}
                onClick={() =>
                  setOpenSectionId((current) => (current === section.id ? null : section.id))
                }
                className={cn(
                  'group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors',
                  expanded
                    ? 'bg-muted/70 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-md border bg-background transition-colors',
                    expanded || containsActiveItem
                      ? 'border-primary/40 text-primary'
                      : 'border-border/80 text-muted-foreground group-hover:text-foreground',
                  )}
                >
                  <SectionIcon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                {containsActiveItem && !expanded ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                ) : null}
                <CaretRight
                  className={cn(
                    'size-3.5 shrink-0 transition-transform duration-150',
                    expanded && 'rotate-90 text-foreground',
                  )}
                />
              </button>

              <div
                id={`nav-section-${section.id}`}
                hidden={!expanded}
                className="relative ml-6 mt-1 space-y-0.5 border-l border-border/80 pl-3"
              >
                {section.items.map((item) => {
                  const active = activeId === item.id;
                  const contextual = contextualModuleForOwner(item.id);
                  if (contextual) {
                    const contextualOpen = openContextualModuleId === contextual.id;
                    const activeDestination = contextualDestinationForPath(contextual, pathname);
                    return (
                      <Disclosure
                        key={item.id}
                        open={contextualOpen}
                        onToggle={(event) => {
                          const isOpen = event.currentTarget.open;
                          setOpenContextualModuleId((current) => {
                            if (isOpen) return contextual.id;
                            return current === contextual.id ? null : current;
                          });
                        }}
                        className="border-0 bg-transparent shadow-none"
                      >
                        <DisclosureTrigger
                          data-og-interactive
                          data-active={active || undefined}
                          className={cn(
                            'min-h-9 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                            active
                              ? 'bg-foreground font-medium text-background'
                              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                          )}
                        >
                          {item.label}
                        </DisclosureTrigger>
                        <DisclosureContent className="relative ml-2 border-l border-border/80 p-0 pl-3 pt-1">
                          <nav aria-label={`${item.label} destinations`} className="space-y-0.5">
                            {contextual.destinations.map((destination) => {
                              const destinationActive = activeDestination?.id === destination.id;
                              return (
                                <Link
                                  key={destination.id}
                                  href={destination.route}
                                  data-og-interactive
                                  data-active={destinationActive || undefined}
                                  onClick={onNavigate}
                                  aria-current={destinationActive ? 'page' : undefined}
                                  className={cn(
                                    'relative flex min-h-8 items-center rounded-md px-2 py-1 text-[12px] transition-colors',
                                    destinationActive
                                      ? 'bg-primary/10 font-medium text-primary'
                                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'absolute -left-[13px] top-1/2 h-px w-3 -translate-y-1/2',
                                      destinationActive ? 'bg-primary' : 'bg-border',
                                    )}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">{destination.label}</span>
                                </Link>
                              );
                            })}
                          </nav>
                        </DisclosureContent>
                      </Disclosure>
                    );
                  }
                  return (
                    <Link
                      key={item.id}
                      href={item.route}
                      data-og-interactive
                      data-active={active || undefined}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex min-h-9 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-[background-color,color,transform] duration-150 active:scale-[0.99]',
                        active
                          ? 'bg-foreground font-medium text-background'
                          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute -left-[13px] top-1/2 h-px w-3 -translate-y-1/2',
                          active ? 'bg-primary' : 'bg-border',
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.comingSoon ? (
                        <span
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em]',
                            active
                              ? 'border-background/20 text-background/70'
                              : 'border-border text-muted-foreground',
                          )}
                        >
                          Soon
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border/80 p-3">
        <a
          href="/docs"
          data-og-interactive
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNavigate}
          className="group flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/80 bg-background transition-colors group-hover:border-border">
            <BookOpen className="size-3.5" />
          </span>
          <span className="truncate">API docs &amp; playground</span>
        </a>
        <p className="flex items-center gap-2 px-2.5 pt-2.5 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="size-1 bg-primary" aria-hidden="true" />
          Private · governed · on-prem
        </p>
      </div>
    </>
  );
}

// The fixed desktop sidebar. Hidden below `md` (the mobile shell reaches the SAME nav through the
// Topbar's slide-in drawer) so desktop (md+) is byte-for-byte unchanged.
export function Sidebar() {
  return (
    <aside
      data-og-shell="sidebar"
      data-og-surface="raised"
      className="hidden w-64 shrink-0 flex-col border-r border-border/80 bg-card md:flex"
    >
      <SidebarNav />
    </aside>
  );
}
