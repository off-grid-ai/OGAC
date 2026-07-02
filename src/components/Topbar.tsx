'use client';

import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/UserMenu';
import { getEnabledModules } from '@/lib/modules';

interface SessionUser {
  name?: string | null;
  email?: string | null;
  role?: string;
}

export function Topbar({ user }: { user?: SessionUser }) {
  const pathname = usePathname();
  const mod = getEnabledModules().find((m) => pathname.startsWith(m.route));

  const openSearch = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur">
      <div className="leading-tight">
        <h1 className="text-sm font-medium text-foreground">{mod?.label ?? 'Console'}</h1>
        {mod ? <p className="text-xs text-muted-foreground">{mod.description}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {/* Search trigger */}
        <button
          onClick={openSearch}
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
        >
          <MagnifyingGlass className="size-3.5" />
          <span>Search</span>
          <kbd className="ml-2 rounded border border-border bg-background px-1 font-mono text-[10px]">⌘K</kbd>
        </button>
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
