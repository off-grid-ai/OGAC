// PURE pipeline VERSION rules — ZERO imports of db/IO, exhaustively unit-testable (mirrors
// pipelines-policy.ts / pipeline-lifecycle-model.ts / rollback-policy.ts). Owns three pure decisions
// the version-management surface needs, with no network and no DB:
//
//   1. validateVersionLabel(v)   — the operator-supplied label/annotation on a frozen version
//      (trim + length; empty clears the label). One rule, reused by the annotate route + UI.
//   2. diffSnapshots(from, to)   — a field-by-field DIFF of two frozen version snapshots (the full
//      governance contract: identity, gateway/model, routing/egress leash, data ceiling, policy +
//      guardrail overlays, status). Tolerant of partial/legacy snapshots (stored as loose jsonb).
//   3. pickVersionTarget(...)    — the TARGETED-rollback selector: which prior version an operator
//      may promote back to active. Pure guard (must exist, must be strictly older, must carry a
//      snapshot); the I/O restore lives in pipeline-release.ts. Plus manualRollbackNote for history.
//
// The DB I/O lives in pipelines.ts / pipeline-release.ts; this file can never touch the network/DB.
import type { RollbackCandidate, RollbackTarget } from '@/lib/rollback-policy';

// ─── 1. version label / annotation (PURE) ───────────────────────────────────────────────────────────

/** Max length of an operator's version label — kept well under the DB text column's practical width. */
export const VERSION_LABEL_MAX = 80;

export interface VersionLabelValidation {
  ok: boolean;
  /** The cleaned label (trimmed). Empty string means "clear the label". */
  value: string;
  error?: string;
}

/**
 * Validate + normalise an operator-supplied version label. PURE. An empty/whitespace value is VALID
 * and clears the label (annotation is optional). A non-string, or a value over the cap, is rejected.
 */
export function validateVersionLabel(v: unknown): VersionLabelValidation {
  if (v === undefined || v === null) return { ok: true, value: '' };
  if (typeof v !== 'string') return { ok: false, value: '', error: 'label must be a string' };
  const value = v.trim();
  if (value.length > VERSION_LABEL_MAX) {
    return { ok: false, value: '', error: `label must be ${VERSION_LABEL_MAX} characters or fewer` };
  }
  return { ok: true, value };
}

// ─── 2. version DIFF (PURE) — compare two frozen governance contracts ───────────────────────────────

export type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface FieldChange {
  /** Stable machine key (e.g. 'gatewayId'). */
  field: string;
  /** Human label for the UI (e.g. 'Gateway'). */
  label: string;
  kind: DiffKind;
  /** Rendered previous value (from-version). */
  from: string;
  /** Rendered next value (to-version). */
  to: string;
}

export interface VersionDiff {
  changes: FieldChange[];
  /** How many fields actually changed (added|removed|changed). */
  changedCount: number;
}

// A loose view of a stored snapshot — snapshots are jsonb, so every field is optional/unknown. Mirrors
// the PipelineSnapshot shape (pipelines-policy.ts) without importing it (keeps this file dependency-free
// of the DB-facing types and robust to legacy rows missing newer keys).
export type SnapshotLike = Record<string, unknown> | null | undefined;

