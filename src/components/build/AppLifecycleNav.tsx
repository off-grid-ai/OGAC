'use client';

import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
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
  openHref,
}: Readonly<{
  appId: string;
  title: string;
  /** Where the DEPLOYED app lives, when it is published. Null when there is nothing to open yet. */
  openHref?: string | null;
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
          {/* THE POINT OF ALL THIS. These console tabs are how you BUILD and run a process; /app/<slug> is
            the app your team actually opens. Nothing previously linked the two, so a person could sit on
            "No cases yet" with no idea a working app existed or where. */}
          {openHref ? (
            <a
              href={openHref}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary no-underline transition-colors hover:bg-primary/20"
            >
              Open the app
              <ArrowSquareOut className="size-3.5" />
            </a>
          ) : (
            <span
              className="ml-auto shrink-0 text-[11px] text-muted-foreground"
              title="Publish this app to give your team a link they can open."
            >
              Not published yet
            </span>
          )}
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
