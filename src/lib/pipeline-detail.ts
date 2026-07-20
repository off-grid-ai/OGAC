// ─── Per-pipeline detail tab model — PURE, zero-IO (mirrors app-lifecycle.ts) ─────────────────────
//
// A Pipeline is the governed chokepoint; its detail surface is the reference master→detail view. Every
// saved pipeline lives at /pipelines/<id>/<tab>; this pure logic decides which tab a URL selects and
// builds the tab hrefs and grouped entity-local navigation. No React, no router — unit-testable in
// test/pipeline-detail.test.ts. The PipelineDetailNav component is a thin renderer over this model.
//
// Overview is the direct landing item. The remaining routes are grouped by operator job:
// Configure (Gateway & routing · API · Versions), Govern (Policy · Guardrails), Assure (Quality ·
// Drift), and Observe (Observability · Audit · Cost).

export type PipelineTab =
  | 'overview'
  | 'routing'
  | 'policy'
  | 'guardrails'
  | 'quality'
  | 'drift'
  | 'observability'
  | 'audit'
  | 'cost'
  | 'api'
  | 'versions';

export interface PipelineTabDef {
  tab: PipelineTab;
  label: string;
  /** Absolute route for this pipeline's tab. */
  href: string;
  /** One-line "what this screen is" helper. */
  hint: string;
}

export type PipelineNavGroupId = 'configure' | 'govern' | 'assure' | 'observe';

export interface PipelineNavGroupDef {
  id: PipelineNavGroupId;
  label: string;
  tabs: PipelineTabDef[];
}

interface PipelineTabMeta extends Omit<PipelineTabDef, 'href'> {
  group?: PipelineNavGroupId;
}

// The tabs in reading order. `overview` is the landing (/pipelines/<id>); the rest hang off it.
const TAB_META: PipelineTabMeta[] = [
  {
    tab: 'overview',
    label: 'Overview',
    hint: 'What this pipeline is, its binding, and its data ceiling',
  },
  {
    tab: 'routing',
    label: 'Gateway & routing',
    hint: 'The gateway it runs on + the routing/egress leash',
    group: 'configure',
  },
  {
    tab: 'api',
    label: 'API',
    hint: 'Provisioned endpoint + key to consume this pipeline',
    group: 'configure',
  },
  {
    tab: 'versions',
    label: 'Versions',
    hint: 'Immutable version history — every publish and edit',
    group: 'configure',
  },
  {
    tab: 'policy',
    label: 'Policy',
    hint: 'ABAC policy overlay — inherits org defaults, tightens locked controls',
    group: 'govern',
  },
  {
    tab: 'guardrails',
    label: 'Guardrails',
    hint: 'PII masking, injection, grounding — scoped to this pipeline',
    group: 'govern',
  },
  {
    tab: 'quality',
    label: 'Quality',
    hint: 'Evals + golden set run in this pipeline’s context',
    group: 'assure',
  },
  {
    tab: 'drift',
    label: 'Drift',
    hint: 'Quality drift over this pipeline’s run history',
    group: 'assure',
  },
  {
    tab: 'observability',
    label: 'Observability',
    hint: 'Traces, latency, and tokens for this pipeline’s runs',
    group: 'observe',
  },
  {
    tab: 'audit',
    label: 'Audit',
    hint: 'Every governed decision this pipeline made',
    group: 'observe',
  },
  {
    tab: 'cost',
    label: 'Cost',
    hint: 'Spend attributed to this pipeline → its gateway/model',
    group: 'observe',
  },
];

const NAV_GROUPS: ReadonlyArray<{ id: PipelineNavGroupId; label: string }> = [
  { id: 'configure', label: 'Configure' },
  { id: 'govern', label: 'Govern' },
  { id: 'assure', label: 'Assure' },
  { id: 'observe', label: 'Observe' },
];

const KNOWN: PipelineTab[] = TAB_META.map((m) => m.tab);

