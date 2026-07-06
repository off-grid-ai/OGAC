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

export type EvalDefValidation =
  | { ok: true; value: EvalDefDraft }
  | { ok: false; error: string };

const ENGINES: readonly EvalEngine[] = ['ragas', 'evidently', 'guardrails', 'presidio', 'heuristic'];
const DIRECTIONS: readonly MetricDirection[] = ['higher-better', 'lower-better'];

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num01(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

// Validate + normalize an eval-definition payload. When a known templateId is supplied, its
// metric/engine/direction/threshold seed any omitted fields (so "apply template" needs only a name).
// Standalone defs must supply metric + a valid engine + direction. Never throws.
export function validateEvalDef(input: EvalDefInput | null | undefined): EvalDefValidation {
  const src = input ?? {};
  const name = trimStr(src.name);
  if (!name) return { ok: false, error: 'name is required' };

  const templateId = trimStr(src.templateId);
  const tpl = templateId ? getTemplate(templateId) : undefined;
  if (templateId && !tpl) return { ok: false, error: `unknown template: ${templateId}` };

  const metric = trimStr(src.metric) || tpl?.metric || '';
  if (!metric) return { ok: false, error: 'metric is required' };

  const engineRaw = trimStr(src.engine).toLowerCase() || tpl?.engine || '';
  if (!ENGINES.includes(engineRaw as EvalEngine)) {
    return { ok: false, error: `invalid engine: ${engineRaw || '(none)'}` };
  }
  const engine = engineRaw as EvalEngine;

  const dirRaw = trimStr(src.direction) || tpl?.direction || '';
  if (!DIRECTIONS.includes(dirRaw as MetricDirection)) {
    return { ok: false, error: `invalid direction: ${dirRaw || '(none)'}` };
  }
  const direction = dirRaw as MetricDirection;

  const threshold =
    src.threshold === undefined || src.threshold === null || trimStr(src.threshold) === ''
      ? (tpl?.defaultThreshold ?? 0.7)
      : num01(src.threshold);
  if (threshold === null) return { ok: false, error: 'threshold must be a number between 0 and 1' };

  const suite = trimStr(src.suite) || 'golden';
  const description = trimStr(src.description) || tpl?.description || '';

  return {
    ok: true,
    value: { name, templateId, metric, engine, direction, threshold, suite, description },
  };
}
