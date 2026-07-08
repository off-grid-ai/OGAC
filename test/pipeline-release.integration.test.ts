import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// M1 close-the-loop INTEGRATION tests — the REAL release-gate / rollback / feedback write+read
// paths against a REAL Postgres, no mocks. Exercises:
//   • publishWithGate on a pipeline with NO evals → publishes (gate ungated, additive/safe) and the
//     store froze a `published` version snapshot;
//   • rollbackToLastGood → restores the last-good published version's config as live, freezes an
//     `autorollback` snapshot, and listRollbackHistory reads it back;
//   • captureHitlCorrection / captureChatThumb → a feedback-suite golden case lands with the bound
//     pipeline_id, and is isolated to that pipeline (never leaks to another).
// Skips (green) when no DB is up. Tracks + deletes only the ids it creates.

const dbUp = await dbReachable();

test('M1 release-gate + rollback + feedback (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createPipeline, updatePipeline, getPipeline, listPipelineVersions, deletePipeline } =
    await import('@/lib/pipelines');
  const { publishWithGate, rollbackToLastGood, listRollbackHistory } = await import(
    '@/lib/pipeline-release'
  );
  const { captureHitlCorrection, captureChatThumb } = await import('@/lib/feedback-store');
  const { listGoldenCases, deleteGoldenCase } = await import('@/lib/evals');
  const { FEEDBACK_SUITE } = await import('@/lib/feedback-map');

  const marker = `m1-${Date.now()}`;
  const orgId = `org-${marker}`;
  const goldenIds: string[] = [];

  // ── 1. publish with NO evals attached → publishes (ungated, additive/safe) ──────────────────────
  const p = await createPipeline({ name: `${marker} pipeline`, dataAllowlist: ['dom-a'] }, 'tester', orgId);
  t.after(async () => {
    for (const id of goldenIds) await deleteGoldenCase(id).catch(() => {});
    await deletePipeline(p.id, orgId).catch(() => {});
  });

  const publishRes = await publishWithGate(p.id, { orgId, by: 'tester@offgrid.local' });
  assert.notEqual(publishRes, null);
  assert.equal(publishRes!.blocked, false, 'no evals ⇒ not blocked');
  assert.equal(publishRes!.decision.gated, false, 'no evals ⇒ ungated');
  assert.equal(publishRes!.pipeline?.status, 'published');

  // The store froze a `published` version snapshot.
  const afterPublish = await listPipelineVersions(p.id, orgId);
  assert.ok(
    afterPublish.some((v) => v.note === 'published' && (v.snapshot as { status?: string }).status === 'published'),
    'a published snapshot was frozen',
  );

  // ── 2. Make an EDIT (a new, current version) then roll back to the last-good published one ───────
  // Edit changes the data ceiling and bumps the version; the published snapshot above is now the
  // last-good target. Rollback must restore that config as live.
  await updatePipeline(p.id, { dataAllowlist: ['dom-a', 'dom-b-BAD'] }, orgId, 'tester@offgrid.local');
  const beforeRollback = await getPipeline(p.id, orgId);
  const publishedSnap = afterPublish.find((v) => v.note === 'published')!;
  const goodAllowlist = (publishedSnap.snapshot as { dataAllowlist?: string[] }).dataAllowlist ?? [];

  const rb = await rollbackToLastGood(p.id, 'eval-gate-fail', {
    orgId,
    by: 'system@offgrid.local',
    detail: 'test-forced',
  });
  assert.equal(rb.rolledBack, true, 'rolled back to a prior good version');
  assert.equal(rb.toVersion, publishedSnap.version, 'rolled back to the last-good published version');

  // The live config now matches the restored (good) allowlist, not the bad edit.
  const afterRollback = await getPipeline(p.id, orgId);
  assert.deepEqual(afterRollback!.dataAllowlist.sort(), [...goodAllowlist].sort());
  assert.notDeepEqual(afterRollback!.dataAllowlist.sort(), beforeRollback!.dataAllowlist.sort());
  assert.equal(afterRollback!.status, 'published');

  // Rollback history reads back the autorollback snapshot with its reason note.
  const history = await listRollbackHistory(p.id, orgId);
  assert.ok(history.length >= 1, 'a rollback event is in history');
  assert.match(history[0].note, /Auto-rollback \(eval gate failed\)/);

  // ── 3. Rollback with NO prior good version is honest (returns rolledBack:false) ─────────────────
  const fresh = await createPipeline({ name: `${marker} fresh` }, 'tester', orgId);
  t.after(async () => {
    await deletePipeline(fresh.id, orgId).catch(() => {});
  });
  const noTarget = await rollbackToLastGood(fresh.id, 'drift-breach', { orgId });
  assert.equal(noTarget.rolledBack, false);
  assert.match(noTarget.reason ?? '', /no prior good/);

  // ── 4. Feedback → golden lands with pipeline_id + suite='feedback', isolated to the pipeline ────
  const hitl = await captureHitlCorrection(
    { input: 'What is the claim status?', correctedOutput: 'Approved.', decision: 'reject' },
    p.id,
  );
  assert.equal(hitl.captured, true);
  if (hitl.goldenId) goldenIds.push(hitl.goldenId);

  const thumb = await captureChatThumb(
    { rating: 'down', query: 'IFSC length?', answer: '10', correction: 'IFSC is 11 chars' },
    p.id,
  );
  assert.equal(thumb.captured, true);
  if (thumb.goldenId) goldenIds.push(thumb.goldenId);

  // A thumbs-down with no correction is NOT captured (honest).
  const noGood = await captureChatThumb({ rating: 'down', query: 'x', answer: 'wrong' }, p.id);
  assert.equal(noGood.captured, false);

  // The feedback cases are attached to THIS pipeline, tagged feedback, and isolated from another.
  const mine = await listGoldenCases({ pipelineId: p.id });
  const feedbackCases = mine.filter((g) => g.suite === FEEDBACK_SUITE);
  assert.equal(feedbackCases.length, 2, 'both usable feedback cases landed on this pipeline');
  assert.ok(feedbackCases.every((g) => g.pipelineId === p.id), 'stamped with pipeline_id');

  const others = await listGoldenCases({ pipelineId: fresh.id });
  assert.equal(
    others.filter((g) => goldenIds.includes(g.id)).length,
    0,
    'feedback cases never leak to another pipeline',
  );
});

