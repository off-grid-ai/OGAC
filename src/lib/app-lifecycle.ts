// ─── Per-app lifecycle model (Builder Epic #116) — PURE, zero-IO ─────────────────────────────────
//
// The founder's ask: "the 5 screens are the STRUCTURE every app inherits — opening an app gives ITS
// OWN surface with those as tabs, scoped to that app." This module is the single source of truth for
// those five tabs and the URL⇄tab mapping. Every saved app lives at /apps/<id>/<tab>; this pure logic
// decides which tab a URL selects, and builds the tab hrefs. No React, no router — unit-testable in
// test/app-lifecycle.test.ts. The AppLifecycleNav component is a thin renderer over `lifecycleTabs`.

export type AppTab =
  | 'build'
  | 'input'
  | 'runs'
  | 'review'
  | 'reports'
  | 'quality'
  | 'access'
  | 'schedule'
  | 'controls';

export interface LifecycleTab {
  tab: AppTab;
  label: string;
  /** Absolute route for this app's tab. */
  href: string;
  /** One-line "what this screen is" helper (screens 1–5 of the canonical flow). */
  hint: string;
}

// The canonical five, in flow order (Build → Input → Runs → Review → Reports).
const TAB_META: { tab: AppTab; label: string; hint: string }[] = [
  { tab: 'build', label: 'Build', hint: 'Edit the steps and how it runs' },
  { tab: 'input', label: 'Input', hint: 'Enter inputs and run it' },
  { tab: 'runs', label: 'Runs', hint: 'Watch runs execute, step by step' },
  { tab: 'review', label: 'Review', hint: 'Approve or reject runs paused for a human' },
  { tab: 'reports', label: 'Reports', hint: 'Outcomes over time' },
  { tab: 'quality', label: 'Quality', hint: "This pipeline's evals, golden set, and drift — run and gate on them" },
  { tab: 'access', label: 'Access', hint: 'Who may run, trigger, and approve this — and to what limit' },
  {
    tab: 'schedule',
    label: 'Schedule',
    hint: 'Set when this runs on its own — a recurring time, timezone, and the next fire',
  },
  {
    tab: 'controls',
    label: 'Safety',
    hint: 'Shadow-mode dry-runs, daily run + spend caps, and the kill-switch — run it safely before it acts',
  },
];

// ─── appTabHref — the canonical URL for one app tab ──────────────────────────────────────────────
// `build` is the app's landing (/apps/<id>); the rest hang off it (/apps/<id>/input, …). Keeping the
// base tab at the bare path (not /apps/<id>/build) means "open an app" lands on Build without a
// redirect, and the URL stays clean.
export function appTabHref(appId: string, tab: AppTab): string {
  const base = `/solutions/apps/${encodeURIComponent(appId)}`;
  return tab === 'build' ? base : `${base}/${tab}`;
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
  if (!seg) return 'build';
  const known: AppTab[] = [
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
  return (known as string[]).includes(seg) ? (seg as AppTab) : 'build';
}
