'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ScrollableTabs } from '@/components/build/ScrollableTabs';
import { SubNav } from '@/components/nav/SubNav';
import { PipelineChip, type PipelineChipData } from '@/components/pipelines/PipelineChip';
import { activeTabForPath, lifecycleTabs } from '@/lib/app-lifecycle';

// ─── AppLifecycleNav (Builder Epic #116) — the per-app scoped SubNav band ─────────────────────────
//
// The founder's ask: "opening an app gives ITS OWN surface with the 5 screens as tabs, scoped to
// that app." This is that band. Every saved app lives under /apps/<id>; this renders the five
// lifecycle tabs (Build · Input · Runs · Review · Reports), each a real deep-linkable route scoped to
// the app id, with a one-line helper for the active tab. Tab selection is URL-driven (activeTabForPath
// is the pure resolver in app-lifecycle.ts) so Back walks the tabs — never local useState.
export function AppLifecycleNav({
  appId,
  title,
  pipeline,
}: {
  appId: string;
  title: string;
  /** The resolved "Runs on: <pipeline>" chip for this app (own binding, else org default). */
  pipeline?: PipelineChipData | null;
}) {
  const pathname = usePathname();
  const tabs = lifecycleTabs(appId);
  const active = activeTabForPath(pathname, appId) ?? 'build';
  const activeHint = tabs.find((t) => t.tab === active)?.hint ?? '';

  return (
    <SubNav>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href="/build/studio"
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
          {pipeline ? <PipelineChip pipeline={pipeline} size="xs" /> : null}
          {/* On mobile the rail takes a full row and scrolls sideways; on desktop (md+) it keeps its
              original inline-right position (ml-auto, wrapping) so wide screens are unchanged. */}
          <ScrollableTabs
            aria-label="App lifecycle"
            tabs={tabs.map((t) => ({ key: t.tab, label: t.label, href: t.href }))}
            active={active}
            className="w-full md:ml-auto md:w-auto"
          />
        </div>
        {activeHint ? <p className="text-[11px] text-muted-foreground">{activeHint}</p> : null}
      </div>
    </SubNav>
  );
}
