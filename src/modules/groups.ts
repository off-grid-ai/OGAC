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
    // Chat is the front door; the everyday create/save surfaces sit beside it. Artifacts are
    // reached from the chat flow (saved outputs), so they don't need their own sidebar row.
    // (Studio lives under Intelligence — it authors agents/workflows, not a chat surface.)
    primary: ['chat', 'projects', 'prompts', 'knowledge', 'storage'],
    secondary: ['artifacts'],
  },
  {
    id: 'build',
    label: 'Build',
    // Studio and Agents were two sidebar rows for one job (author an assistant vs. run the agent
    // definitions it produces), so they're consolidated under a single "Agents" umbrella row whose
    // (build) section landing tabs across Agents / Studio / Runs via BuildNav. Brain (RAG) stays a
    // sibling entry. Studio, run history, evals, sandbox, and visual QA are secondaries — reached
    // from the section nav, not the sidebar — so every route still resolves without crowding it.
    primary: ['agents', 'brain'],
    secondary: ['studio', 'agent-runs', 'evals', 'sandbox', 'provit'],
  },
  {
    id: 'gateway',
    label: 'Gateway & Fleet',
    // The network + LLM edge and the device fleet. The Caddy edge is an internal detail of the
    // published surface, so it sits under Services rather than as its own row.
    primary: ['services', 'gateway', 'fleet'],
    secondary: ['edge'],
  },
  {
    id: 'data',
    label: 'Data',
    // One sidebar row → the Data section landing, which tabs across sources, retrieval, and
    // lineage via DataNav (already rendered by src/app/(console)/(data)/layout.tsx).
    primary: ['data'],
    secondary: ['integrations', 'retrieval', 'lineage'],
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
    primary: ['admin', 'config', 'backups', 'api-docs'],
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
