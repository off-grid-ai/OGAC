'use client';

import { BookOpen } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getEnabledModules } from '@/lib/modules';
import { cn } from '@/lib/utils';
import { groupModules } from '@/modules/groups';
import { MODULE_ICONS } from '@/modules/icons';

export function Sidebar() {
  const pathname = usePathname();
  const sections = groupModules(getEnabledModules());

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <Image src="/logo.png" alt="Off Grid" width={28} height={28} priority />
        <div className="leading-tight">
          <div className="text-sm font-medium text-foreground">Off Grid</div>
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
                const active = pathname === m.route || pathname.startsWith(`${m.route}/`);
                return (
                  <Link
                    key={m.id}
                    href={m.route}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-all duration-150 active:scale-[0.98]',
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {m.label}
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
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BookOpen className="size-4 shrink-0" />
          API docs &amp; playground
        </a>
        <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          On-prem · local-first
        </p>
      </div>
    </aside>
  );
}
