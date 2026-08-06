import type { Citation } from '@/lib/copilot-context';

// ─── Which of the gathered records actually bear on the question (PURE, zero-IO) ─────────────────
//
// The copilot gathers the same forty-odd records for every question — recent anomalies, drift,
// evals, cost, audit — and hands the lot to the model. Asked what stops a bad answer reaching a
// customer, it replied "Pipeline data is successfully masked by the service account", stitching
// together records that had nothing to do with each other. That is not the model being stupid; it is
// a small model being handed a pile of unrelated facts and told to answer from them.
//
// WHY THIS AND NOT A BIGGER MODEL. Anything above 2B is too slow on this hardware, so the answer has
// to get better without more parameters. Selecting the records that bear on the question does that
// from both ends: the model has less to be confused by, AND the prompt is shorter, so it answers
// faster. The usual trade — better output for more latency — runs backwards here.
//
// HONESTY. Selecting nothing is a real, useful outcome: the prompt already knows how to say "I don't
// have records about that" and then answer plainly. Returning a weak match instead, so the answer has
// something to cite, is how an off-topic record gets presented to a buyer as evidence.

/** Words carrying no topic signal. Kept short — an over-eager list throws away real terms. */
const STOP = new Set([
  'what', 'which', 'when', 'where', 'does', 'this', 'that', 'they', 'them', 'from', 'with', 'have',
  'has', 'had', 'the', 'and', 'for', 'are', 'was', 'were', 'can', 'could', 'would', 'should', 'our',
  'your', 'you', 'me', 'my', 'a', 'an', 'is', 'it', 'its', 'of', 'to', 'in', 'on', 'at', 'by', 'or',
  'if', 'do', 'did', 'how', 'why', 'who', 'show', 'tell', 'give', 'see', 'look', 'here', 'there',
  'really', 'actually', 'just', 'any', 'all', 'some', 'about', 'into', 'out', 'up', 'down', 'not',
]);

/**
 * Question vocabulary → the record sources that can speak to it.
 *
 * A record's SOURCE is evidence in itself: a cost question is answered by cost records even when the
 * words do not overlap, because a spend row says "$0.35 over 181 requests" and never says "cost".
 * Term overlap alone missed those completely.
 */
const SOURCE_TERMS: Record<Citation['source'], readonly string[]> = {
  finops: ['cost', 'costs', 'costing', 'spend', 'spent', 'price', 'pricing', 'budget', 'money',
    'cheap', 'expensive', 'worth', 'roi', 'return', 'save', 'saving', 'savings', 'bill', 'billing',
    'token', 'tokens', 'requests', 'local', 'hardware'],
  evals: ['quality', 'wrong', 'accurate', 'accuracy', 'hallucinate', 'hallucination', 'made', 'make',
    'invent', 'invented', 'grounded', 'grounding', 'correct', 'incorrect', 'bad', 'answer', 'answers',
    'eval', 'evals', 'test', 'tests', 'pass', 'fail', 'failed', 'score', 'trust', 'reliable'],
  drift: ['drift', 'drifted', 'change', 'changed', 'changing', 'degrade', 'degraded', 'worse',
    'behaviour', 'behavior', 'stable', 'consistent', 'regression'],
  anomaly: ['spike', 'spikes', 'anomaly', 'anomalies', 'unusual', 'sudden', 'jump', 'alert',
    'alerts', 'unexpected', 'slow', 'latency', 'outage'],
  audit: ['who', 'audit', 'log', 'logs', 'trail', 'regulator', 'regulatory', 'compliance', 'access',
    'blocked', 'block', 'stopped', 'stop', 'denied', 'deny', 'refused', 'masked', 'mask', 'redacted',
    'pii', 'pan', 'aadhaar', 'leave', 'leaves', 'left', 'egress', 'private', 'privacy', 'network',
    'run', 'runs', 'ran', 'executed', 'evidence', 'signed', 'signature', 'record', 'records',
    // "Is this really running, or a mock-up?" selected nothing and was answered "I have no records"
    // — the worst possible reply to that particular question. The audit trail IS the evidence that
    // work happened, so the vocabulary of doubt belongs to it.
    'real', 'really', 'live', 'mock', 'mockup', 'fake', 'demo', 'genuine', 'working'],
};

/**
 * Crude suffix stripping, so one affinity entry covers a word's whole family.
 *
 * "Is this really RUNNING" missed an affinity list containing 'run' and 'runs', and the fix is not to
 * type out every inflection of every term forever. Naive on purpose: it only has to make two words
 * that mean the same thing collide, and it is never shown to anyone.
 */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) {
    const base = w.slice(0, -3);
    // "running" → "runn" → "run": undo the doubled consonant English adds before -ing.
    return base.length > 3 && base.at(-1) === base.at(-2) ? base.slice(0, -1) : base;
  }
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

/**
 * Score one record against the question. Zero means "does not bear on it" and the record is dropped.
 *
 * Two signals, deliberately weighted so neither can carry a record on its own without support:
 * matching WORDS is the strong one, and the record's SOURCE matching the subject is a weaker nudge —
 * enough to bring in a cost row for a cost question, not enough to bring in all forty of them.
 */
export function scoreFact(question: string, fact: Citation): number {
  const asked = new Set(terms(question));
  if (asked.size === 0) return 0;
  const inFact = new Set(terms(fact.text));
  let score = 0;
  for (const w of asked) if (inFact.has(w)) score += 2;
  // Stemmed on both sides, or the list's own 'runs' would never meet a stemmed 'run'.
  const affinity = SOURCE_TERMS[fact.source] ?? [];
  if (affinity.some((w) => asked.has(stem(w)))) score += 1;
  return score;
}

/**
 * The records worth showing the model, best first, renumbered 1..k.
 *
 * RENUMBERING IS NOT COSMETIC. The model cites by number; if we drop record 7 and leave the rest
 * numbered 8, 9, 20, the answer's `[n]` markers point at nothing and the citation list under it is
 * wrong. The numbers must be dense and start at 1.
 */
export function selectRelevantFacts(
  question: string,
  facts: readonly Citation[],
  limit = 8,
): Citation[] {
  const scored = facts
    .map((fact, i) => ({ fact, i, score: scoreFact(question, fact) }))
    .filter((s) => s.score > 0)
    // Ties keep the gather order, which is already priority-ordered (anomalies first, audit last).
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit);
  return scored.map((s, idx) => ({ ...s.fact, n: idx + 1 }));
}
