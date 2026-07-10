'use client';

import { BookOpen } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getEnabledModules } from '@/lib/modules';
import { cn } from '@/lib/utils';
import { sidebarActiveIdForPath, sidebarSections } from '@/modules/groups';
import { MODULE_ICONS } from '@/modules/icons';

// The nav body (logo header + grouped rows + docs footer). Rendered in TWO places — the fixed
// desktop `<aside>` below and the mobile slide-in drawer (Topbar) — so it lives here ONCE as the
// single source of truth (DRY). `onNavigate` lets the drawer close itself when a row is tapped;
// the desktop aside passes nothing.
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const modules = getEnabledModules();
  const sections = sidebarSections(modules);

  // Resolve which sidebar row the current URL should light (longest-matching route wins so /agents/x
  // beats /a), then highlight that module's group landing — so being on a secondary route (e.g.
  // /policy) keeps its section's primary row (Control) active, and the builder's /apps/* surfaces
  // (which have no module of their own) keep the Build → Apps row lit. Pure resolution in groups.ts.
  const activeId = sidebarActiveIdForPath(pathname, modules);

  return (
    <>
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <Image src="/logo.png" alt="Off Grid AI" width={28} height={28} priority />
        <div className="leading-tight">
          <div className="text-sm font-medium text-foreground">Off Grid AI</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Console
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {sections.map((section) => (
          <div key={section.label} className="mb-3 last:mb-0">
            <div className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.items.map((m) => {
                const Icon = MODULE_ICONS[m.id];
                const active = activeId === m.id;
                return (
                  <Link
                    key={m.id}
                    href={m.route}
                    onClick={onNavigate}
                    className={cn(
                      'flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-all duration-150 active:scale-[0.98]',
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {m.label}
                    {m.comingSoon ? (
                      <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/80">
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

      <div className="border-t border-border p-2">
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNavigate}
          className="flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BookOpen className="size-4 shrink-0" />
          API docs &amp; playground
        </a>
        <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          One control plane · no lock-in
        </p>
      </div>
    </>
  );
}

// The fixed desktop sidebar. Hidden below `md` (the mobile shell reaches the SAME nav through the
// Topbar's slide-in drawer) so desktop (md+) is byte-for-byte unchanged.
export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <SidebarNav />
    </aside>
  );
}
