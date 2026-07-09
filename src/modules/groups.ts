import type { ModuleId } from './registry';

// Nav grouping for the sidebar — turns the flat ~40-module list into a scannable, ~20-entry IA.
// Single source of truth for which section a module lives in + the section order.
//
// TWO-LEVEL NAV (per docs/ROADMAP.md Phase 1): a group names a `primary` set — the entries shown
// in the sidebar — and an optional `secondary` set — sibling modules that live under a section
// landing and are reached from a scoped in-page nav (InsightsNav / GovernanceNav / DataNav) rather
// than as their own top-level sidebar rows. Secondaries keep their routes (nothing 404s); they're
// just not listed in the sidebar, so the sidebar stays scannable instead of exposing every leaf.
//
// Any enabled module NOT listed here (primary or secondary) falls into the trailing "More" group,
// so nothing ever disappears silently.
export interface NavGroup {
  id: string;
  label: string;
  /** Modules shown as sidebar rows, in order. */
  primary: ModuleId[];
  /**
   * Sibling modules that resolve at their own routes but are reached via a section landing's
   * scoped nav (tabs) instead of the sidebar. Kept here so the grouping stays a single source of
   * truth and callers that want full membership (not just the sidebar) can ask for it.
   */
  secondary?: ModuleId[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: 'Home',
    primary: ['overview'],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    // Chat IS the Workspace front door — a project is just a chat context, so Projects no longer
    // gets its own sidebar row; it's reached from Chat's project switcher and the Workspace top-tabs.
    // Prompts (the library) and Artifacts (saved outputs) are workspace sub-surfaces, reached via
    // the scoped WorkspaceNav top-tabs (see (workspace)/layout.tsx) rather than the sidebar — so the
    // sidebar stays scannable. Knowledge + Storage remain first-class rows.
    // (Studio lives under Intelligence — it authors agents/workflows, not a chat surface.)
    primary: ['chat', 'knowledge', 'storage'],
    secondary: ['projects', 'prompts', 'artifacts'],
  },
  {
    id: 'build',
    label: 'Build',
    // "agent and studio should become one" (founder). Studio is now the ONE build front door — it
    // lists every app (an agent is a one-step app) and "New app" opens the guided builder; opening
    // an app goes to its own lifecycle shell (/apps/<id>). So Studio is the sidebar primary and the
    // old Agents roster page is a secondary (its routes still resolve). Brain (RAG) stays a sibling
    // primary. Run history, evals, sandbox, and visual QA remain secondaries — reached from the
    // section nav, not the sidebar — so every route resolves without crowding it.
    // Tools (#121) is the ONE home for the tools apps call — registered registry + MCP catalog +
    // built-in primitives — reached from the Build nav. The old standalone `tool-catalog` route now
    // redirects into Tools→Catalog, so it stays a Build secondary (resolves, keeps highlight sane)
    // rather than lingering under Data.
    // Pipelines (the governed model-access contract — the heart of OGAC) is a primary here: it's the
    // composition root apps/agents/chat consume, so it sits prominently in Build alongside Studio +
    // Brain. It RUNS ON a gateway (Gateway & Fleet) and is CONSUMED BY the builder surfaces. Studio
    // stays FIRST — it's the Build group's landing row that the /apps/* surfaces + Build secondaries
    // alias to (see sidebarActiveIdFor); reordering that would relight the sidebar for those routes.
    primary: ['studio', 'pipelines', 'brain'],
    secondary: ['agents', 'tools', 'tool-catalog', 'agent-runs', 'evals', 'sandbox', 'provit'],
  },
  {
    id: 'gateway',
    label: 'Gateway & Fleet',
    // The network + LLM edge and the device fleet. The Caddy edge is an internal detail of the
    // published surface, so it sits under Services rather than as its own row.
    primary: ['services', 'gateway', 'gateways', 'fleet'],
    secondary: ['edge'],
  },
  {
    id: 'data',
    label: 'Data',
    // One sidebar row → the Data section landing, which tabs across sources, retrieval, and
    // lineage via DataNav (already rendered by src/app/(console)/(data)/layout.tsx).
    primary: ['data'],
    // `tool-catalog` moved to Build (Tools→Catalog is its home now; the old route redirects there).
    // catalog + governance are the M4 deep-data-governance surfaces (catalog / classification /
    // retention + RTBF / freshness), reached from the Data section nav.
    secondary: ['integrations', 'data-domains', 'catalog', 'governance', 'retrieval', 'lineage'],
  },
  {
    id: 'governance',
    label: 'Governance',
    // One sidebar row → the Governance section landing (Control), which tabs across policy,
    // access, guardrails, secrets, regulatory, and provenance via GovernanceNav.
    primary: ['control'],
    secondary: ['policy', 'access', 'guardrails', 'secrets', 'regulatory', 'provenance'],
  },
  {
    id: 'insights',
    label: 'Insights',
    // One sidebar row → the Insights section landing (Observability), which tabs across analytics,
    // drift, finops, usage & spend, reports, security events, and audit via InsightsNav.
    primary: ['observability'],
    secondary: ['analytics', 'drift', 'finops', 'accounting', 'reports', 'siem', 'audit'],
  },
  {
    id: 'operations',
    label: 'Operations',
    primary: ['runs', 'admin', 'config', 'backups', 'api-docs'],
  },
];

