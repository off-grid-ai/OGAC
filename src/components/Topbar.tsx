'use client';

import { List, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { usePathname } from 'next/navigation';
import { useEffect, useReducer } from 'react';
import { SidebarNav } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserMenu } from '@/components/UserMenu';
import { drawerReducer } from '@/lib/mobile-nav';
import { ownerForPath } from '@/modules/ownership';

interface SessionUser {
  name?: string | null;
  email?: string | null;
  role?: string;
}

export function Topbar({ user }: Readonly<{ user?: SessionUser }>) {
  const pathname = usePathname();
  const owner = ownerForPath(pathname);

  // Mobile nav drawer state — owned by the pure reducer so the close-on-nav invariant is
  // unit-tested (see src/lib/mobile-nav.ts). Radix already closes on esc/backdrop; the effect below
  // dispatches `navigate` when the route changes so tapping a nav row dismisses the drawer too.
  const [drawerOpen, dispatch] = useReducer(drawerReducer, false);
  useEffect(() => {
    dispatch({ type: 'navigate' });
  }, [pathname]);

  const openSearch = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only; opens the slide-in nav drawer (same nav as the desktop aside). */}
        <Sheet open={drawerOpen} onOpenChange={(o) => dispatch({ type: o ? 'open' : 'close' })}>
          <SheetTrigger
            aria-label="Open navigation menu"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          >
            <List className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 p-0 sm:max-w-72" showCloseButton={false}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarNav onNavigate={() => dispatch({ type: 'close' })} />
          </SheetContent>
        </Sheet>

        <div className="min-w-0 leading-tight">
          <h1 className="truncate text-sm font-medium text-foreground">{owner?.label ?? 'Console'}</h1>
          {owner ? (
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {owner.description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* Search trigger — icon-only on mobile (label + ⌘K hint appear from `sm`). */}
        <button
          onClick={openSearch}
          aria-label="Search"
          className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
        >
          <MagnifyingGlass className="size-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ml-2 hidden rounded border border-border bg-background px-1 font-mono text-[10px] sm:inline">
            ⌘K
          </kbd>
        </button>
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
