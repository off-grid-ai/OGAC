// ─── Pure pipeline-API-key + telemetry-lens shaping — zero I/O, exhaustively unit-testable ────────
//
// A pipeline is consumed by apps, agents, AND external third-parties via its OWN provisioned key +
// endpoint. This module holds the PURE rules that surround that:
//   • the key format (`og_pl_<pipelineShort>_<secret>`) + its prefix (the non-secret display stub)
//   • parse/validate a presented key into its lookup parts (WITHOUT any hashing or DB — those are I/O)
//   • pure shaping of the telemetry lenses: given a pipeline id + the raw global telemetry rows
//     (accounting spend, audit hits), narrow them to THIS pipeline's slice. Honest: no fabrication —
//     it filters what the sources actually carry, returning empty when nothing is attributed yet.
//
// The hashing (needs crypto), the store reads/writes (need DB), and the OpenSearch/Langfuse fetches
// all live in the impure adapters (pipeline-api-keys.ts + the tab pages). This is the decision surface.

// ─── key format ───────────────────────────────────────────────────────────────────────────────────
// A provisioned key is `og_pl_<pipelineShort>_<secret>` where:
//   • `og_pl_` is the fixed scheme (distinguishes a pipeline key from ogak_ gateway keys / pvt_ etc.)
//   • `<pipelineShort>` is a short slug of the pipeline id (a lookup HINT — the hash still covers the
//     whole key, so the hint can never be used to forge or narrow the secret space)
//   • `<secret>` is high-entropy random (the caller supplies it; this module only composes the string)
// Storing only the hash + `prefix` (first N chars) means the plaintext is shown ONCE and never lives
// in the DB — same discipline as provit-token.ts and the gateway keys.

export const PIPELINE_KEY_SCHEME = 'og_pl_';

// How many leading chars of the plaintext become the stored, displayable prefix (og_pl_<hint>_<6>).
// Enough to visually identify a key in the list without revealing the secret.
export const PREFIX_KEEP = 16;

// Derive the short pipeline hint embedded in the key. Pipeline ids look like `pl_ab12cd34ef56`; we
// drop the `pl_` and keep a short, url/opaque-safe slug. Falls back to a sanitized slice for any id
// shape. Pure + deterministic.
export function pipelineKeyHint(pipelineId: string): string {
  const raw = (pipelineId || '').replace(/^pl_/, '');
  const safe = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return (safe || 'pipeline').slice(0, 10);
}

// Compose the full plaintext key from a pipeline id + a caller-supplied random secret. The secret is
// NOT generated here (crypto is I/O); the adapter passes `randomBytes(...).toString('base64url')`.
export function formatPipelineKey(pipelineId: string, secret: string): string {
  return `${PIPELINE_KEY_SCHEME}${pipelineKeyHint(pipelineId)}_${secret}`;
}

// The stored, non-secret display stub for a plaintext key — its first PREFIX_KEEP chars + an ellipsis.
// This is what the keys table shows so an operator can recognize a key without it being usable.
export function prefixOf(plaintext: string): string {
  const head = (plaintext || '').slice(0, PREFIX_KEEP);
  return `${head}…`;
}

// Whether a presented string is even shaped like a pipeline key (cheap pre-check before hashing/DB).
// A real match still requires the hash to be found in the store — shape alone NEVER authenticates.
export function looksLikePipelineKey(value: string | null | undefined): boolean {
  return !!value && value.startsWith(PIPELINE_KEY_SCHEME) && value.length > PIPELINE_KEY_SCHEME.length + 4;
}

// ─── key name validation (pure) ─────────────────────────────────────────────────────────────────
export interface NameCheck {
  ok: boolean;
  name?: string;
  error?: string;
}

// A key name is a human label ("Prod — partner X"). Trim, require non-empty, cap length. Pure.
export function validateKeyName(input: unknown): NameCheck {
  const name = typeof input === 'string' ? input.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  if (name.length > 80) return { ok: false, error: 'name must be ≤ 80 characters' };
  return { ok: true, name };
}

