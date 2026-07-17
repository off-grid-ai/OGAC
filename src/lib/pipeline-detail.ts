// ─── Per-pipeline detail tab model — PURE, zero-IO (mirrors app-lifecycle.ts) ─────────────────────
//
// A Pipeline is the governed chokepoint; its detail surface is the reference master→detail view. Every
// saved pipeline lives at /pipelines/<id>/<tab>; this pure logic decides which tab a URL selects and
// builds the tab hrefs. No React, no router — unit-testable in test/pipeline-detail.test.ts. The
// PipelineDetailNav component is a thin renderer over `pipelineTabs`.
//
// Tabs (Overview · Gateway & Routing · Policy · Guardrails · Quality · Drift · Observability · Audit ·
// Cost · API · Versions). Overview / Gateway & Routing / Versions are FUNCTIONAL now; the telemetry +
// quality tabs are scaffolded placeholders a fan-out phase fills.

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

// The tabs in reading order. `overview` is the landing (/pipelines/<id>); the rest hang off it.
const TAB_META: { tab: PipelineTab; label: string; hint: string }[] = [
  {
    tab: 'overview',
    label: 'Overview',
    hint: 'What this pipeline is, its binding, and its data ceiling',
  },
  {
    tab: 'routing',
    label: 'Gateway & Routing',
    hint: 'The gateway it runs on + the routing/egress leash',
  },
  {
    tab: 'policy',
    label: 'Policy',
    hint: 'ABAC policy overlay — inherits org defaults, tightens locked controls',
  },
  {
    tab: 'guardrails',
    label: 'Guardrails',
    hint: 'PII masking, injection, grounding — scoped to this pipeline',
  },
  { tab: 'quality', label: 'Quality', hint: 'Evals + golden set run in this pipeline’s context' },
  { tab: 'drift', label: 'Drift', hint: 'Quality drift over this pipeline’s run history' },
  {
    tab: 'observability',
    label: 'Observability',
    hint: 'Traces, latency, and tokens for this pipeline’s runs',
  },
  { tab: 'audit', label: 'Audit', hint: 'Every governed decision this pipeline made' },
  { tab: 'cost', label: 'Cost', hint: 'Spend attributed to this pipeline → its gateway/model' },
  { tab: 'api', label: 'API', hint: 'Provisioned endpoint + key to consume this pipeline' },
  {
    tab: 'versions',
    label: 'Versions',
    hint: 'Immutable version history — every publish and edit',
  },
];

const KNOWN: PipelineTab[] = TAB_META.map((m) => m.tab);

// ─── pipelineTabHref — the canonical URL for one pipeline tab ─────────────────────────────────────
// `overview` is the pipeline's landing (/pipelines/<id>); the rest hang off it. Keeping the base tab
// at the bare path means "open a pipeline" lands on Overview without a redirect, URL stays clean.
export function pipelineTabHref(pipelineId: string, tab: PipelineTab): string {
  const base = `/runtime/pipelines/${encodeURIComponent(pipelineId)}`;
  return tab === 'overview' ? base : `${base}/${tab}`;
}

// ─── pipelineTabs — the tabs for a given pipeline, with hrefs ─────────────────────────────────────
export function pipelineTabs(pipelineId: string): PipelineTabDef[] {
  return TAB_META.map((m) => ({ ...m, href: pipelineTabHref(pipelineId, m.tab) }));
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
          hint: 'Retire this pipeline — consumers fall back to the org default',
        },
      ];
    case 'published':
      return [
        {
          action: 'archive',
          to: 'archived',
          label: 'Archive',
          hint: 'Retire this pipeline — consumers fall back to the org default',
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
