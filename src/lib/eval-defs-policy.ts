// PURE eval-definition validation/normalization — ZERO imports beyond the template catalog types,
// ZERO I/O, unit-testable in isolation. An "eval definition" is a first-class, named, saved
// evaluator the operator manages: {name, templateId, metric, engine, direction, threshold, goldenSet}.
// It is what a template becomes when APPLIED, and what the operator edits/deletes/runs. The store
// (eval-defs.ts) calls these to validate a create/update payload before touching the DB.

import { getTemplate, type EvalEngine, type MetricDirection } from '@/lib/eval-templates';

export interface EvalDefInput {
  name?: unknown;
  templateId?: unknown;
  metric?: unknown;
  engine?: unknown;
  direction?: unknown;
  threshold?: unknown; // 0..1
  suite?: unknown; // golden set this eval runs against
  description?: unknown;
}

export interface EvalDefDraft {
  name: string;
  templateId: string; // '' when authored from scratch (no backing template)
  metric: string;
  engine: EvalEngine;
  direction: MetricDirection;
  threshold: number; // 0..1
  suite: string;
  description: string;
}

export type EvalDefValidation = { ok: true; value: EvalDefDraft } | { ok: false; error: string };

const ENGINES = new Set<EvalEngine>([
  'ragas',
  'evidently',
  'guardrails',
  'presidio',
  'deepeval',
  'heuristic',
]);
const DIRECTIONS = new Set<MetricDirection>(['higher-better', 'lower-better']);

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The first of these that has content once trimmed, else ''. Collapses `a || b || ''` chains. */
function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    const t = trimStr(v);
    if (t) return t;
  }
  return '';
}

function num01(v: unknown): number | null {
  let n = Number.NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim()) n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

// Validate + normalize an eval-definition payload. When a known templateId is supplied, its
// metric/engine/direction/threshold seed any omitted fields (so "apply template" needs only a name).
// Standalone defs must supply metric + a valid engine + direction. Never throws.
/** Either a resolved field value, or the reason the caller must reject the whole draft. */
type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A field whose value must be one of a fixed set, resolved as: explicit input → template default.
 * PURE. Reports the offending value (or "(none)") so the operator is told WHICH engine/direction was
 * rejected rather than just that something was.
 */
function pickEnum<T extends string>(
  raw: string,
  fromTemplate: string | undefined,
  allowed: ReadonlySet<string>,
  label: string,
): Resolved<T> {
  const value = firstNonEmpty(raw, fromTemplate);
  return allowed.has(value)
    ? { ok: true, value: value as T }
    : { ok: false, error: `invalid ${label}: ${value || '(none)'}` };
}

/**
 * The pass mark for this eval. PURE.
 *
 * An OMITTED threshold inherits the template's default (or 0.7); a SUPPLIED one must be a real 0–1
 * number. The distinction matters: "" and null mean "use the default", while "abc" means the operator
 * typed something wrong and must be told, rather than silently getting 0.7.
 */
function resolveThreshold(raw: unknown, templateDefault: number | undefined): Resolved<number> {
  const omitted =
    raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  if (omitted) return { ok: true, value: templateDefault ?? 0.7 };
  const parsed = num01(raw);
  return parsed === null
    ? { ok: false, error: 'threshold must be a number between 0 and 1' }
    : { ok: true, value: parsed };
}

interface EvalIdentity {
  name: string;
  templateId: string;
  tpl: ReturnType<typeof getTemplate>;
  metric: string;
}

/**
 * What this eval IS: its name, the template it derives from, and the metric it scores. PURE.
 *
 * A named-but-unknown template is an error rather than a silent fallback to "no template": the
 * operator asked for defaults that do not exist, and quietly inventing different ones would produce
 * an eval that scores something other than what they chose.
 */
function resolveIdentity(src: EvalDefInput): Resolved<EvalIdentity> {
  const name = trimStr(src.name);
  if (!name) return { ok: false, error: 'name is required' };

  const templateId = trimStr(src.templateId);
  const tpl = templateId ? getTemplate(templateId) : undefined;
  if (templateId && !tpl) return { ok: false, error: `unknown template: ${templateId}` };

  const metric = firstNonEmpty(src.metric, tpl?.metric);
  if (!metric) return { ok: false, error: 'metric is required' };

  return { ok: true, value: { name, templateId, tpl, metric } };
}

export function validateEvalDef(input: EvalDefInput | null | undefined): EvalDefValidation {
  const src = input ?? {};
  const identity = resolveIdentity(src);
  if (!identity.ok) return identity;
  const { name, templateId, tpl, metric } = identity.value;
  // Destructure the template's defaults once; four separate `tpl?.x` reads say the same thing.
  const {
    engine: tplEngine,
    direction: tplDir,
    defaultThreshold,
    description: tplDesc,
  } = tpl ?? {};

  const engine = pickEnum<EvalEngine>(
    trimStr(src.engine).toLowerCase(),
    tplEngine,
    ENGINES,
    'engine',
  );
  if (!engine.ok) return engine;

  const direction = pickEnum<MetricDirection>(
    trimStr(src.direction),
    tplDir,
    DIRECTIONS,
    'direction',
  );
  if (!direction.ok) return direction;

  const threshold = resolveThreshold(src.threshold, defaultThreshold);
  if (!threshold.ok) return threshold;

  return {
    ok: true,
    value: {
      name,
      templateId,
      metric,
      engine: engine.value,
      direction: direction.value,
      threshold: threshold.value,
      suite: firstNonEmpty(src.suite, 'golden'),
      description: firstNonEmpty(src.description, tplDesc),
    },
  };
}
