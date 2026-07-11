import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { searchDocuments } from '@/lib/brain';
import { listGoldenCases, runEval } from '@/lib/evals';

// Evals adapters. The golden set (recall over the Brain) is the always-on first-party default and
// runs fully in-process. promptfoo and Ragas/DeepEval are real swap-ins that invoke their tool /
// sidecar against OUR gateway; each falls back to golden if its tool is unavailable, so selecting
// one is never a hard dependency.
const execFileAsync = promisify(execFile);
import { GATEWAY_URL, gatewayHeadersAsync } from '@/lib/gateway';
import { getServiceCredential } from '@/lib/service-credentials';
import { chooseGatewayAuth, type ServiceCredential } from '@/lib/service-credentials-lib';
import type { EvalRunResult, EvalsPort } from './types';
const EVAL_MODEL = process.env.OFFGRID_EVAL_MODEL ?? 'gemma-local';
const RAGAS_URL = process.env.OFFGRID_RAGAS_URL;
const PROMPTFOO_BIN = process.env.OFFGRID_PROMPTFOO_BIN ?? 'promptfoo';
const GATEWAY_API_KEY = process.env.OFFGRID_GATEWAY_API_KEY ?? '';

// promptfoo's provider config REQUIRES a non-empty `apiKey` field to be valid, even when the
// gateway is unauthenticated (a local dev box). When neither a broker JWT nor a legacy static key
// is provisioned we therefore need SOME placeholder string — but it must not be a hard-coded key
// baked into source (gap #30). Source it from env (`OFFGRID_EVAL_GATEWAY_API_KEY`, falling back to
// `OFFGRID_GATEWAY_API_KEY`), and only if BOTH are unset use a self-describing, obviously-inert
// literal that is NOT a real credential and carries no auth header — so an unconfigured eval never
// fabricates a call with a bogus real-looking key; it degrades honestly. Operators who want the
// promptfoo path to actually authenticate set one of the env vars (see SERVER_STATE).
const EVAL_GATEWAY_PLACEHOLDER =
  process.env.OFFGRID_EVAL_GATEWAY_API_KEY ?? process.env.OFFGRID_GATEWAY_API_KEY ?? 'unauthenticated-local-gateway';

function iso(): string {
  return new Date().toISOString();
}

// ── Gateway auth for the promptfoo sidecar (PURE, unit-tested) ────────────────────────────────────
// promptfoo's OpenAI-compatible provider takes `apiKey` (sent as `Authorization: Bearer <apiKey>`) and
// optional custom `headers`. The aggregator accepts EITHER a Keycloak Bearer JWT OR the legacy static
// key as `x-api-key`. So we drive the SAME shared auth-selection rule the gateway helper uses
// (`chooseGatewayAuth`): a broker Bearer JWT → pass it as promptfoo's apiKey (→ Bearer, which the
// aggregator accepts); else the legacy static key → send it verbatim as an `x-api-key` header (what the
// aggregator wants); else no auth — byte-identical to the pre-broker `apiKey:'offgrid-local'` behavior
// for an unprovisioned local gateway. `providerAuthFromHeaders` is the pure translation of the shared
// header rule into promptfoo's provider-config shape, so it's unit-tested with no I/O.
export interface PromptfooProviderAuth {
  apiKey: string;
  headers?: Record<string, string>;
}

export function providerAuthFromHeaders(
  headers: Record<string, string>,
  // The placeholder used ONLY when neither a broker JWT nor a legacy static key is present — a
  // config-time env value (never a hard-coded credential), injected so this function stays pure.
  unauthenticatedPlaceholder: string,
): PromptfooProviderAuth {
  const bearer = headers.authorization;
  if (bearer?.startsWith('Bearer ')) return { apiKey: bearer.slice('Bearer '.length) };
  if (headers['x-api-key']) return { apiKey: 'x-api-key', headers: { 'x-api-key': headers['x-api-key'] } };
  // No broker cred and no legacy key: keep promptfoo's config valid with a placeholder key and send
  // NO auth header — degrading honestly against an unauthenticated local gateway (the placeholder is
  // env-sourced, not a baked-in key). If the gateway is actually authed, this scan simply won't pass
  // auth — it does not fabricate a real-looking credential.
  return { apiKey: unauthenticatedPlaceholder };
}

