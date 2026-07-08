import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// M6 (#192) export_targets INTEGRATION tests — the REAL exporter store against a REAL Postgres, no
// mocks. Proves: create/read/update/delete round-trips; enabled toggle + runnable derivation;
// honest last-status persistence; and strict org-scoping (no cross-org leak). Rows live under a
// dedicated org id so real data is untouched; skips (green) when no DB is up.

const dbUp = await dbReachable();

test('export_targets CRUD + org-scoping (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    createExportTarget,
    getExportTarget,
    listExportTargets,
    updateExportTarget,
    deleteExportTarget,
    recordExportStatus,
  } = await import('@/lib/exporters/store');

  const marker = `exp-${Date.now()}`;
  const orgId = `org-${marker}`;
  const otherOrg = `org-${marker}-other`;

  const created: { id: string; org: string }[] = [];
  t.after(async () => {
    for (const c of created) await deleteExportTarget(c.id, c.org).catch(() => {});
  });

  // ── create (audit → Splunk) ────────────────────────────────────────────────────────────────
  const splunk = await createExportTarget(
    { kind: 'audit', endpoint: 'https://splunk.example.com:8088', enabled: true, secretRef: 'splunk/hec' },
    orgId,
  );
  created.push({ id: splunk.id, org: orgId });
  assert.equal(splunk.kind, 'audit');
  assert.equal(splunk.label, 'Splunk (HEC)');
  assert.equal(splunk.endpoint, 'https://splunk.example.com:8088');
  assert.equal(splunk.secretRef, 'splunk/hec');
  assert.equal(splunk.runnable, true, 'audit with endpoint + secret + enabled is runnable');
  assert.equal(splunk.lastStatus, null, 'never tested yet');

  // ── create (metrics scrape — no endpoint/secret) ─────────────────────────────────────────────
  const metrics = await createExportTarget(
    { kind: 'metrics', endpoint: '', enabled: true, secretRef: null },
    orgId,
  );
  created.push({ id: metrics.id, org: orgId });
  assert.equal(metrics.runnable, true, 'metrics scrape needs neither endpoint nor secret');

  // ── read back ─────────────────────────────────────────────────────────────────────────────
  const read = await getExportTarget(splunk.id, orgId);
  assert.equal(read!.endpoint, 'https://splunk.example.com:8088');

  // ── list is org-scoped ──────────────────────────────────────────────────────────────────────
  const all = await listExportTargets(orgId);
  assert.equal(all.length, 2);
  assert.equal((await listExportTargets(otherOrg)).length, 0, 'no cross-org leak');

  // ── update: disable ⇒ not runnable ──────────────────────────────────────────────────────────
  const disabled = await updateExportTarget(splunk.id, orgId, {
    kind: 'audit',
    endpoint: 'https://splunk.example.com:8088',
    enabled: false,
    secretRef: 'splunk/hec',
  });
  assert.equal(disabled!.enabled, false);
  assert.equal(disabled!.runnable, false, 'disabled ⇒ not runnable');

  // ── honest last-status persists ─────────────────────────────────────────────────────────────
  await recordExportStatus(splunk.id, orgId, 'ok', 'HEC reachable, token accepted.');
  const withStatus = await getExportTarget(splunk.id, orgId);
  assert.equal(withStatus!.lastStatus, 'ok');
  assert.equal(withStatus!.lastDetail, 'HEC reachable, token accepted.');
  assert.ok(withStatus!.lastAt, 'lastAt timestamp set');

  await recordExportStatus(splunk.id, orgId, 'fail', 'Splunk rejected the token (HTTP 403).');
  assert.equal((await getExportTarget(splunk.id, orgId))!.lastStatus, 'fail');

  // ── cross-org isolation on mutation ─────────────────────────────────────────────────────────
  assert.equal(await deleteExportTarget(splunk.id, otherOrg), false, 'cannot delete across org');
  assert.equal(await getExportTarget(splunk.id, orgId) !== null, true, 'still present in its org');

  // ── delete ──────────────────────────────────────────────────────────────────────────────────
  assert.equal(await deleteExportTarget(splunk.id, orgId), true);
  assert.equal(await getExportTarget(splunk.id, orgId), null);
  assert.equal((await listExportTargets(orgId)).length, 1, 'only metrics target remains');
});
