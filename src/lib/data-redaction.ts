// Data redaction ON THE MOVEMENT PATH — the governance a pipeline applies to rows as they move
// source → warehouse, BEFORE anything lands. A data sync is a governed pipeline (see
// docs/platform/DATA_PLANE_PARITY.md), so it carries the same PII engine as model access.
//
// SOLID: the transforms here are PURE + zero-IO (unit-testable with no mocks). The only IO is the
// optional PII *detection* on free-text columns, which is delegated to the guardrails PiiPort
// (regex floor always-on; Presidio when wired) — injected, never imported here, so this module
// stays pure and the network path is swappable/mockable.

import type { PiiPort } from './adapters/types';

/** What to do with a column's values as they move. */
export type RedactionAction =
  | 'keep' // pass through unchanged
  | 'mask' // reveal only the last few chars (e.g. account/card tails)
  | 'hash' // irreversible deterministic digest (join-safe pseudonym)
  | 'tokenize' // stable surrogate token (reversible only via a vault, not here)
  | 'drop' // remove the column value entirely (null it)
  | 'detect'; // free-text: run PII detection + redact the detected spans

export interface ColumnRule {
  column: string;
  action: RedactionAction;
  /** for 'mask' — how many trailing chars to keep visible (default 4). */
  keepLast?: number;
}

export type RedactionPolicy = ColumnRule[];

export interface RedactionReportEntry {
  column: string;
  action: RedactionAction;
  /** how many row-values this rule changed. */
  changed: number;
}

export interface RedactionResult {
  rows: Record<string, unknown>[];
  report: RedactionReportEntry[];
  /** total values altered across all columns — the number that goes to the audit line. */
  totalRedacted: number;
  /** Which detector was requested and which engine(s) actually handled detect rules. */
  detection?: {
    requestedEngine: string;
    engines: string[];
    status: 'applied' | 'fallback' | 'unconfigured' | 'down';
    reasons: string[];
  };
}

// ── pure value transforms ────────────────────────────────────────────────────
const MASK_CHAR = '•';

export function maskValue(value: unknown, keepLast = 4): string {
  const s = value == null ? '' : String(value);
  if (s.length <= keepLast) return MASK_CHAR.repeat(s.length);
  return MASK_CHAR.repeat(s.length - keepLast) + s.slice(s.length - keepLast);
}

// FNV-1a 32-bit — deterministic, dependency-free, stable across processes (no crypto import so this
// stays zero-IO/pure). Good for a join-safe pseudonym, NOT a security hash — that's the point: it's
// irreversible for a reader but consistent so redacted rows still join on the hashed key.
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function hashValue(value: unknown): string {
  return value == null ? '' : `h:${fnv1a(String(value))}`;
}

export function tokenizeValue(value: unknown): string {
  return value == null ? '' : `tok_${fnv1a('tok:' + String(value))}`;
}

/** Apply one rule to a single value. Returns the new value + whether it changed. */
export function applyAction(
  value: unknown,
  action: RedactionAction,
  keepLast?: number,
): { value: unknown; changed: boolean } {
  switch (action) {
    case 'keep':
      return { value, changed: false };
    case 'drop':
      return { value: null, changed: value != null };
    case 'mask':
      return {
        value: maskValue(value, keepLast),
        changed: value != null && String(value).length > 0,
      };
    case 'hash':
      return { value: hashValue(value), changed: value != null };
    case 'tokenize':
      return { value: tokenizeValue(value), changed: value != null };
    case 'detect':
      // handled asynchronously in redactBatch (needs the PiiPort); no-op in the pure path.
      return { value, changed: false };
    default:
      return { value, changed: false };
  }
}

/**
 * Apply the non-'detect' rules to a batch — fully pure. 'detect' columns are left for redactBatch
 * (they need the async PII port). Unknown columns in a row are passed through untouched.
 */
export function applyColumnRules(
  rows: Record<string, unknown>[],
  policy: RedactionPolicy,
): RedactionResult {
  const byCol = new Map(policy.map((r) => [r.column, r]));
  const report = new Map<string, RedactionReportEntry>();
  const out = rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const [col, rule] of byCol) {
      if (rule.action === 'detect' || !(col in next)) continue;
      const { value, changed } = applyAction(next[col], rule.action, rule.keepLast);
      next[col] = value;
      if (changed) {
        const e = report.get(col) ?? { column: col, action: rule.action, changed: 0 };
        e.changed++;
        report.set(col, e);
      }
    }
    return next;
  });
  const reportArr = [...report.values()];
  return {
    rows: out,
    report: reportArr,
    totalRedacted: reportArr.reduce((n, e) => n + e.changed, 0),
  };
}

// ── M4 classification → redaction actions (pure) ──────────────────────────────
/**
 * Map a column's data-classification sensitivity label to a default redaction action. This is how
 * the M4 classification/masking-rules engine drives what happens on the sync path without a human
 * choosing per-column. Conservative by design: unknown/blank labels default to 'detect' (scan it),
 * never 'keep' — fail toward caution.
 */
/**
 * How each sensitivity label is handled, as data.
 *
 * The DEFAULT is 'detect', not 'keep': an unrecognised or missing label means we do not know what is
 * in the column, and scanning it is the safe reading. Defaulting to keep would silently pass unknown
 * data through the moment someone introduces a new label.
 */
