'use client';

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

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur">
      <div className="leading-tight">
        <h1 className="text-sm font-medium text-foreground">{mod?.label ?? 'Console'}</h1>
        {mod ? <p className="text-xs text-muted-foreground">{mod.description}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
