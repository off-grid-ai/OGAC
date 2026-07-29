'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
}: Readonly<{
  appId: string;
  title: string;
  /** The resolved "Runs on: <pipeline>" chip for this app (own binding, else org default). */
  pipeline?: PipelineChipData | null;
}>) {
  const pathname = usePathname();
  const tabs = lifecycleTabs(appId);
  const active = activeTabForPath(pathname, appId) ?? 'work';
  const activeHint = tabs.find((t) => t.tab === active)?.hint ?? '';

  return (
    <SubNav>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href="/solutions/apps"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Apps
          </Link>
          <span className="text-muted-foreground/40" aria-hidden>
            /
          </span>
          {/* The app's NAME is the page heading. It was a <span>, so every app surface relied on the
            mobile gate's hidden h1 and had no heading of its own — the document title never said which
            app you were looking at. Visual weight is unchanged. */}
          <h1 className="truncate text-sm font-medium text-foreground" title={title}>
            {title}
          </h1>
          {pipeline ? <PipelineChip pipeline={pipeline} size="xs" /> : null}
          {/* The lifecycle tabs used to render as a horizontal rail HERE, alongside the left sidebar —
            two competing navigations on one screen, and the reason this surface was hard to place
            yourself in. They now nest inside the sidebar under Apps, so there is exactly one place to
            navigate from. This band keeps only identity: where you are, and what governs it. */}
        </div>
        {activeHint ? <p className="text-[11px] text-muted-foreground">{activeHint}</p> : null}
      </div>
    </SubNav>
  );
}
