import { randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { evalRuns, goldenCases } from '@/db/schema';
import { searchDocuments } from '@/lib/brain';

// Evals over the Brain — a golden set of {query → expected source} run against retrieval,
// scored as recall (did the expected doc surface in top-k). Decoupled: reads the Brain only
// through searchDocuments(), writes its own run records.
export interface GoldenCase {
  id: string;
  query: string;
  expected: string;
}

export interface EvalResult {
  query: string;
  expected: string;
  pass: boolean;
  top: string;
  score: number;
}

export interface EvalRun {
  id: string;
  score: number;
  total: number;
  passed: number;
  startedAt: string;
  results?: EvalResult[];
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function listGoldenCases(): Promise<GoldenCase[]> {
  const rows = await db.select().from(goldenCases).orderBy(desc(goldenCases.createdAt));
  return rows.map((r) => ({ id: r.id, query: r.query, expected: r.expected }));
}

export async function addGoldenCase(query: string, expected: string): Promise<GoldenCase> {
  const [row] = await db
    .insert(goldenCases)
    .values({ id: `gc_${randomUUID().slice(0, 6)}`, query, expected })
    .returning();
  return { id: row.id, query: row.query, expected: row.expected };
}

export async function deleteGoldenCase(id: string): Promise<void> {
  await db.delete(goldenCases).where(eq(goldenCases.id, id));
}

export async function listEvalRuns(limit = 10): Promise<EvalRun[]> {
  const rows = await db.select().from(evalRuns).orderBy(desc(evalRuns.startedAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    score: r.score,
    total: r.total,
    passed: r.passed,
    startedAt: iso(r.startedAt),
    results: r.results ?? undefined,
  }));
}

async function evalCase(c: GoldenCase): Promise<EvalResult> {
  const hits = await searchDocuments(c.query, 3);
  const exp = c.expected.toLowerCase();
  const pass = hits.some(
    (h) => h.title.toLowerCase().includes(exp) || h.source.toLowerCase().includes(exp),
  );
  return {
    query: c.query,
    expected: c.expected,
    pass,
    top: hits[0]?.title ?? '—',
    score: hits[0]?.score ?? 0,
  };
}

export async function runEval(): Promise<EvalRun> {
  const cases = await listGoldenCases();
  const results: EvalResult[] = [];
  for (const c of cases) {
    results.push(await evalCase(c));
  }
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const score = total ? Math.round((passed / total) * 100) : 0;
  const [row] = await db
    .insert(evalRuns)
    .values({ id: `eval_${randomUUID().slice(0, 6)}`, score, total, passed, results })
    .returning();
  return { id: row.id, score, total, passed, startedAt: iso(row.startedAt), results };
}
