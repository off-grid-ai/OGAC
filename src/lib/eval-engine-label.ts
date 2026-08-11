import { checkLabel } from '@/lib/quality-plain';

// PURE render-label mapping for eval engines/suites — ZERO imports, ZERO I/O, unit-testable.
//
// The underlying evaluator engine (ragas / deepeval / presidio / guardrails / heuristic / promptfoo)
// is a real, needed internal identifier used for run routing and availability logic. It must NEVER
// be shown to a normal operator as our mechanism (the "never expose the engine" brand rule). This
// maps each internal engine/suite id to an OUTCOME/capability label the UI renders instead. Unknown
// ids fall back to a title-cased version of the id so nothing is ever blank or crashes.

const ENGINE_LABEL: Record<string, string> = {
  ragas: 'Retrieval quality',
  deepeval: 'AI judge',
  presidio: 'PII detection',
  guardrails: 'Content safety',
  heuristic: 'Built-in check',
  evidently: 'Drift & quality',
  golden: 'Golden set',
  promptfoo: 'Scenario suite',
};

// Title-case a raw id (e.g. "my_custom" → "My custom") as a safe, human-ish fallback.
function titleCase(id: string): string {
  const s = id.replace(/[_-]+/g, ' ').trim();
  if (s.length === 0) return 'Check';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The operator-facing label for an internal engine/suite id. Never returns a raw OSS project name.
export function evalEngineLabel(engine: string | null | undefined): string {
  if (!engine) return 'Check';
  const key = engine.toLowerCase();
  const known = ENGINE_LABEL[key];
  if (known) return known;

  // COMPOUND ids. Values arrive both bare ('ragas') and as '<metric>:<engine>'
  // ('answer_relevancy:ragas', 'faithfulness:ragas'). Only the bare form was in the lookup, so a
  // compound one fell through to titleCase of the WHOLE string and rendered "Answer relevancy:ragas"
  // on the quality surfaces — naming the OSS evaluator to a customer, which is precisely what this
  // mapper exists to prevent.
  //
  // The metric is the part a business reader wants; the library that computed it is not. checkLabel
  // in quality-plain.ts already makes exactly that split and carries the plain-English vocabulary for
  // each metric, so this delegates rather than growing a third mapper — the warning at the top of
  // lineage-labels.ts is about how easily that happens here.
  if (key.includes(':')) return checkLabel(engine);
  return titleCase(engine);
}
