import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server } from 'node:http';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the PUBLIC per-pipeline invocation path (PA-11): auth → govern → EXECUTE.
//
// It exercises the EXACT seams the route handler (POST /api/v1/pipeline/<id>/run) chains, against a
// REAL Postgres (a published pipeline + a minted key at dedicated test ids) and a STUB HTTP gateway
// (a tiny local server answering /v1/chat/completions). We drive the seams directly rather than
// importing the Next route module (which pulls `next/server`, unresolvable under `node --test`); the
// orchestration below mirrors the handler line-for-line, so it proves the real end-to-end behaviour:
//   verifyPipelineKey (valid / invalid / cross-pipeline / revoked) → getPipeline (published gate) →
//   resolveContract + enforceModelCall (governed decision) → executePipelineRun via the REAL
//   defaultExecuteDeps (which calls the stub gateway) → the model's real answer.
// The only "mock" is the upstream model server (there's no LLM in CI). Skips green when no DB is up.

const ORG = 'test-int-plrun';

const dbUp = await dbReachable();

let gateway: Server;
let gatewayReceived: { model: string; content: string } | null = null;

before(async () => {
  gateway = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        const content = body?.messages?.[body.messages.length - 1]?.content ?? '';
        gatewayReceived = { model: body.model, content };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: `ECHO[${body.model}]: ${content}` } }],
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const port = (gateway.address() as { port: number }).port;
  // gateway.ts reads OFFGRID_GATEWAY_URL at module-eval; set it BEFORE the first import below.
  process.env.OFFGRID_GATEWAY_URL = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});

// The route's orchestration, reproduced verbatim over the real seams (auth → publish gate → govern →
// EXECUTE). Returns a {status, body} pair shaped exactly like the route's NextResponse.json so the
// assertions read like HTTP responses. Only the thin Next wrapper is omitted (it pulls `next/server`,
// unresolvable under `node --test`); every governed seam below is the real production one.
async function runGoverned(
  id: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { getPipeline } = await import('@/lib/pipelines');
  const { verifyPipelineKey } = await import('@/lib/pipeline-api-keys');
  const { resolveContract } = await import('@/lib/pipeline-contract');
  const { enforceModelCall } = await import('@/lib/pipeline-enforcement');
  const { deriveEgress } = await import('@/lib/pipelines-policy');
  const { executePipelineRun } = await import('@/lib/pipeline-execute');
  const { defaultExecuteDeps } = await import('@/lib/pipeline-execute-wiring');

  const runId = 'plrun_test1234';

  // 1. key-auth (SHA-256 hash lookup — shape alone never authenticates).
  const binding = await verifyPipelineKey(apiKey);
  if (!binding) return { status: 401, body: { error: 'unauthorized' } };
  if (binding.pipelineId !== id) return { status: 403, body: { error: 'key is not valid for this pipeline' } };

  // 2. load + publish gate.
  const pipeline = await getPipeline(id, binding.orgId);
  if (!pipeline) return { status: 404, body: { error: 'unknown pipeline' } };
  if (pipeline.status !== 'published') return { status: 409, body: { error: 'pipeline is not published' } };

  // 3. governed decision.
  const dataClass = typeof body.data_class === 'string' ? body.data_class : 'general';

  const contract = await resolveContract(id, binding.orgId);
  const verdict = enforceModelCall(contract, dataClass);
  const leashModel = deriveEgress(pipeline.routing, dataClass).model;
  if (!verdict.allow) {
    return { status: 403, body: { outcome: 'blocked', reason: verdict.reason, egress: verdict.egress } };
  }
  const deps = defaultExecuteDeps(id, binding.orgId, runId);
  const result = await executePipelineRun(
    runId,
    { id: pipeline.id, version: pipeline.version, defaultModel: pipeline.defaultModel ?? null, gateway: null },
    verdict,
    leashModel,
    body,
    binding.orgId,
    `pipeline-key:${binding.keyId}`,
    deps,
  );
  if (result.status === 'blocked') return { status: 403, body: { outcome: 'blocked', reason: result.reason } };
  if (result.status === 'error') return { status: 502, body: { outcome: 'error', reason: result.reason } };
  return {
    status: 200,
    body: { outcome: 'ok', output: result.output, model: result.model, usage: result.usage, runId: result.runId, masked: result.masked },
  };
}