function pipelineTabDef(pipelineId: string, meta: PipelineTabMeta): PipelineTabDef {
  return {
    tab: meta.tab,
    label: meta.label,
    hint: meta.hint,
    href: pipelineTabHref(pipelineId, meta.tab),
  };
}

// ─── pipelineTabHref — the canonical URL for one pipeline tab ─────────────────────────────────────
// `overview` is the pipeline's landing (/pipelines/<id>); the rest hang off it. Keeping the base tab
// at the bare path means "open a pipeline" lands on Overview without a redirect, URL stays clean.
export function pipelineTabHref(pipelineId: string, tab: PipelineTab): string {
  const base = `/runtime/pipelines/${encodeURIComponent(pipelineId)}`;
  return tab === 'overview' ? base : `${base}/${tab}`;
}

// ─── pipelineTabs — the tabs for a given pipeline, with hrefs ─────────────────────────────────────
export function pipelineTabs(pipelineId: string): PipelineTabDef[] {
  return TAB_META.map((tab) => pipelineTabDef(pipelineId, tab));
}

// ─── pipelineNavGroups — lifecycle rail sections in operator-task order ──────────────────────────
// Overview stays a direct item. Each remaining canonical route appears exactly once in a disclosure
// group, so the renderer never owns or duplicates the information architecture.
export function pipelineNavGroups(pipelineId: string): PipelineNavGroupDef[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    tabs: TAB_META.filter((tab) => tab.group === group.id).map((tab) =>
      pipelineTabDef(pipelineId, tab),
    ),
  }));
}

// ─── activeTabForPath — which tab a URL selects, scoped to a pipeline ─────────────────────────────
// The bare /pipelines/<id> (and any unknown sub-path) is `overview`. A trailing sub-segment that names
// a tab selects it. Returns null if the path is not under this pipeline at all.
export function activeTabForPath(pathname: string, pipelineId: string): PipelineTab | null {
  const base = `/runtime/pipelines/${pipelineId}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length).replace(/^\/+/, '');
  const seg = rest.split('/')[0] ?? '';
  if (!seg) return 'overview';
  return (KNOWN as string[]).includes(seg) ? (seg as PipelineTab) : 'overview';
}

// ─── lifecycle transitions — PURE, zero-IO (drives the Overview status actions) ───────────────────
//
// A pipeline moves draft → published → archived and back. The Overview exposes exactly the actions
// legal from the current status; this pure resolver decides them so the UI can never offer an illegal
// transition and it stays unit-testable. Publishing freezes an immutable version snapshot.

export type PipelineLifecycleAction = 'publish' | 'archive' | 'unarchive';

export interface PipelineTransition {
  action: PipelineLifecycleAction;
  /** The status the pipeline lands in. */
  to: 'draft' | 'published' | 'archived';
  label: string;
  /** One-line confirmation/intent copy for the button + toast. */
  hint: string;
}

// The transitions legal from each status. `publish` freezes a version (POST .../publish); `archive`
// and `unarchive` are status PATCHes.
export function pipelineTransitions(status: string): PipelineTransition[] {
  switch (status) {
    case 'draft':
      return [
        {
          action: 'publish',
          to: 'published',
          label: 'Publish',
          hint: 'Freeze this version and make it consumable',
        },
        {
          action: 'archive',
          to: 'archived',
          label: 'Archive',
          hint: 'Retire this pipeline after every consumer is explicitly detached',
        },
      ];
    case 'published':
      return [
        {
          action: 'archive',
          to: 'archived',
          label: 'Archive',
          hint: 'Retire this pipeline after every consumer is explicitly detached',
        },
      ];
    case 'archived':
      return [
        {
          action: 'unarchive',
          to: 'draft',
          label: 'Restore',
          hint: 'Bring this pipeline back as a draft to edit and re-publish',
        },
      ];
    default:
      return [];
  }
}
