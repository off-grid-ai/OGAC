'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Disclosure, DisclosureContent, DisclosureTrigger } from '@/components/ui/disclosure';
import {
  activeTabForPath,
  pipelineNavGroups,
  pipelineTabs,
  type PipelineNavGroupDef,
  type PipelineTab,
  type PipelineTabDef,
} from '@/lib/pipeline-detail';
import { cn } from '@/lib/utils';

function PipelineNavLink({
  tab,
  active,
}: Readonly<{
  tab: PipelineTabDef;
  active: boolean;
}>) {
  return (
    <Link
      href={tab.href}
      aria-current={active ? 'page' : undefined}
      data-og-interactive
      data-active={active || undefined}
      className={cn(
        'relative flex min-h-9 items-center rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
    >
      <span className="truncate">{tab.label}</span>
    </Link>
  );
}

function PipelineNavGroup({
  group,
  activeTab,
}: Readonly<{
  group: PipelineNavGroupDef;
  activeTab: PipelineTab;
}>) {
  const containsActive = group.tabs.some((tab) => tab.tab === activeTab);
  const [open, setOpen] = useState(containsActive);

  // A deep link or cross-group route change always reveals its active destination. This disclosure
  // state does not select a screen; links and browser history remain the only navigation state.
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <Disclosure
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="border-0 bg-transparent shadow-none"
    >
      <DisclosureTrigger
        data-active-section={containsActive || undefined}
        className={cn(
          'min-h-9 rounded-md px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] transition-colors',
          containsActive
            ? 'font-medium text-foreground'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {containsActive ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          ) : null}
          <span className="truncate">{group.label}</span>
        </span>
      </DisclosureTrigger>
      <DisclosureContent className="ml-2 space-y-0.5 border-l border-border/80 p-0 pl-3 pb-1">
        {group.tabs.map((tab) => (
          <PipelineNavLink key={tab.tab} tab={tab} active={tab.tab === activeTab} />
        ))}
      </DisclosureContent>
    </Disclosure>
  );
}

// Entity-local lifecycle navigation for one pipeline. Canonical links own every selection, so route
// changes remain deep-linkable and Back-coherent. Native shared disclosures only own whether a group
// is exposed; a route change reveals its active lifecycle group.
export function PipelineDetailNav({
  pipelineId,
  name,
}: Readonly<{ pipelineId: string; name: string }>) {
  const pathname = usePathname();
  const active = activeTabForPath(pathname, pipelineId) ?? 'overview';

  return <PipelineDetailRail pipelineId={pipelineId} name={name} active={active} />;
}

export function PipelineDetailRail({
  pipelineId,
  name,
  active,
}: Readonly<{
  pipelineId: string;
  name: string;
  active: PipelineTab;
}>) {
  const tabs = pipelineTabs(pipelineId);
  const groups = pipelineNavGroups(pipelineId);
  const overview = tabs[0];
  const activeTab = tabs.find((tab) => tab.tab === active) ?? overview;

  return (
    <aside className="min-w-0 lg:sticky lg:top-0 lg:w-56 lg:self-start" aria-label="Pipeline">
      <div className="mb-3 min-w-0 border-b border-border/80 pb-3">
        <Link
          href="/runtime/pipelines"
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Pipelines
        </Link>
        <p className="mt-1 truncate text-sm font-medium text-foreground" title={name}>
          {name}
        </p>
      </div>

      <Disclosure className="border-border bg-card shadow-none lg:border-0 lg:bg-transparent">
        <DisclosureTrigger className="min-h-11 px-3 py-2 text-left lg:hidden">
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Pipeline navigation
            </span>
            <span className="block truncate text-[13px] font-medium text-foreground">
              {activeTab.label}
            </span>
          </span>
        </DisclosureTrigger>

        <DisclosureContent className="p-2 lg:block lg:p-0">
          <nav aria-label={`${name} sections`} className="space-y-1">
            <PipelineNavLink tab={overview} active={active === 'overview'} />

            {groups.map((group) => (
              <PipelineNavGroup key={group.id} group={group} activeTab={active} />
            ))}
          </nav>

          <p className="mt-3 border-t border-border/80 px-2 pt-3 text-[11px] leading-relaxed text-muted-foreground">
            {activeTab.hint}
          </p>
        </DisclosureContent>
      </Disclosure>
    </aside>
  );
}
