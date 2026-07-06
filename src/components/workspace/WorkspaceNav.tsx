'use client';

import { ChatCircleDots, Cube, FolderOpen, TextAlignLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Icon } from '@phosphor-icons/react';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';

// Scoped secondary-nav for the Workspace family — the everyday create surface. A project is just a
// chat context, so Chat is the front door and Projects / Prompts / Artifacts are its sibling
// sub-surfaces, reached here instead of from the sidebar. Every tab is a real route (URL-driven,
// deep-linkable) and disabled modules drop out. Mirrors DataNav / InsightsNav / GovernanceNav.
//
// This is what makes Artifacts reachable again after the IA consolidation hid it.

interface Tab {
  id: Parameters<typeof isModuleEnabled>[0];
  label: string;
  route: string;
  Icon: Icon;
}

const TABS: Tab[] = [
  { id: 'chat', label: 'Chat', route: '/chat', Icon: ChatCircleDots },
  { id: 'projects', label: 'Projects', route: '/projects', Icon: FolderOpen },
  { id: 'prompts', label: 'Prompts', route: '/prompts', Icon: TextAlignLeft },
  { id: 'artifacts', label: 'Artifacts', route: '/artifacts', Icon: Cube },
];

export function WorkspaceNav() {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => isModuleEnabled(t.id));

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-border pb-3">
      <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">
        Workspace
      </span>
      {tabs.map((t) => {
        const active = pathname === t.route || pathname.startsWith(`${t.route}/`);
        return (
          <Link
            key={t.id}
            href={t.route}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <t.Icon className="size-3.5" weight={active ? 'fill' : 'regular'} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