// Publish-BLOCKED-on-failing-eval — attaches a real eval with an impossible-to-clear threshold and a
// seeded golden set, then publishes THROUGH the gate. The invariant asserted holds regardless of
// whether the gateway/Brain is reachable (so the test never flakes on a missing service):
//   • if the eval produced a real (scored) verdict, a below-threshold score BLOCKS publish and the
//     pipeline stays unpublished (draft) — the gate did its job;
//   • if the eval could not score (no gateway/Brain), the gate is ungated and publish proceeds
//     (additive/safe). Either way the decision is returned and the status is CONSISTENT with it.
test('publish blocked on a failing eval, else ungated-safe (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createPipeline, getPipeline, deletePipeline } = await import('@/lib/pipelines');
  const { publishWithGate } = await import('@/lib/pipeline-release');
  const { addEvalDef, deleteEvalDef } = await import('@/lib/eval-defs');
  const { addGoldenCase, deleteGoldenCase } = await import('@/lib/evals');

  const marker = `m1blk-${Date.now()}`;
  const orgId = `org-${marker}`;

  const p = await createPipeline({ name: `${marker} gated` }, 'tester', orgId);
  // faithfulness (higher-better) at threshold 1.0 — with an empty/ungrounded answer the heuristic
  // scores 0, i.e. below 100% → a hard fail whenever it scores at all.
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

  t.after(async () => {
    await deleteGoldenCase(gc.id).catch(() => {});
    await deleteEvalDef(ev.id).catch(() => {});
    await deletePipeline(p.id, orgId).catch(() => {});
  });

  const res = await publishWithGate(p.id, { orgId, by: 'tester@offgrid.local' });
  assert.notEqual(res, null);
  assert.ok(res!.decision, 'a gate decision is always returned');

  const after = await getPipeline(p.id, orgId);
  if (res!.decision.gated) {
    // The eval scored a real verdict — an impossible threshold must have FAILED and BLOCKED publish.
    assert.equal(res!.blocked, true, 'a scored below-threshold eval blocks publish');
    assert.equal(res!.pipeline, null);
    assert.equal(after!.status, 'draft', 'blocked pipeline stays unpublished');
    assert.ok(res!.decision.failing.length >= 1, 'the failing eval is named');

    // Override publishes despite the failure (audited).
    const forced = await publishWithGate(p.id, { orgId, by: 'tester@offgrid.local', override: true });
    assert.equal(forced!.overridden, true);
    assert.equal(forced!.pipeline?.status, 'published');
  } else {
    // No gateway/Brain to score against — ungated, so publish proceeds (additive/safe).
    assert.equal(res!.blocked, false);
    assert.equal(after!.status, 'published');
  }
});
