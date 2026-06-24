import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { listGoldenCases, runEval } from '@/lib/evals';
import type { EvalRunResult, EvalsPort } from './types';

// Evals adapters. The golden set (recall over the Brain) is the always-on first-party default and
// runs fully in-process. promptfoo and Ragas/DeepEval are real swap-ins that invoke their tool /
// sidecar against OUR gateway; each falls back to golden if its tool is unavailable, so selecting
// one is never a hard dependency.
const execFileAsync = promisify(execFile);
const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';
const EVAL_MODEL = process.env.OFFGRID_EVAL_MODEL ?? 'gemma-local';
const RAGAS_URL = process.env.OFFGRID_RAGAS_URL;
const PROMPTFOO_BIN = process.env.OFFGRID_PROMPTFOO_BIN ?? 'promptfoo';

function iso(): string {
  return new Date().toISOString();
}

// ── golden (default) ────────────────────────────────────────────────────────
export const goldenEvals: EvalsPort = {
  meta: {
    id: 'golden',
    capability: 'evals',
    vendor: 'Off Grid golden set',
    license: 'first-party',
    render: 'native',
    description: 'Recall-scored golden query→expected-doc set over the Brain (always on).',
  },
  async run() {
    const r = await runEval();
    return {
      id: r.id,
      engine: 'golden',
      score: r.score,
      total: r.total,
      passed: r.passed,
      startedAt: r.startedAt,
      detail: { results: r.results },
    };
  },
  health: () => Promise.resolve(true),
};

// ── promptfoo (assertion matrix via its CLI, against our gateway) ─────────────
interface PromptfooSummary {
  results?: { stats?: { successes?: number; failures?: number } };
}

function promptfooConfig(cases: { query: string; expected: string }[]): unknown {
  return {
    description: 'Off Grid console golden set',
    providers: [
      {
        id: `openai:chat:${EVAL_MODEL}`,
        config: { apiBaseUrl: `${GATEWAY_URL}/v1`, apiKey: 'offgrid-local' },
      },
    ],
    prompts: ['{{query}}'],
    tests: cases.map((c) => ({
      vars: { query: c.query },
      assert: [{ type: 'icontains', value: c.expected }],
    })),
  };
}

async function runPromptfoo(): Promise<EvalRunResult> {
  const cases = await listGoldenCases();
  const dir = await mkdtemp(join(tmpdir(), 'offgrid-pf-'));
  const cfg = join(dir, 'promptfooconfig.json');
  const out = join(dir, 'out.json');
  try {
    await writeFile(cfg, JSON.stringify(promptfooConfig(cases)));
    await execFileAsync(PROMPTFOO_BIN, ['eval', '-c', cfg, '-o', out, '--no-progress-bar'], {
      timeout: 120_000,
    });
    const summary = JSON.parse(await readFile(out, 'utf8')) as PromptfooSummary;
    const passed = summary.results?.stats?.successes ?? 0;
    const failed = summary.results?.stats?.failures ?? 0;
    const total = passed + failed;
    return {
      id: `pf_${Date.now().toString(36)}`,
      engine: 'promptfoo',
      score: total ? Math.round((passed / total) * 100) : 0,
      total,
      passed,
      startedAt: iso(),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export const promptfooEvals: EvalsPort = {
  meta: {
    id: 'promptfoo',
    capability: 'evals',
    vendor: 'promptfoo',
    license: 'MIT',
    render: 'headless',
    description: 'Assertion-matrix evals across providers (Node CLI), run against the gateway.',
  },
  async run() {
    try {
      return await runPromptfoo();
    } catch {
      return goldenEvals.run(); // promptfoo not installed / failed — never a hard dependency
    }
  },
  async health() {
    try {
      await execFileAsync(PROMPTFOO_BIN, ['--version'], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  },
};

// ── Ragas / DeepEval (RAG metrics via a Python sidecar) ───────────────────────
interface RagasResponse {
  passed?: number;
  total?: number;
  metrics?: Record<string, number>;
}

async function runRagas(): Promise<EvalRunResult> {
  const cases = await listGoldenCases();
  const res = await fetch(`${RAGAS_URL}/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EVAL_MODEL, gateway: `${GATEWAY_URL}/v1`, cases }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error('ragas sidecar error');
  const data = (await res.json()) as RagasResponse;
  const total = data.total ?? cases.length;
  const passed = data.passed ?? 0;
  const faithfulness = data.metrics?.faithfulness;
  return {
    id: `ragas_${Date.now().toString(36)}`,
    engine: 'ragas',
    score:
      faithfulness !== undefined
        ? Math.round(faithfulness * 100)
        : total
          ? Math.round((passed / total) * 100)
          : 0,
    total,
    passed,
    startedAt: iso(),
    detail: { metrics: data.metrics },
  };
}

export const ragasEvals: EvalsPort = {
  meta: {
    id: 'ragas',
    capability: 'evals',
    vendor: 'Ragas + DeepEval',
    license: 'Apache-2.0',
    render: 'headless',
    embedUrl: RAGAS_URL,
    description: 'RAG metrics — faithfulness, context precision/recall, answer relevancy (sidecar).',
  },
  async run() {
    if (!RAGAS_URL) return goldenEvals.run();
    try {
      return await runRagas();
    } catch {
      return goldenEvals.run();
    }
  },
  async health() {
    if (!RAGAS_URL) return false;
    try {
      const res = await fetch(`${RAGAS_URL}/health`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

export const EVALS_PORTS: EvalsPort[] = [goldenEvals, promptfooEvals, ragasEvals];
