import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// M1-a async publish-gate INTEGRATION tests against a REAL Postgres, no mocks. Exercises:
//   • the publish_jobs store: create (gating) → resolve (published|blocked), and the idempotent
//     guard (a terminal job is never re-resolved);
//   • countGatingEvals: 0 for a fresh pipeline, ≥1 once an eval is attached (drives sync vs async);
//   • startPublishGate + resolveGatingJob end-to-end: a pipeline with a (fast heuristic) eval goes
//     gating → a real terminal state, and the job's decision matches the pipeline's live status;
//   • the ungated case: countGatingEvals === 0 ⇒ publishWithGate publishes instantly (unchanged).
// Skips (green) when no DB is up. Tracks + deletes only the ids it creates.

const dbUp = await dbReachable();

test('publish_jobs store — create → resolve, idempotent terminal guard (real Postgres)', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const { createPublishJob, getPublishJob, resolvePublishJob, listPublishJobs, deletePublishJob } =
    await import('@/lib/publish-jobs-store');
  const { evaluateReleaseGate } = await import('@/lib/release-gate');

  const orgId = `org-pj-${Date.now()}`;
  const pipelineId = `pl-${Date.now()}`;

  const job = await createPublishJob({ pipelineId, orgId, override: false, by: 'tester' });
  t.after(async () => {
    await deletePublishJob(job.jobId, orgId).catch(() => {});
  });
  assert.equal(job.status, 'gating');
  assert.equal(job.decision, null);
  assert.equal(job.pipelineId, pipelineId);

  // Latest-job lookup finds it.
  const listed = await listPublishJobs(pipelineId, orgId);
  assert.equal(listed[0]?.jobId, job.jobId);

  // Resolve → blocked with a decision payload.
  const failDecision = evaluateReleaseGate(
    [{ id: 'e1', name: 'faithfulness', threshold: 1 }],
    [{ evalId: 'e1', name: 'faithfulness', score: 0, scored: true, thresholdPct: 100 }],
  );
  const resolved = await resolvePublishJob(job.jobId, 'blocked', {
    decision: failDecision,
    overridden: false,
  }, orgId);
  assert.equal(resolved?.status, 'blocked');
  assert.equal(resolved?.decision?.decision.pass, false);

  // Idempotent: a second resolve to a DIFFERENT terminal state is a no-op (stays blocked).
  const again = await resolvePublishJob(job.jobId, 'published', {
    decision: evaluateReleaseGate([], []),
    overridden: false,
  }, orgId);
  assert.equal(again?.status, 'blocked', 'a terminal job is frozen — no double-resolve');

  const readBack = await getPublishJob(job.jobId, orgId);
  assert.equal(readBack?.status, 'blocked');
});

test('ungated pipeline — countGatingEvals 0 ⇒ instant sync publish (real Postgres)', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const { createPipeline, getPipeline, deletePipeline } = await import('@/lib/pipelines');
  const { countGatingEvals, publishWithGate } = await import('@/lib/pipeline-release');

  const orgId = `org-ung-${Date.now()}`;
  const p = await createPipeline({ name: `ungated ${Date.now()}` }, 'tester', orgId);
  t.after(async () => {
    await deletePipeline(p.id, orgId).catch(() => {});
  });

  assert.equal(await countGatingEvals(p.id), 0, 'no evals attached');
  const res = await publishWithGate(p.id, { orgId, by: 'tester@offgrid.local' });
  assert.equal(res?.decision.gated, false, 'ungated');
  assert.equal(res?.blocked, false);
  const after = await getPipeline(p.id, orgId);
  assert.equal(after?.status, 'published', 'ungated publishes instantly');
});

test('gated pipeline — async start → background resolve reaches a terminal state (real Postgres)', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const { createPipeline, getPipeline, deletePipeline } = await import('@/lib/pipelines');
  const { countGatingEvals, startPublishGate, resolveGatingJob } = await import(
    '@/lib/pipeline-release'
  );
  const { getPublishJob, deletePublishJob } = await import('@/lib/publish-jobs-store');
  const { addEvalDef, deleteEvalDef } = await import('@/lib/eval-defs');
  const { addGoldenCase, deleteGoldenCase } = await import('@/lib/evals');

  const orgId = `org-gat-${Date.now()}`;
  const p = await createPipeline({ name: `gated ${Date.now()}` }, 'tester', orgId);
  // faithfulness @ threshold 1.0 — an ungrounded answer scores 0 when the heuristic scores at all.
  const ev = await addEvalDef(
    {
      name: 'impossible-faithfulness',
      templateId: '',
      metric: 'faithfulness',
      engine: 'heuristic',
      direction: 'higher-better',
      threshold: 1,
      suite: 'golden',
      description: '',
    },
    'tester',
    { pipelineId: p.id },
  );
  const gc = await addGoldenCase(
    { name: 'q', query: 'what is the settlement window?', expected: 'seven days', suite: 'golden' },
    { pipelineId: p.id },
  );

  let jobId: string | null = null;
  t.after(async () => {
    if (jobId) await deletePublishJob(jobId, orgId).catch(() => {});
    await deleteGoldenCase(gc.id).catch(() => {});
    await deleteEvalDef(ev.id).catch(() => {});
    await deletePipeline(p.id, orgId).catch(() => {});
  });

  // With an eval attached the route takes the ASYNC path.
  assert.ok((await countGatingEvals(p.id)) >= 1, 'has a gating eval');

  const started = await startPublishGate(p.id, { orgId, by: 'tester@offgrid.local' });
  assert.notEqual(started, null);
  jobId = started!.job.jobId;
  assert.equal(started!.job.status, 'gating', 'returns a gating job immediately');

  // The pipeline is NOT yet published — the request returned before the eval ran.
  const midway = await getPipeline(p.id, orgId);
  assert.equal(midway?.status, 'draft', 'still draft while gating (no premature publish)');

  // Run the background resolution (in a request this is fire-and-forget). Never throws.
  const resolved = await resolveGatingJob(jobId, p.id, { orgId, by: 'tester@offgrid.local' });
  assert.ok(resolved, 'job resolved');
  assert.ok(['published', 'blocked'].includes(resolved!.status), 'reached a terminal state');
  assert.ok(resolved!.decision, 'a decision payload is recorded');

  // The job's terminal state is CONSISTENT with the pipeline's live status (regardless of whether the
  // gateway/Brain was reachable to score — the invariant holds either way, so the test never flakes).
  const after = await getPipeline(p.id, orgId);
  const job = await getPublishJob(jobId, orgId);
  if (job!.status === 'blocked') {
    assert.equal(after?.status, 'draft', 'blocked ⇒ stays draft');
    assert.equal(job!.decision?.decision.pass, false);
  } else {
    assert.equal(after?.status, 'published', 'published ⇒ live');
    assert.equal(job!.decision?.version, after?.version);
  }
});