/** Resolve promptfoo's provider auth from the SAME shared rule (`chooseGatewayAuth`) as the gateway. */
export function selectPromptfooAuth(
  cred: ServiceCredential,
  legacyApiKey: string | undefined,
  unauthenticatedPlaceholder: string = EVAL_GATEWAY_PLACEHOLDER,
): PromptfooProviderAuth {
  return providerAuthFromHeaders(chooseGatewayAuth(cred, legacyApiKey), unauthenticatedPlaceholder);
}

// ── golden (default) ────────────────────────────────────────────────────────
export const goldenEvals: EvalsPort = {
  meta: {
    id: 'golden',
    capability: 'evals',
    vendor: 'Off Grid AI golden set',
    license: 'first-party',
    render: 'native',
    description: 'Recall-scored golden query→expected-doc set over the Brain (always on).',
  },
  async run(orgId?: string) {
    const r = await runEval(orgId);
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

function promptfooConfig(
  cases: { query: string; expected: string }[],
  auth: PromptfooProviderAuth,
): unknown {
  return {
    description: 'Off Grid AI console golden set',
    providers: [
      {
        id: `openai:chat:${EVAL_MODEL}`,
        config: {
          apiBaseUrl: `${GATEWAY_URL}/v1`,
          apiKey: auth.apiKey,
          ...(auth.headers ? { headers: auth.headers } : {}),
        },
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
  // Authenticate to the gateway through the service-credential broker (bearer JWT preferred, legacy
  // static key fallback) — same seam as every other adapter, no hard-coded key.
  const auth = selectPromptfooAuth(
    await getServiceCredential('gateway'),
    GATEWAY_API_KEY || undefined,
  );
  const dir = await mkdtemp(join(tmpdir(), 'offgrid-pf-'));
  const cfg = join(dir, 'promptfooconfig.json');
  const out = join(dir, 'out.json');
  try {
    await writeFile(cfg, JSON.stringify(promptfooConfig(cases, auth)));
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
  async run(orgId?: string) {
    try {
      return await runPromptfoo();
    } catch {
      return goldenEvals.run(orgId); // promptfoo not installed / failed — never a hard dependency
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

interface RagasSample {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth: string;
}

// Generate an answer for one query, grounded in the retrieved contexts, through the gateway.
async function generateAnswer(question: string, contexts: string[]): Promise<string> {
  const ctx = contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n');
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: await gatewayHeadersAsync({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: EVAL_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Answer only from the provided context. Be concise.' },
        { role: 'user', content: `CONTEXT:\n${ctx}\n\nQUESTION: ${question}` },
      ],
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error('gateway answer generation failed');
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

// Build the RAG eval dataset the console owns (Brain for contexts, gateway for answers, the golden
// `expected` as ground truth), then let the sidecar score it with Ragas.
async function buildDataset(): Promise<RagasSample[]> {
  const cases = await listGoldenCases();
  const samples: RagasSample[] = [];
  for (const c of cases) {
    const hits = await searchDocuments(c.query, 3);
    const contexts = hits.map((h) => h.text);
    samples.push({
      question: c.query,
      answer: await generateAnswer(c.query, contexts),
      contexts,
      ground_truth: c.expected,
    });
  }
  return samples;
}

async function runRagas(): Promise<EvalRunResult> {
  const dataset = await buildDataset();
  const res = await fetch(`${RAGAS_URL}/evaluate`, {
    method: 'POST',
    headers: await gatewayHeadersAsync({ 'content-type': 'application/json' }),
    body: JSON.stringify({ model: EVAL_MODEL, gateway: `${GATEWAY_URL}/v1`, dataset }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error('ragas sidecar error');
  const data = (await res.json()) as RagasResponse;
  const total = data.total ?? dataset.length;
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
    description:
      'RAG metrics — faithfulness, answer relevancy, context recall. Runs the bundled Ragas sidecar (compose `qa` profile) with the gateway as judge + embeddings; falls back to golden.',
  },
  async run(orgId?: string) {
    if (!RAGAS_URL) return goldenEvals.run(orgId);
    try {
      return await runRagas();
    } catch {
      return goldenEvals.run(orgId);
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