test(
  'public pipeline run: auth → govern → EXECUTE end-to-end + honest failure modes',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { db } = await import('@/db');
    const { pipelines, pipelineApiKeys } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { createPipeline, publishPipeline, deletePipeline } = await import('@/lib/pipelines');
    const { mintKey } = await import('@/lib/pipeline-api-keys');

    const PIPELINE = 'pl_testintplrun01';
    const PIPELINE_B = 'pl_testintplrun02';

    t.after(async () => {
      await db.delete(pipelineApiKeys).where(eq(pipelineApiKeys.orgId, ORG));
      await deletePipeline(PIPELINE, ORG).catch(() => {});
      await deletePipeline(PIPELINE_B, ORG).catch(() => {});
      await db.delete(pipelines).where(eq(pipelines.id, PIPELINE));
      await db.delete(pipelines).where(eq(pipelines.id, PIPELINE_B));
    });

    await createPipeline(
      { id: PIPELINE, name: 'Run test', defaultModel: 'gemma-local', routing: { egressAllowed: true } },
      'admin',
      ORG,
    );
    await createPipeline({ id: PIPELINE_B, name: 'Other', defaultModel: 'gemma-local' }, 'admin', ORG);

    const minted = await mintKey(PIPELINE, 'partner', ORG, 'admin');
    const mintedB = await mintKey(PIPELINE_B, 'partner-b', ORG, 'admin');

    // AUTH: no key → 401
    assert.equal((await runGoverned(PIPELINE, '', { input: 'hi' })).status, 401);
    // AUTH: garbage key → 401
    assert.equal((await runGoverned(PIPELINE, 'og_pl_not_a_real_key', { input: 'hi' })).status, 401);
    // AUTH: a key for pipeline B cannot drive pipeline A → 403
    assert.equal((await runGoverned(PIPELINE, mintedB.apiKey, { input: 'hi' })).status, 403);
    // PUBLISH gate: valid key, unpublished pipeline → 409
    assert.equal((await runGoverned(PIPELINE, minted.apiKey, { input: 'hi' })).status, 409);

    // Publish → callable.
    await publishPipeline(PIPELINE, ORG, 'admin');

    // EXECUTE: the real gateway answer is returned.
    gatewayReceived = null;
    const ok = await runGoverned(PIPELINE, minted.apiKey, { input: 'why is the sky blue' });
    assert.equal(ok.status, 200, 'a governed, published call executes → 200');
    assert.equal(ok.body.outcome, 'ok');
    assert.equal(ok.body.output, 'ECHO[gemma-local]: why is the sky blue', 'the REAL gateway answer is returned');
    assert.equal(ok.body.model, 'gemma-local');
    assert.equal((ok.body.usage as { total: number }).total, 10, 'gateway usage flows through');
    assert.match(String(ok.body.runId), /^plrun_/);
    assert.ok(gatewayReceived, 'the model was actually called');
    assert.equal(gatewayReceived!.content, 'why is the sky blue');

    // MISSING prompt on a published pipeline → blocked (never a fabricated model call).
    const noPrompt = await runGoverned(PIPELINE, minted.apiKey, {});
    assert.equal(noPrompt.status, 403);
    assert.equal(noPrompt.body.outcome, 'blocked');

    // REVOKE: a revoked key fails auth immediately → 401.
    await db.update(pipelineApiKeys).set({ revokedAt: new Date() }).where(eq(pipelineApiKeys.id, minted.view.id));
    assert.equal((await runGoverned(PIPELINE, minted.apiKey, { input: 'hi' })).status, 401);
  },
);

test(
  'public pipeline run: an egress-blocked data-class is refused (403) BEFORE the model is called',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { db } = await import('@/db');
    const { pipelines, pipelineApiKeys } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { createPipeline, publishPipeline, deletePipeline } = await import('@/lib/pipelines');
    const { mintKey } = await import('@/lib/pipeline-api-keys');

    const ID = 'pl_testintplrunblock';
    t.after(async () => {
      await db.delete(pipelineApiKeys).where(eq(pipelineApiKeys.pipelineId, ID));
      await deletePipeline(ID, ORG).catch(() => {});
      await db.delete(pipelines).where(eq(pipelines.id, ID));
    });

    // egress OFF + a rule that would route data_class 'pii' to cloud ⇒ the master leash demotes it to
    // BLOCK, so the request is refused before the model is called.
    await createPipeline(
      {
        id: ID,
        name: 'Locked',
        defaultModel: 'gemma-local',
        routing: {
          egressAllowed: false,
          rules: [
            { name: 'pii-cloud', priority: 10, attribute: 'data_class', operator: 'eq', value: 'pii', action: 'cloud', model: '', fallback: '', enabled: true },
          ],
        },
      },
      'admin',
      ORG,
    );
    await publishPipeline(ID, ORG, 'admin');
    const key = await mintKey(ID, 'partner', ORG, 'admin');

    gatewayReceived = null;
    const res = await runGoverned(ID, key.apiKey, { input: 'my pan is ABCDE1234F', data_class: 'pii' });
    assert.equal(res.status, 403, 'egress-blocked data-class → 403');
    assert.equal(res.body.outcome, 'blocked');
    assert.match(String(res.body.reason), /block/i);
    assert.equal(gatewayReceived, null, 'the model was NEVER called on a blocked verdict');
  },
);
