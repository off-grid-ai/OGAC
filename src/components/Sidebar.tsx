'use client';

import { BookOpen, CaretRight } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getEnabledModules } from '@/lib/modules';
import { cn } from '@/lib/utils';
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

  // Resolve which sidebar row the current URL should light (longest-matching route wins so /agents/x
  // beats /a), then highlight that module's group landing — so being on a secondary route (e.g.
  // /policy) keeps its section's primary row (Control) active, and the builder's /apps/* surfaces
  // (which have no module of their own) keep the Build → Apps row lit. Pure resolution in groups.ts.
  const activeId = sidebarActiveIdForPath(pathname);
  const activeSectionId = sidebarSectionIdForActiveId(sections, activeId);
  const [openSectionId, setOpenSectionId] = useState<string | null>(activeSectionId ?? null);

  // Keep one compact branch open when navigation crosses areas. The user can still collapse the
  // current branch; this only runs when the route resolves to a different canonical section.
  useEffect(() => {
    setOpenSectionId(activeSectionId ?? null);
  }, [activeSectionId]);

  return (
    <>
      <div className="flex h-16 items-center gap-3 border-b border-border/80 px-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background">
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
        {sections.map((section) => (
          <div key={section.id} className="mb-1 last:mb-0">
            <button
              type="button"
              aria-expanded={openSectionId === section.id}
              aria-controls={`nav-section-${section.id}`}
              onClick={() =>
                setOpenSectionId((current) => (current === section.id ? null : section.id))
              }
              className={cn(
                'group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors',
                openSectionId === section.id
                  ? 'bg-muted/70 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-md border bg-background transition-colors',
                  openSectionId === section.id
                    ? 'border-primary/40 text-primary'
                    : 'border-border/80 text-muted-foreground group-hover:text-foreground',
                )}
              >
                {(() => {
                  const SectionIcon = MODULE_ICONS[section.items[0].gate];
                  return <SectionIcon className="size-3.5" />;
                })()}
              </span>
              <span className="min-w-0 flex-1 truncate">{section.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {section.items.length}
              </span>
              <CaretRight
                className={cn(
                  'size-3.5 shrink-0 transition-transform duration-150',
                  openSectionId === section.id && 'rotate-90 text-foreground',
                )}
              />
            </button>

            <div
              id={`nav-section-${section.id}`}
              hidden={openSectionId !== section.id}
              className="relative ml-6 mt-1 space-y-0.5 border-l border-border/80 pl-3"
            >
              {section.items.map((m) => {
                const active = activeId === m.id;
                return (
                  <Link
                    key={m.id}
                    href={m.route}
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
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    {m.comingSoon ? (
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
        ))}
      </nav>

      <div className="border-t border-border/80 p-3">
        <a
          href="/docs"
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
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border/80 bg-card md:flex">
      <SidebarNav />
    </aside>
  );
}
