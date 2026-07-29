// ─── Per-app lifecycle model (Builder Epic #116) — PURE, zero-IO ─────────────────────────────────
//
// The founder's ask: "the 5 screens are the STRUCTURE every app inherits — opening an app gives ITS
// OWN surface with those as tabs, scoped to that app." This module is the single source of truth for
// those five tabs and the URL⇄tab mapping. Every saved app lives at /apps/<id>/<tab>; this pure logic
// decides which tab a URL selects, and builds the tab hrefs. No React, no router — unit-testable in
// test/app-lifecycle.test.ts. The AppLifecycleNav component is a thin renderer over `lifecycleTabs`.

export type AppTab =
  | 'work'
  | 'dashboard'
  | 'build'
  | 'input'
  | 'runs'
  | 'review'
  | 'reports'
  | 'quality'
  | 'access'
  | 'schedule'
  | 'controls';

/**
 * `primary` = what you DO with an app day to day. `settings` = what you configure once.
 *
 * Ten equal-weight tabs presented as one flat rail is why this surface read as overwhelming: nothing
 * told the reader that Work and Safety are not the same kind of thing.
 */
export type AppTabGroup = 'primary' | 'settings';

export interface LifecycleTab {
  tab: AppTab;
  label: string;
  group: AppTabGroup;
  /** Absolute route for this app's tab. */
  href: string;
  /** One-line "what this screen is" helper (screens 1–5 of the canonical flow). */
  hint: string;
}

// Flow order, but WORK LEADS. An app automates a process the enterprise already runs, so work arrives
// on its own and the person using it opens the app to deal with what is waiting — not to inspect the
// app's own configuration. Landing on Build made every app read as an entry in an AI console rather
// than the department's tool for that process (docs/APP_AS_PRODUCT.md item 3).
const TAB_META: { tab: AppTab; label: string; hint: string; group: AppTabGroup }[] = [
  { tab: 'work', label: 'Work', hint: 'What is waiting for you right now', group: 'primary' },
  {
    tab: 'dashboard',
    label: 'Dashboard',
    hint: 'How this process is doing — throughput, what is stuck, how long it takes',
    group: 'primary',
  },
  { tab: 'build', label: 'Build', hint: 'Edit the steps and how it runs', group: 'primary' },
  { tab: 'input', label: 'Start a case', hint: 'Enter the details and run it', group: 'primary' },
  { tab: 'runs', label: 'Runs', hint: 'Watch runs execute, step by step', group: 'primary' },
  { tab: 'review', label: 'Review', hint: 'Approve or reject runs paused for a human', group: 'primary' },
  { tab: 'reports', label: 'Reports', hint: 'Outcomes over time', group: 'primary' },
  {
    tab: 'quality',
    group: 'settings',
    label: 'Quality',
    hint: "This pipeline's evals, golden set, and drift — run and gate on them",
  },
  {
    tab: 'access',
    group: 'settings',
    label: 'Access',
    hint: 'Who may run, trigger, and approve this — and to what limit',
  },
  {
    tab: 'schedule',
    group: 'settings',
    label: 'Schedule',
    hint: 'Set when this runs on its own — a recurring time, timezone, and the next fire',
  },
  {
    tab: 'controls',
    group: 'settings',
    label: 'Safety',
    hint: 'Shadow-mode dry-runs, daily run + spend caps, and the kill-switch — run it safely before it acts',
  },
];

// ─── appTabHref — the canonical URL for one app tab ──────────────────────────────────────────────
// `work` is the app's landing (/apps/<id>); every other tab hangs off it (/apps/<id>/build, …).
// Keeping the base tab at the bare path means "open an app" lands on the work waiting for you with no
// redirect, and the URL stays clean. Build moved to its own segment when Work took the base.
export function appTabHref(appId: string, tab: AppTab): string {
  const base = `/solutions/apps/${encodeURIComponent(appId)}`;
  return tab === 'work' ? base : `${base}/${tab}`;
}

// ─── lifecycleTabs — the five tabs for a given app, with hrefs ───────────────────────────────────
export function lifecycleTabs(appId: string): LifecycleTab[] {
  return TAB_META.map((m) => ({ ...m, href: appTabHref(appId, m.tab) }));
}

// ─── activeTabForPath — which tab a URL selects, scoped to an app ────────────────────────────────
// Given a pathname and the app id, return the AppTab it lands on. The bare /apps/<id> (and any
// unknown sub-path) is `build`. A trailing sub-segment that names a tab selects it. Returns null if
// the path is not under this app at all (so a caller can ignore it).
export function activeTabForPath(pathname: string, appId: string): AppTab | null {
  const base = `/solutions/apps/${appId}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length).replace(/^\/+/, '');
  const seg = rest.split('/')[0] ?? '';
  if (!seg) return 'work';
  const known: AppTab[] = [
    'work',
    'dashboard',
    'build',
    'input',
    'runs',
    'review',
    'reports',
    'quality',
    'access',
    'schedule',
    'controls',
  ];
  return (known as string[]).includes(seg) ? (seg as AppTab) : 'work';
}