function str(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Render a data-ceiling (allowlist) into a stable, comparable string — sorted so order never shows as
// a spurious change.
function renderAllowlist(v: unknown): string {
  const arr = asArray(v)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return arr.length ? arr.join(', ') : '—';
}

// Render the routing envelope into a stable summary: egress on/off + rule count. Keeps the diff
// readable (the full rule array lives in the version's contract view, not the diff cell).
function renderRouting(v: unknown): string {
  const o = asObject(v);
  const egress = o.egressAllowed === false ? 'egress OFF' : 'egress ON';
  const rules = Array.isArray(o.rules) ? o.rules.length : 0;
  return `${egress} · ${rules} rule(s)`;
}

// Render an overlay (policy/guardrail) into a stable summary: sorted key list, so adding/removing a
// control shows as a change without leaking the (possibly large) nested values into the diff cell.
function renderOverlay(v: unknown): string {
  const keys = Object.keys(asObject(v)).sort((a, b) => a.localeCompare(b));
  return keys.length ? keys.join(', ') : '—';
}

// The ordered contract fields the diff compares, each with its label + a stable renderer. Defined ONCE
// so the diff, the contract view, and the tests agree on what "the contract" is.
interface FieldSpec {
  field: string;
  label: string;
  render: (snap: Record<string, unknown>) => string;
}

const CONTRACT_FIELDS: readonly FieldSpec[] = [
  { field: 'name', label: 'Name', render: (s) => str(s.name) },
  { field: 'description', label: 'Description', render: (s) => str(s.description) },
  { field: 'visibility', label: 'Visibility', render: (s) => str(s.visibility) },
  { field: 'status', label: 'Status', render: (s) => str(s.status) },
  { field: 'gatewayId', label: 'Gateway', render: (s) => str(s.gatewayId) },
  { field: 'defaultModel', label: 'Default model', render: (s) => str(s.defaultModel) },
  { field: 'routing', label: 'Routing / egress', render: (s) => renderRouting(s.routing) },
  { field: 'dataAllowlist', label: 'Data ceiling', render: (s) => renderAllowlist(s.dataAllowlist) },
  { field: 'policyOverlay', label: 'Policy overlay', render: (s) => renderOverlay(s.policyOverlay) },
  {
    field: 'guardrailOverlay',
    label: 'Guardrail overlay',
    render: (s) => renderOverlay(s.guardrailOverlay),
  },
  { field: 'isTemplate', label: 'Template', render: (s) => str(s.isTemplate) },
];

/** Render a single frozen snapshot as the ordered, labelled contract rows (for the version detail
 *  view). PURE — the same field set + renderers the diff uses, so the two can never diverge. */
export function contractRows(snapshot: SnapshotLike): { field: string; label: string; value: string }[] {
  const snap = asObject(snapshot);
  return CONTRACT_FIELDS.map((f) => ({ field: f.field, label: f.label, value: f.render(snap) }));
}

/**
 * Diff two frozen version snapshots field-by-field across the full governance contract. PURE.
 * `from` is the older/base version, `to` the newer/compared version. For each contract field:
 *   - both '—' (absent)          ⇒ unchanged;
 *   - from '—', to present       ⇒ added;
 *   - from present, to '—'       ⇒ removed;
 *   - both present + differ      ⇒ changed;
 *   - both present + equal       ⇒ unchanged.
 * Tolerant of partial/legacy snapshots (missing keys render as '—'); never throws.
 */
export function diffSnapshots(from: SnapshotLike, to: SnapshotLike): VersionDiff {
  const a = asObject(from);
  const b = asObject(to);
  const changes: FieldChange[] = CONTRACT_FIELDS.map((f) => {
    const fromVal = f.render(a);
    const toVal = f.render(b);
    let kind: DiffKind;
    if (fromVal === toVal) kind = 'unchanged';
    else if (fromVal === '—') kind = 'added';
    else if (toVal === '—') kind = 'removed';
    else kind = 'changed';
    return { field: f.field, label: f.label, kind, from: fromVal, to: toVal };
  });
  const changedCount = changes.filter((c) => c.kind !== 'unchanged').length;
  return { changes, changedCount };
}

// ─── 3. targeted rollback selection (PURE) ──────────────────────────────────────────────────────────

export interface VersionTargetResult {
  ok: boolean;
  target: RollbackTarget | null;
  /** Honest reason the chosen version can't be a rollback target. */
  reason?: string;
}

/**
 * Pick a SPECIFIC prior version to roll back to (the operator explicitly chose `toVersion`), given the
 * current version + the full history. PURE. Unlike pickRollbackTarget (which auto-picks the last-good
 * published), this honours the operator's choice but still GUARDS it:
 *   - the version must exist in the history;
 *   - it must be STRICTLY OLDER than the current version (can't "roll back" to current/newer);
 *   - it must carry a snapshot (the config to restore).
 * Returns { ok:false, reason } otherwise — never fabricates a target.
 */
export function pickVersionTarget(
  toVersion: number,
  currentVersion: number,
  history: RollbackCandidate[],
): VersionTargetResult {
  if (!Number.isInteger(toVersion) || toVersion <= 0) {
    return { ok: false, target: null, reason: 'a valid target version is required' };
  }
  if (toVersion >= currentVersion) {
    return {
      ok: false,
      target: null,
      reason: `v${toVersion} is not older than the current v${currentVersion} — nothing to roll back to`,
    };
  }
  const found = history.find((v) => v.version === toVersion);
  if (!found) {
    return { ok: false, target: null, reason: `no version v${toVersion} in this pipeline's history` };
  }
  if (!found.snapshot || typeof found.snapshot !== 'object') {
    return { ok: false, target: null, reason: `v${toVersion} has no restorable snapshot` };
  }
  return { ok: true, target: { version: found.version, snapshot: found.snapshot } };
}

/** A human-readable, audit-ready line explaining a MANUAL targeted rollback. PURE (mirrors
 *  rollbackNote in rollback-policy.ts, but for an operator-chosen version). */
export function manualRollbackNote(
  fromVersion: number,
  toVersion: number,
  detail?: string,
): string {
  const base = `Rollback (manual): v${fromVersion} → restored v${toVersion}`;
  const trimmed = detail?.trim();
  return trimmed ? `${base} — ${trimmed}` : base;
}
