// PURE pipeline RULES — ZERO imports of db/IO, exhaustively unit-testable (mirrors gateways-policy.ts
// / routing-policy.ts / tenancy-policy.ts). A Pipeline is the reusable, GOVERNED model-access contract
// (gateway binding + routing + data allowlist + policy/guardrail overlays + immutable versions). This
// file owns every rule that decides "what is allowed", with no network and no DB:
//
//   1. validatePipelineCreate / validatePipelineUpdate — shape + required fields.
//   2. effectiveGovernance(orgDefaults, overlay) — the mandatory-vs-overridable merge. An org control
//      typed `locked` may only be TIGHTENED by a pipeline overlay, never loosened (least-permissive-
//      wins). A `default` control is freely overridable. This is the heart of the governance model.
//   3. canReachData(allowlist, requested) — the HARD data CEILING predicate: a consumer may only ever
//      touch data inside the pipeline's allowlist.
//   4. deriveEgress(routing, dataClass) — wraps the PURE decideRouting() (routing-policy.ts) so the
//      egress leash (data_class → local|cloud|block) is defined ONCE, not re-implemented here.
//   5. snapshotOf(pipeline) / nextVersion(current) — the immutable version-snapshot helpers.
//
// The DB I/O lives in pipelines.ts (the adapter). This file can never, by construction, touch the
// network or the DB.
import {
  type RoutingDecision,
  type RoutingRuleLite,
  decideRouting,
} from '@/lib/routing-policy';

// ─── status + visibility vocab ────────────────────────────────────────────────────────────────────

export type PipelineStatus = 'draft' | 'published' | 'archived';
export type PipelineVisibility = 'private' | 'org' | 'public';

export const PIPELINE_STATUSES: readonly PipelineStatus[] = ['draft', 'published', 'archived'];
export const PIPELINE_VISIBILITIES: readonly PipelineVisibility[] = ['private', 'org', 'public'];

export function isPipelineStatus(v: unknown): v is PipelineStatus {
  return typeof v === 'string' && (PIPELINE_STATUSES as readonly string[]).includes(v);
}
export function isPipelineVisibility(v: unknown): v is PipelineVisibility {
  return typeof v === 'string' && (PIPELINE_VISIBILITIES as readonly string[]).includes(v);
}

// ─── the pipeline routing envelope (jsonb column shape) ─────────────────────────────────────────────
// Kept identical to the schema.ts jsonb type so the pure layer and the DB agree. `rules` are the same
// RoutingRuleLite the org-level routing engine uses (DRY — no second rule shape).
export interface PipelineRouting {
  /** Master egress switch for this pipeline (default true; false ⇒ cloud actions leash to block). */
  egressAllowed?: boolean;
  /** Ordered fallback/routing rules; same shape as the org routing engine. */
  rules?: RoutingRuleLite[];
}

// ─── a pipeline as the pure layer sees it (no DB types leaked in) ───────────────────────────────────
export interface PipelineShape {
  id: string;
  orgId: string;
  ownerId: string;
  name: string;
  description: string;
  visibility: string;
  gatewayId: string | null;
  defaultModel: string | null;
  routing: PipelineRouting;
  dataAllowlist: string[];
  policyOverlay: Record<string, unknown>;
  guardrailOverlay: Record<string, unknown>;
  status: string;
  version: number;
  isTemplate: boolean;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

// ─── 1. validation ──────────────────────────────────────────────────────────────────────────────────

export interface PipelineCreateInput {
  name?: unknown;
  description?: unknown;
  visibility?: unknown;
  gatewayId?: unknown;
  defaultModel?: unknown;
  routing?: unknown;
  dataAllowlist?: unknown;
  policyOverlay?: unknown;
  guardrailOverlay?: unknown;
  status?: unknown;
  isTemplate?: unknown;
}

export interface PipelineValidation {
  ok: boolean;
  errors: string[];
}

/** Normalise an unknown into a clean string[] of trimmed, non-empty, de-duped ids. PURE. */
export function normalizeAllowlist(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Coerce an unknown into a PipelineRouting envelope, dropping anything malformed. PURE. */
export function normalizeRouting(v: unknown): PipelineRouting {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: PipelineRouting = {};
  if (typeof o.egressAllowed === 'boolean') out.egressAllowed = o.egressAllowed;
  if (Array.isArray(o.rules)) {
    out.rules = o.rules
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        name: String(r.name ?? ''),
        priority: Number.isFinite(r.priority) ? Number(r.priority) : 100,
        attribute: String(r.attribute ?? ''),
        operator: String(r.operator ?? 'eq'),
        value: String(r.value ?? ''),
        action: String(r.action ?? 'local'),
        model: String(r.model ?? ''),
        fallback: String(r.fallback ?? ''),
        enabled: r.enabled === undefined ? true : Boolean(r.enabled),
      }));
  }
  return out;
}

