// ─── M4 data governance — the PURE classification model (zero-I/O, unit-testable) ──────────────
//
// Classification is the backbone of deep data governance: every data asset (and optionally each
// column) carries a sensitivity LEVEL and a set of PII entity TAGS. Those two facts drive policy —
// what may leave the org, what must be masked, what a retention/RTBF sweep must touch. This module
// owns the vocabulary + the derivation rules; it never touches the DB (that's data-catalog-store.ts).
//
// SOLID: the rule (what a classification MEANS + what policy it implies) lives here, pure. The store
// persists rows; the UI renders; the routes audit. None of them re-implement these rules.

// Sensitivity levels, ascending. The ORDER is load-bearing — `atLeast`/`maxLevel` compare by rank,
// so a change here changes policy everywhere consistently (DRY).
export const CLASSIFICATION_LEVELS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type ClassificationLevel = (typeof CLASSIFICATION_LEVELS)[number];

// Rank of a level (0 = public … 3 = restricted). Unknown/garbage → 'internal' rank (safe default:
// never treat an unrecognized label as public).
export function levelRank(level: string): number {
  const i = (CLASSIFICATION_LEVELS as readonly string[]).indexOf(level);
  return i >= 0 ? i : CLASSIFICATION_LEVELS.indexOf('internal');
}

// Normalize any input to a valid level; unknown → 'internal' (fail safe, never public).
export function normalizeLevel(level: string | null | undefined): ClassificationLevel {
  const l = (level ?? '').trim().toLowerCase();
  return (CLASSIFICATION_LEVELS as readonly string[]).includes(l)
    ? (l as ClassificationLevel)
    : 'internal';
}

// Is `level` at least as sensitive as `floor`?
export function atLeast(level: string, floor: ClassificationLevel): boolean {
  return levelRank(level) >= levelRank(floor);
}

// The most-sensitive of a set of levels (used to roll a column set up to an asset-level headline).
export function maxLevel(levels: readonly string[]): ClassificationLevel {
  if (levels.length === 0) return 'internal';
  let best: ClassificationLevel = 'public';
  for (const l of levels) {
    const n = normalizeLevel(l);
    if (levelRank(n) > levelRank(best)) best = n;
  }
  return best;
}

// ─── PII tags ────────────────────────────────────────────────────────────────────
// Free-form (a new Presidio recognizer must not need a schema/enum change), but normalized to an
// UPPER_SNAKE canonical form so 'pan', 'PAN', ' Pan ' all mean the same tag. De-duped, order stable.
export function normalizePiiTags(tags: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = (raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// ─── A classification (pure view — maps schema.ts dataClassifications) ─────────────
export interface Classification {
  level: ClassificationLevel;
  piiTags: string[];
  /** null = the asset-level default; else a specific column. */
  column: string | null;
}

// Build/validate a classification from raw input. PURE — never throws; coerces to safe defaults.
export function makeClassification(input: {
  level?: string | null;
  piiTags?: readonly (string | null | undefined)[] | null;
  column?: string | null;
}): Classification {
  return {
    level: normalizeLevel(input.level),
    piiTags: normalizePiiTags(input.piiTags ?? []),
    column: input.column?.trim() ? input.column.trim() : null,
  };
}

// ─── Policy derivation — the whole point ──────────────────────────────────────────
// Given the classifications on an asset (its asset-level default + any per-column rows), derive the
// governance posture: the effective headline level, whether it holds PII, and what the platform must
// do with it. This is what the catalog badge, the masking hint, and the egress guard all read.
export interface AssetPosture {
  /** The most-sensitive level across the asset + all its columns. */
  effectiveLevel: ClassificationLevel;
  /** True if any classification carries a PII tag. */
  hasPii: boolean;
  /** Union of every PII tag across the asset (normalized, de-duped, sorted). */
  piiTags: string[];
  /** Must this asset's values be masked before leaving the org? (confidential+ OR any PII.) */
  requiresMasking: boolean;
  /** May this asset be sent to a cloud/egress gateway at all? (restricted ⇒ no.) */
  egressAllowed: boolean;
  /** Is this asset in scope for a subject-erasure / RTBF sweep? (holds PII.) */
  inRtbfScope: boolean;
}

export function deriveAssetPosture(classifications: readonly Classification[]): AssetPosture {
  const effectiveLevel = maxLevel(classifications.map((c) => c.level));
  const piiTags = normalizePiiTags(classifications.flatMap((c) => c.piiTags)).sort();
  const hasPii = piiTags.length > 0;
  return {
    effectiveLevel,
    hasPii,
    piiTags,
    requiresMasking: hasPii || atLeast(effectiveLevel, 'confidential'),
    egressAllowed: !atLeast(effectiveLevel, 'restricted'),
    inRtbfScope: hasPii,
  };
}
