// ─── App clone engine (SOP / template reuse) — PURE, zero-IO ───────────────────
// The mechanism that kills duplicate work + team isolation: deep-clone an AppSpec into a brand-new
// app so one team can adopt another team's workflow instead of rebuilding it. This module is the
// pure rule — no DB, no randomness of its own (id/slug minters are injected so the function is
// deterministic and unit-testable); apps-store.ts adapts it to the `apps` table.
//
// SOLID: the CLONE RULE (what carries over, what resets, how lineage is recorded) lives here once,
// isolated from I/O. The store supplies the id/slug minters + persistence. See test/app-clone.test.ts.

import type { AppSpec, AppStep } from '@/lib/app-model';

// ─── Lineage — what a cloned/adopted app records about where it came from ──────
// An app can be born three ways: authored from scratch (no lineage), cloned from another app in the
// same org ("Duplicate this app"), or adopted from a published org/public TEMPLATE ("Use this
// template"). Lineage is honest provenance — it never affects governance, only tells an operator
// what this app descends from so duplicate work is traceable, not hidden.
export type CloneOrigin = 'clone' | 'template';

export interface AppLineage {
  origin: CloneOrigin;
  /** The app this was duplicated from (origin:'clone') — the direct source app id. */
  sourceAppId?: string;
  /** The published template this was adopted from (origin:'template') — the template id. */
  sourceTemplateId?: string;
  /** The title of the source at clone time, for a human-readable "cloned from …" label. */
  sourceTitle?: string;
  /** When the clone happened (ISO string; injected so the pure fn stays deterministic in tests). */
  clonedAt: string;
  /** Who performed the clone/adoption. */
  clonedBy: string;
}

// The inputs a caller must supply to clone. id minter is injected (dependency inversion) so this
// module never reaches for randomUUID directly — the store owns that.
export interface CloneOptions {
  /** The org the clone lands in (the adopting team's org). */
  orgId: string;
  /** Who owns the new app (the adopting user). */
  ownerId: string;
  /** Mint the new app id. The store passes `app_<uuid>`; tests pass a stub. */
  mintId: () => string;
  /** Origin of this clone: a same-org duplicate, or a template adoption. */
  origin: CloneOrigin;
  /** ISO timestamp of the clone. */
  clonedAt: string;
  /** The template id, when origin:'template'. Ignored for a plain clone. */
  sourceTemplateId?: string;
  /** Override the new title (e.g. "Renewals Assistant (copy)"); defaults to a derived copy title. */
  title?: string;
}

// The clone result — a full, store-ready AppSpec plus the lineage the store persists alongside it.
// (AppSpec is owned by app-model.ts and has no lineage field; the store carries lineage in its own
// column, so we return them as a pair rather than mutating the immutable model type.)
export interface ClonedApp {
  spec: AppSpec;
  lineage: AppLineage;
}

// ─── deriveCopyTitle — "X" → "X (copy)", "X (copy)" → "X (copy 2)", … (PURE) ────
// A duplicate needs a distinct, human-obvious title. We never silently reuse the source title (two
// identically-named apps in a list is a usability defect). Deterministic so it's unit-testable.
export function deriveCopyTitle(sourceTitle: string): string {
  const base = (sourceTitle || '').trim() || 'Untitled app';
  const m = /^(.*)\(copy(?: (\d+))?\)$/.exec(base);
  if (!m) return `${base} (copy)`;
  const stem = m[1].trim();
  const n = m[2] ? Number(m[2]) : 1;
  return `${stem} (copy ${n + 1})`;
}

// ─── cloneStep — deep-clone one step, resetting run-time-materialized identity ──
// A cloned agent step must NOT carry the source's runtime `agentId`: that id belongs to a
// custom_agents row owned (FK: owner_app_id) by the SOURCE app. Carrying it would either alias the
// source's runtime agent (cross-app leakage) or violate the ownership constraint. So an agent step
// that was materialized (agentId + inlineAgent) is reset to its inline definition, to be
// re-materialized freshly under the clone on first run. An agent step that only references an
// external agentId (no inlineAgent — a shared library agent) is carried as-is: it's not owned.
export function cloneStep(step: AppStep): AppStep {
  const copy = structuredClone(step);
  if (copy.kind === 'agent' && copy.inlineAgent && copy.agentId) {
    // Materialized inline agent → drop the source-owned runtime id; keep the inline definition so
    // the clone re-materializes its own runtime agent (fresh ownership) on first run.
    delete copy.agentId;
  }
  return copy;
}

// ─── cloneAppSpec — the pure clone rule ────────────────────────────────────────
// Carries over: title (derived copy title unless overridden), summary, trigger, inputForm, steps
// (deep-cloned, runtime agent ids reset), edges. Resets: id (minted), org/owner (the adopter's),
// slug (cleared — a clone is unpublished, mints its own slug when it publishes), published→false,
// pipelineId (cleared — a clone must be bound to the ADOPTING org's own governed pipeline; a source
// pipeline id is meaningless / cross-tenant in another org). Records lineage.
export function cloneAppSpec(source: AppSpec, opts: CloneOptions): ClonedApp {
  const spec: AppSpec = {
    id: opts.mintId(),
    orgId: opts.orgId,
    ownerId: opts.ownerId,
    title: opts.title?.trim() || deriveCopyTitle(source.title),
    summary: source.summary ?? '',
    visibility: 'private', // a fresh clone is private until the adopter chooses to share it
    // A clone is NOT published and carries no slug — publishing it mints its own.
    slug: undefined,
    published: false,
    // Governance boundary: never carry a source pipeline binding across the clone. The adopting org
    // binds its own pipeline (or the app runs unbound and surfaces that gap honestly).
    pipelineId: null,
    trigger: source.trigger ? structuredClone(source.trigger) : { kind: 'on-demand' },
    inputForm: source.inputForm ? structuredClone(source.inputForm) : undefined,
    steps: (source.steps ?? []).map(cloneStep),
    edges: structuredClone(source.edges ?? []),
  };

  const lineage: AppLineage = {
    origin: opts.origin,
    clonedAt: opts.clonedAt,
    clonedBy: opts.ownerId,
    sourceTitle: source.title,
    ...(opts.origin === 'clone' ? { sourceAppId: source.id } : {}),
    ...(opts.origin === 'template' && opts.sourceTemplateId
      ? { sourceTemplateId: opts.sourceTemplateId }
      : {}),
  };

  return { spec, lineage };
}
