'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SubNav } from '@/components/nav/SubNav';
import { activeTabForPath, lifecycleTabs } from '@/lib/app-lifecycle';
import { cn } from '@/lib/utils';

// ─── AppLifecycleNav (Builder Epic #116) — the per-app scoped SubNav band ─────────────────────────
//
// The founder's ask: "opening an app gives ITS OWN surface with the 5 screens as tabs, scoped to
// that app." This is that band. Every saved app lives under /apps/<id>; this renders the five
// lifecycle tabs (Build · Input · Runs · Review · Reports), each a real deep-linkable route scoped to
// the app id, with a one-line helper for the active tab. Tab selection is URL-driven (activeTabForPath
// is the pure resolver in app-lifecycle.ts) so Back walks the tabs — never local useState.
export function AppLifecycleNav({ appId, title }: { appId: string; title: string }) {
  const pathname = usePathname();
  const tabs = lifecycleTabs(appId);
  const active = activeTabForPath(pathname, appId) ?? 'build';
  const activeHint = tabs.find((t) => t.tab === active)?.hint ?? '';

  return (
    <SubNav>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href="/studio"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Studio
          </Link>
          <span className="text-muted-foreground/40" aria-hidden>
            /
          </span>
          <span className="truncate text-sm font-medium text-foreground" title={title}>
            {title}
          </span>
          <nav className="ml-auto flex flex-wrap items-center gap-1">
            {tabs.map((t) => {
              const isActive = t.tab === active;
              return (
                <Link
                  key={t.tab}
                  href={t.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {activeHint ? (
          <p className="text-[11px] text-muted-foreground">{activeHint}</p>
        ) : null}
      </div>
    </SubNav>
  );
}
