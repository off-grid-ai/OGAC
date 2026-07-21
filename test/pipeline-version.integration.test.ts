import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION tests for the version-management I/O against a REAL Postgres, no mocks. Exercises:
//   • annotatePipelineVersion / getPipelineVersion — the operator label round-trips + a single-version
//     read returns the frozen contract;
//   • rollbackToVersion — a TARGETED rollback to an operator-chosen prior version restores its config
//     as live, freezes a `Rollback (manual)` snapshot, and refuses an invalid (current/newer/unknown)
//     target honestly (no fabrication).
// Skips (green) when no DB is up. Tracks + deletes only the ids it creates.

const dbUp = await dbReachable();

test('version annotate + targeted rollback (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    createPipeline,
    updatePipeline,
    getPipeline,
    listPipelineVersions,
    getPipelineVersion,
    annotatePipelineVersion,
    deletePipeline,
  } = await import('@/lib/pipelines');
  const { rollbackToVersion } = await import('@/lib/pipeline-release');

  const marker = `pv-${Date.now()}`;
  const orgId = `org-${marker}`;

  // v1 created with allowlist [pan-domain]; edit to v2 (widen), edit to v3 (widen more).
  const p = await createPipeline(
    { name: `${marker} ABSLI claims`, dataAllowlist: ['pan-domain'], gatewayId: 'gw_onprem' },
    'ops@absli.example',
    orgId,
  );
  t.after(async () => {
    await deletePipeline(p.id, orgId).catch(() => {});
  });

  await updatePipeline(p.id, { dataAllowlist: ['pan-domain', 'ifsc-domain'] }, orgId, 'ops@absli.example');
  const afterV3 = await updatePipeline(
    p.id,
    { dataAllowlist: ['pan-domain', 'ifsc-domain', 'aadhaar-domain'] },
    orgId,
    'ops@absli.example',
  );
  assert.equal(afterV3!.version, 3, 'two edits ⇒ v3 is current');

  const versions = await listPipelineVersions(p.id, orgId);
  assert.ok(versions.length >= 3, 'v1..v3 recorded');
  // Newest first, and label defaults to empty.
  assert.equal(versions[0].version, 3);
  assert.equal(versions[0].label, '');

  // ── annotate v1, read it back via getPipelineVersion ──
  const annotated = await annotatePipelineVersion(p.id, 1, 'RBI-cleared baseline', orgId);
  assert.ok(annotated, 'annotate returns the updated version');
  assert.equal(annotated!.label, 'RBI-cleared baseline');
  const v1 = await getPipelineVersion(p.id, 1, orgId);
  assert.equal(v1!.label, 'RBI-cleared baseline', 'label persisted');
  assert.equal((v1!.snapshot as { dataAllowlist?: string[] }).dataAllowlist?.length, 1, 'v1 frozen contract');
  // clearing the label works
  const cleared = await annotatePipelineVersion(p.id, 1, '', orgId);
  assert.equal(cleared!.label, '');

  // annotate/read of an unknown version → null (honest)
  assert.equal(await getPipelineVersion(p.id, 99, orgId), null);
  assert.equal(await annotatePipelineVersion(p.id, 99, 'x', orgId), null);

  // ── targeted rollback to v1 (the operator's explicit choice) ──
  const rb = await rollbackToVersion(p.id, 1, { orgId, by: 'ops@absli.example', detail: 'reverting ceiling widen' });
  assert.equal(rb.rolledBack, true, 'rolled back to v1');
  assert.equal(rb.toVersion, 1);
  assert.equal(rb.fromVersion, 3);
  const live = await getPipeline(p.id, orgId);
  assert.deepEqual(live!.dataAllowlist, ['pan-domain'], 'v1 config restored as live');
  assert.equal(live!.status, 'published', 'rollback publishes the restored version');
  assert.equal(live!.version, 4, 'rollback bumped the version');

  // the rollback froze a `Rollback (manual)` snapshot carrying the reason
  const afterRb = await listPipelineVersions(p.id, orgId);
  const note = afterRb.find((v) => v.version === 4)!.note;
  assert.match(note, /Rollback \(manual\): v3 → restored v1/);
  assert.match(note, /reverting ceiling widen/);

  // ── honest refusals: current / newer / unknown target ──
  const toCurrent = await rollbackToVersion(p.id, 4, { orgId });
  assert.equal(toCurrent.rolledBack, false);
  assert.match(toCurrent.reason!, /not older/);
  // a version >= current is refused as "not older" (the ordering guard fires before existence).
  const tooNew = await rollbackToVersion(p.id, 999, { orgId });
  assert.equal(tooNew.rolledBack, false);
  assert.match(tooNew.reason!, /not older/);
  const toMissing = await rollbackToVersion('pl_does_not_exist', 1, { orgId });
  assert.equal(toMissing.rolledBack, false);
  assert.equal(toMissing.reason, 'unknown pipeline');
});