// Map every claimed module id → the FIRST primary id of the group it belongs to. This lets the
// sidebar keep a group's landing row highlighted while the user is on one of its secondary routes
// (e.g. on /policy, the Governance → Control row stays active). Pure, no I/O. A primary maps to
// itself; a module claimed by no group (or with no primary) maps to undefined.
export function sidebarActiveIdFor(id: ModuleId): ModuleId | undefined {
  for (const g of NAV_GROUPS) {
    if (g.primary.includes(id)) return id;
    if ((g.secondary ?? []).includes(id)) return g.primary[0];
  }
  return undefined;
}

// Route-prefix aliases for pages that live under a route group but have NO module of their own, so
// their URL matches no module route (and the sidebar would light nothing). The unified builder's
// app surfaces (/apps/runs = app-runs list, /apps/reports = app outcomes) are exactly this: they
// belong to the Build surface and their pages gate on the `studio`/`agents` modules, but they route
// under /apps. Map them to the module whose sidebar row should stay lit while you're on them.
// Longest-prefix wins (checked before falling back to module-route matching).
const PATH_ALIASES: { prefix: string; moduleId: ModuleId }[] = [
  { prefix: '/build/apps', moduleId: 'studio' },
  // Email & messaging management (Resend send + sending-domain verify + inbound) lives under
  // /operations/messaging and gates on the `config` module — keep the Operations → Config row lit.
  { prefix: '/operations/messaging', moduleId: 'config' },
];

// Resolve which sidebar row should be active for a URL, purely — no React, no router. First tries
// the /apps-style route aliases (build surfaces without their own module), then the enabled modules
// by longest matching route, then maps the resolved module to its group's landing row via
// sidebarActiveIdFor. This is the single source of truth for sidebar highlighting, so /apps/runs and
// /apps/reports keep the Build → Apps row lit instead of un-highlighting the whole sidebar.
export function sidebarActiveIdForPath<T extends { id: ModuleId; route: string }>(
  pathname: string,
  modules: T[],
): ModuleId | undefined {
  const alias = PATH_ALIASES
    .filter((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (alias) return sidebarActiveIdFor(alias.moduleId);

  const current = modules
    .filter((m) => pathname === m.route || pathname.startsWith(`${m.route}/`))
    .sort((a, b) => b.route.length - a.route.length)[0];
  return current ? sidebarActiveIdFor(current.id) : undefined;
}

// Every module that a group claims — primary OR secondary. Used to decide what falls into "More".
function claimedIds(): Set<ModuleId> {
  const claimed = new Set<ModuleId>();
  for (const g of NAV_GROUPS) {
    for (const id of g.primary) claimed.add(id);
    for (const id of g.secondary ?? []) claimed.add(id);
  }
  return claimed;
}

// Sidebar sections: only the PRIMARY entries of each group, in group order. This is what keeps the
// sidebar at ~20 scannable rows — secondaries are reached from section landings, not the sidebar.
// Pure function (no React, no I/O) so it's unit-testable. Modules enabled but claimed by no group
// land in a trailing "More" section so the sidebar can never silently drop a module.
export function sidebarSections<T extends { id: ModuleId }>(
  modules: T[],
): { label: string; items: T[] }[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const sections: { label: string; items: T[] }[] = [];

  for (const g of NAV_GROUPS) {
    const items: T[] = [];
    for (const id of g.primary) {
      const m = byId.get(id);
      if (m) items.push(m);
    }
    if (items.length) sections.push({ label: g.label, items });
  }

  const claimed = claimedIds();
  const leftovers = modules.filter((m) => !claimed.has(m.id));
  if (leftovers.length) sections.push({ label: 'More', items: leftovers });

  return sections;
}

// Full grouping (primary + secondary) for callers that want every module under its section — e.g.
// a search index or a section landing that lists its siblings. Kept alongside `sidebarSections` so
// the two views never drift. Modules claimed by no group land in a trailing "More" section.
export function groupModules<T extends { id: ModuleId }>(
  modules: T[],
): { label: string; items: T[] }[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const claimed = new Set<ModuleId>();
  const sections: { label: string; items: T[] }[] = [];

  for (const g of NAV_GROUPS) {
    const items: T[] = [];
    for (const id of [...g.primary, ...(g.secondary ?? [])]) {
      const m = byId.get(id);
      if (m) {
        items.push(m);
        claimed.add(id);
      }
    }
    if (items.length) sections.push({ label: g.label, items });
  }

  const leftovers = modules.filter((m) => !claimed.has(m.id));
  if (leftovers.length) sections.push({ label: 'More', items: leftovers });

  return sections;
}