// ─── key list view shaping (pure) ─────────────────────────────────────────────────────────────────
// The row a caller sees for a key — NEVER carries the hash or plaintext. `active` is derived from
// revokedAt (null ⇒ active). `createdAt`/`revokedAt` are ISO strings for stable rendering.
export interface PipelineKeyView {
  id: string;
  pipelineId: string;
  name: string;
  prefix: string;
  active: boolean;
  createdAt: string | null;
  createdBy: string;
  revokedAt: string | null;
}

// ─── telemetry lens: cost ───────────────────────────────────────────────────────────────────────
// The FinOps lens for a pipeline is its slice of the org-wide accounting fact table. Runs made
// THROUGH a pipeline are attributed with a `project`/`caller` tag equal to the pipeline id (the
// public run route stamps it), so the pipeline's spend is the accounting row whose label matches the
// pipeline id. Pure: given the already-fetched attributed rows, pick the matching one (or a real-zero
// row when nothing is attributed yet — honest empty, never fabricated).
export interface PipelineCostSlice {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  costUsd: number;
  byModel: { model: string; requests: number; tokens: number; costUsd: number }[];
  /** true when a matching attributed row was found; false ⇒ nothing billed to this pipeline yet. */
  attributed: boolean;
}

interface AttributedRowLike {
  label: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  costUsd: number;
  byModel: { model: string; requests: number; tokens: number; costUsd: number }[];
}

// Find this pipeline's spend across the accounting attribution rows (byProject ∪ byActor). We match
// the pipeline id AND the provisioned-key prefix forms the run route may stamp as the caller. Pure.
export function pipelineCostSlice(
  pipelineId: string,
  rows: { byProject: AttributedRowLike[]; byActor: AttributedRowLike[] },
): PipelineCostSlice {
  const wanted = pipelineTag(pipelineId);
  const match =
    rows.byProject.find((r) => r.label === wanted) ??
    rows.byActor.find((r) => r.label === wanted) ??
    null;
  if (!match) {
    return {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      tokens: 0,
      costUsd: 0,
      byModel: [],
      attributed: false,
    };
  }
  return {
    requests: match.requests,
    promptTokens: match.promptTokens,
    completionTokens: match.completionTokens,
    tokens: match.tokens,
    costUsd: match.costUsd,
    byModel: match.byModel.map((m) => ({
      model: m.model,
      requests: m.requests,
      tokens: m.tokens,
      costUsd: m.costUsd,
    })),
    attributed: true,
  };
}

// The canonical caller/project tag a pipeline's runs are attributed under. The public run route
// stamps this so cost + audit lenses can key off it. Pure + deterministic.
export function pipelineTag(pipelineId: string): string {
  return `pipeline:${pipelineId}`;
}

// PA-12 — the ONE canonical tag-derivation used at every telemetry SOURCE (traces, eval_runs, cost,
// audit) so per-pipeline lenses filter EXACTLY on one form. Given a run's bound pipeline id (or
// null/empty when no pipeline governs the run), returns the canonical `pipeline:<id>` tag or null.
// A run with NO bound pipeline yields null ⇒ NO pipeline tag is stamped (unchanged legacy behaviour).
// Pure + deterministic; trims and rejects blank ids so an empty binding never produces a bare
// `pipeline:` tag.
export function pipelineTagOrNull(pipelineId: string | null | undefined): string | null {
  const id = (pipelineId ?? '').trim();
  return id ? pipelineTag(id) : null;
}

// ─── telemetry lens: audit ────────────────────────────────────────────────────────────────────────
// The audit lens for a pipeline is every governed decision that names it — the resource is
// `pipeline:<id>` (management events: key mint/revoke, config change) OR the run carried the pipeline
// tag. Pure filter over already-fetched audit rows so it's unit-testable with no OpenSearch.
export interface AuditRowLike {
  resource?: string | null;
  project?: string | null;
}

export function filterAuditForPipeline<T extends AuditRowLike>(rows: T[], pipelineId: string): T[] {
  const tag = pipelineTag(pipelineId);
  return rows.filter((r) => {
    const resource = (r.resource ?? '').toString();
    const project = (r.project ?? '').toString();
    return resource === tag || project === tag || resource === pipelineId || project === pipelineId;
  });
}