const SENSITIVITY_ACTIONS: Record<string, RedactionAction> = {
  public: 'keep',
  internal: 'keep',
  confidential: 'mask',
  restricted: 'drop',
  secret: 'drop',
  pii: 'detect',
  sensitive: 'detect',
};

export function actionForSensitivity(label: string | undefined): RedactionAction {
  return SENSITIVITY_ACTIONS[(label ?? '').trim().toLowerCase()] ?? 'detect';
}

export function policyFromClassifications(
  classifications: { column: string; sensitivity?: string }[],
): RedactionPolicy {
  return classifications.map((c) => ({
    column: c.column,
    action: actionForSensitivity(c.sensitivity),
  }));
}

// ── the full batch redaction (pure rules + async PII detect) ──────────────────
/**
 * Redact a batch end-to-end: apply the pure column rules, then for each 'detect' column run the
 * PII port over its free-text values and replace with the redacted text. The PiiPort is injected
 * (regex floor or Presidio) so this function is testable against the always-on regex with no network.
 */
type DetectionStatus = NonNullable<RedactionResult['detection']>['status'];

/**
 * Merge one cell's detector status into the batch's. PURE.
 *
 * Severity wins, and it is one-way: once any cell reported the detector DOWN, the batch cannot climb
 * back to "applied" because a later cell happened to scan. Reporting the best status seen would tell
 * an operator their data was screened when part of it was not.
 */
const DETECTION_SEVERITY: Record<string, number> = {
  applied: 0,
  fallback: 1,
  unconfigured: 2,
  down: 3,
};

function worstDetectionStatus(
  current: DetectionStatus,
  incoming: string | undefined,
): DetectionStatus {
  const severity = DETECTION_SEVERITY[incoming ?? ''] ?? 0;
  return severity > (DETECTION_SEVERITY[current] ?? 0) ? (incoming as DetectionStatus) : current;
}

/** The scannable text in a cell, or null when there is nothing to scan. PURE. */
function cellText(row: Record<string, unknown>, col: string): string | null {
  if (!(col in row)) return null;
  const raw = row[col];
  if (raw == null) return null;
  const text = String(raw);
  return text.length === 0 ? null : text;
}

/** Record one more redaction against a column. */
function countRedaction(
  report: Map<string, { column: string; action: RedactionAction; changed: number }>,
  col: string,
): void {
  const entry = report.get(col) ?? { column: col, action: 'detect' as RedactionAction, changed: 0 };
  entry.changed++;
  report.set(col, entry);
}

/** What a detect pass accumulates across every scanned cell. */
interface DetectionAccumulator {
  engines: Set<string>;
  reasons: Set<string>;
  report: Map<string, { column: string; action: RedactionAction; changed: number }>;
  status: DetectionStatus;
}

/** Scan one row's detect-columns in place, folding what was learned into the accumulator. */
async function scanRow(
  row: Record<string, unknown>,
  detectCols: string[],
  pii: PiiPort,
  orgId: string | undefined,
  acc: DetectionAccumulator,
): Promise<void> {
  for (const col of detectCols) {
    const cell = cellText(row, col);
    if (cell === null) continue; // absent or empty — nothing to scan

    const scan = await pii.scan(cell, orgId);
    acc.engines.add(scan.engine);
    if (scan.reason) acc.reasons.add(scan.reason);
    acc.status = worstDetectionStatus(acc.status, scan.status);
    if (!scan.hits) continue;

    // A hit with no redacted form still must not leave the original in place.
    row[col] = scan.redacted ?? '[REDACTED]';
    countRedaction(acc.report, col);
  }
}

export async function redactBatch(
  rows: Record<string, unknown>[],
  policy: RedactionPolicy,
  pii?: PiiPort,
  orgId?: string,
): Promise<RedactionResult> {
  const base = applyColumnRules(rows, policy);
  const detectCols = policy.filter((r) => r.action === 'detect').map((r) => r.column);
  if (!pii || detectCols.length === 0) return base;

  const report = new Map(base.report.map((e) => [e.column, e]));
  const engines = new Set<string>();
  const reasons = new Set<string>();
  let detectionStatus: NonNullable<RedactionResult['detection']>['status'] = 'applied';
  const acc: DetectionAccumulator = { engines, reasons, report, status: detectionStatus };
  for (const row of base.rows) await scanRow(row, detectCols, pii, orgId, acc);
  detectionStatus = acc.status;
  const reportArr = [...report.values()];
  return {
    rows: base.rows,
    report: reportArr,
    totalRedacted: reportArr.reduce((n, e) => n + e.changed, 0),
    detection: {
      requestedEngine: pii.meta.id,
      engines: [...engines],
      status: detectionStatus,
      reasons: [...reasons],
    },
  };
}

/**
 * The PII detector for the DATA-MOVEMENT redaction path (free-text column `detect`). This is the
 * deterministic regex floor (email/phone + India PAN/Aadhaar/IFSC/UPI) — NOT the content-guardrail
 * engine. ETL redaction must be deterministic and never depend on a remote engine's liveness (a
 * data sync must not fail-closed the way a governed model call does), so it uses the pure floor, not
 * LLM Guard. Content screening on the model-access path is LLM Guard (the sole guardrail engine).
 */
export async function activePiiPort(): Promise<PiiPort> {
  const { getDataRedactionPii } = await import('./adapters/pii');
  return getDataRedactionPii();
}