/** Validate a create request. name required; status/visibility in their sets when present. PURE. */
export function validatePipelineCreate(draft: PipelineCreateInput): PipelineValidation {
  const errors: string[] = [];
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (!name) errors.push('name is required');
  if (name.length > 120) errors.push('name must be 120 characters or fewer');
  if (draft.status !== undefined && !isPipelineStatus(draft.status)) {
    errors.push(`status must be one of ${PIPELINE_STATUSES.join(', ')}`);
  }
  if (draft.visibility !== undefined && !isPipelineVisibility(draft.visibility)) {
    errors.push(`visibility must be one of ${PIPELINE_VISIBILITIES.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Validate an update patch — same rules as create, but every field is optional (name, if present,
 *  must still be non-empty). PURE. */
export function validatePipelineUpdate(patch: PipelineCreateInput): PipelineValidation {
  const errors: string[] = [];
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name) errors.push('name cannot be empty');
    if (name.length > 120) errors.push('name must be 120 characters or fewer');
  }
  if (patch.status !== undefined && !isPipelineStatus(patch.status)) {
    errors.push(`status must be one of ${PIPELINE_STATUSES.join(', ')}`);
  }
  if (patch.visibility !== undefined && !isPipelineVisibility(patch.visibility)) {
    errors.push(`visibility must be one of ${PIPELINE_VISIBILITIES.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}

// ─── 2. effectiveGovernance — the mandatory-vs-overridable merge ───────────────────────────────────
//
// An org defines controls. Each is typed `locked` (mandatory — a pipeline may only TIGHTEN it) or
// `default` (freely overridable). A control's VALUE is either a boolean toggle or a permission LEVEL on
// an ordered scale (least → most permissive). "Tighten" = move toward the LESS permissive end; "loosen"
// = move toward the MORE permissive end. The merge is least-permissive-wins for locked controls: the
// pipeline may pick any value that is ≤ the org value on the scale, and a loosening attempt is REJECTED
// (the org value stands + we flag the rejection so the UI can surface it honestly).

/** The canonical permission scale, least → most permissive. A control's `level` sits on this. */
export const PERMISSION_SCALE = ['block', 'mask', 'local', 'cloud', 'allow'] as const;
export type PermissionLevel = (typeof PERMISSION_SCALE)[number];

export function isPermissionLevel(v: unknown): v is PermissionLevel {
  return typeof v === 'string' && (PERMISSION_SCALE as readonly string[]).includes(v);
}

/** One governance control. `mode: locked` ⇒ mandatory (only tightenable). Value is a boolean toggle
 *  OR a permission level; whichever the org set. */
export interface GovernanceControl {
  mode: 'locked' | 'default';
  /** Boolean toggle controls (e.g. requirePiiMasking: true means "on"). */
  bool?: boolean;
  /** Level controls on the PERMISSION_SCALE (e.g. maxEgress: 'local'). */
  level?: PermissionLevel;
}

export type GovernanceControls = Record<string, GovernanceControl>;

export interface EffectiveControl {
  key: string;
  mode: 'locked' | 'default';
  /** The effective value after merge. */
  bool?: boolean;
  level?: PermissionLevel;
  /** True if the org value came from a `locked` control and the overlay could not loosen it. */
  fromLocked: boolean;
  /** True if the overlay tried to LOOSEN a locked control and was rejected (surface this in the UI). */
  loosenRejected: boolean;
  /** True if the overlay legitimately overrode (a `default`, or a tighten of a `locked`). */
  overridden: boolean;
}

export interface EffectiveGovernance {
  controls: Record<string, EffectiveControl>;
  /** The keys where a loosen was rejected — the honest "you can't weaken this" signal. */
  rejected: string[];
}

/** Position of a level on the scale; -1 if not a known level. Higher index = MORE permissive. PURE. */
function levelRank(level: PermissionLevel | undefined): number {
  if (level === undefined) return -1;
  return (PERMISSION_SCALE as readonly string[]).indexOf(level);
}

/**
 * Merge org defaults with a pipeline overlay under the mandatory-locked rule. PURE.
 *
 * For each org control:
 *  - `default`: the overlay value (if present + valid) wins; else the org value stands.
 *  - `locked` : the overlay may only TIGHTEN. For a boolean, `true` ("on"/stricter) may be set but an
 *    attempt to turn a locked-on control OFF is rejected. For a level, the overlay may set any level
 *    that is LESS-OR-EQUAL permissive (≤ the org level's rank); a MORE permissive value is rejected.
 * Overlay keys that name no org control are ignored (a pipeline cannot invent controls the org didn't
 * define — the org owns the control surface).
 */
export function effectiveGovernance(
  orgDefaults: GovernanceControls,
  pipelineOverlay: GovernanceControls,
): EffectiveGovernance {
  const controls: Record<string, EffectiveControl> = {};
  const rejected: string[] = [];

  for (const [key, org] of Object.entries(orgDefaults)) {
    const overlay = pipelineOverlay[key];
    const eff: EffectiveControl = {
      key,
      mode: org.mode,
      bool: org.bool,
      level: org.level,
      fromLocked: org.mode === 'locked',
      loosenRejected: false,
      overridden: false,
    };

    if (overlay) {
      if (org.mode === 'default') {
        // Freely overridable — take the overlay value where provided.
        if (typeof overlay.bool === 'boolean') {
          eff.bool = overlay.bool;
          eff.overridden = true;
        }
        if (isPermissionLevel(overlay.level)) {
          eff.level = overlay.level;
          eff.overridden = true;
        }
      } else {
        // Locked — only a tighten is honoured; a loosen is rejected.
        if (typeof overlay.bool === 'boolean' && typeof org.bool === 'boolean') {
          // Convention: `true` is the stricter/on state. Locked-on can't be turned off; locked-off
          // can be turned on (that's a tighten).
          if (org.bool === true && overlay.bool === false) {
            eff.loosenRejected = true;
          } else if (overlay.bool !== org.bool) {
            eff.bool = overlay.bool;
            eff.overridden = true;
          }
        }
        if (isPermissionLevel(overlay.level) && org.level !== undefined) {
          const orgRank = levelRank(org.level);
          const overlayRank = levelRank(overlay.level);
          if (overlayRank > orgRank) {
            eff.loosenRejected = true; // more permissive than the locked ceiling — reject
          } else if (overlayRank < orgRank) {
            eff.level = overlay.level; // strictly tighter — honour
            eff.overridden = true;
          }
        }
      }
    }

    if (eff.loosenRejected) rejected.push(key);
    controls[key] = eff;
  }

  return { controls, rejected };
}

// ─── 3. canReachData — the HARD data ceiling ────────────────────────────────────────────────────────

/**
 * The HARD CEILING predicate. A consumer may only touch data whose id is in the pipeline's allowlist.
 * PURE. An empty allowlist means "no data reachable" (deny-by-default), NOT "everything" — a pipeline
 * that touches no data is the safe default, and widening is an explicit edit.
 */
export function canReachData(allowlist: string[], requested: string): boolean {
  if (!requested) return false;
  return allowlist.includes(requested);
}

// ─── 4. deriveEgress — delegate to the PURE routing rule ───────────────────────────────────────────

/**
 * Decide the egress for a request of a given data_class under this pipeline's routing. PURE — it wraps
 * the existing decideRouting() (routing-policy.ts) so the leash ("data_class = PII → never leaves the
 * box") is defined ONCE. The data_class is fed as the request attribute the routing rules match on.
 */
export function deriveEgress(routing: PipelineRouting, dataClass: string): RoutingDecision {
  const rules = routing.rules ?? [];
  const egressAllowed = routing.egressAllowed !== false; // default ON unless explicitly disabled
  return decideRouting(rules, { data_class: dataClass }, egressAllowed);
}

// ─── 5. snapshot + version helpers ──────────────────────────────────────────────────────────────────

/** The immutable snapshot shape frozen into pipeline_versions.snapshot. */
export interface PipelineSnapshot {
  name: string;
  description: string;
  visibility: string;
  gatewayId: string | null;
  defaultModel: string | null;
  routing: PipelineRouting;
  dataAllowlist: string[];
  policyOverlay: Record<string, unknown>;
  guardrailOverlay: Record<string, unknown>;
  status: string;
  version: number;
  isTemplate: boolean;
}

/** Produce the immutable version snapshot object for a pipeline. PURE — a plain, self-contained copy of
 *  the governance-relevant config at this version (no timestamps/ids that would change on replay). */
export function snapshotOf(p: PipelineShape): PipelineSnapshot {
  return {
    name: p.name,
    description: p.description,
    visibility: p.visibility,
    gatewayId: p.gatewayId ?? null,
    defaultModel: p.defaultModel ?? null,
    routing: normalizeRouting(p.routing),
    dataAllowlist: normalizeAllowlist(p.dataAllowlist),
    policyOverlay: p.policyOverlay ?? {},
    guardrailOverlay: p.guardrailOverlay ?? {},
    status: p.status,
    version: p.version,
    isTemplate: p.isTemplate,
  };
}

/** The next version number after an edit/publish. PURE. */
export function nextVersion(current: number): number {
  return (Number.isFinite(current) && current > 0 ? current : 1) + 1;
}

// ─── Reverse edge: which pipelines reference a data entity (PURE) ───────────────────────────────────
// A pipeline's `dataAllowlist` is a free-text list of domain references — an operator types domain
// ids, labels, or aliases into the ceiling (see PipelineEditSheet). So to decide "does this pipeline
// reference THIS domain" we match the allowlist against the FULL set of tokens the domain is known by
// (its id + label + aliases), case-insensitively + trimmed. Pure, so it's exhaustively unit-testable
// and identical whether we're rendering the domain-detail panel or a connector's roll-up.

/** Normalise a reference token for comparison: trimmed + lower-cased. PURE. */
export function normalizeRefToken(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export interface DomainRefTokens {
  id: string;
  label?: string | null;
  aliases?: string[] | null;
}

/** The de-duped, normalised set of tokens a data-domain can be referenced by (id ∪ label ∪ aliases). */
export function domainMatchTokens(domain: DomainRefTokens): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    const t = normalizeRefToken(v);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  add(domain.id);
  add(domain.label);
  for (const a of domain.aliases ?? []) add(a);
  return out;
}

/**
 * Does a pipeline's dataAllowlist reference a domain identified by `tokens`? True when ANY normalised
 * allowlist entry equals ANY of the domain's tokens. Pure — no I/O, given the already-read allowlist.
 */
export function allowlistReferencesTokens(dataAllowlist: string[], tokens: string[]): boolean {
  if (!tokens.length) return false;
  const want = new Set(tokens);
  return normalizeAllowlist(dataAllowlist).some((entry) => want.has(normalizeRefToken(entry)));
}

// ─── Pipeline facet filter (PURE) ───────────────────────────────────────────────────────────────────
// The Insights roll-ups (observability/analytics/siem/audit/accounting/finops/reports) expose a
// `?pipeline=<id>` facet. This coerces the raw URL param into a clean pipeline id, GATED to the set the
// org actually owns so a stale/forged id degrades to "all pipelines" (null) rather than an empty view.

/** Coerce a raw `?pipeline` searchParam value (string | string[] | undefined) into a single string. */
export function readPipelineParam(raw: string | string[] | undefined | null): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Resolve the effective pipeline facet: the requested id if it's one the org owns, else null ("all").
 * `known` is the list of pipeline ids the org has. Pure + deterministic — never trusts a raw id.
 */
export function resolvePipelineFacet(
  raw: string | string[] | undefined | null,
  known: string[],
): string | null {
  const id = readPipelineParam(raw);
  if (!id) return null;
  return known.includes(id) ? id : null;
}

/** Client/server-side filter of already-`pipeline:<id>`-tagged rows down to one pipeline's slice. PURE.
 *  `tagOf` extracts a row's pipeline tag/label (e.g. `project`/`caller`/`resource`); a row matches when
 *  it equals `pipeline:<id>` OR the bare id. Returns all rows unchanged when facet is null ("all"). */
export function filterRowsByPipeline<T>(
  rows: T[],
  facet: string | null,
  tagOf: (row: T) => (string | null | undefined)[],
): T[] {
  if (!facet) return rows;
  const want = new Set([`pipeline:${facet}`, facet]);
  return rows.filter((r) => tagOf(r).some((t) => (t ? want.has(t) : false)));
}
