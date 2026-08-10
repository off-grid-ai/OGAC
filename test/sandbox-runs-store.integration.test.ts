import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// sandbox_runs INTEGRATION — the real retained exec-run history against a real Postgres, no mocks.
// Proves: a run persists and reads back through the SAME shape sandbox-view.normalizeSandbox
// expects; org-scoping (no cross-org leak); and newest-first ordering. Skips (green) when no DB is up.

const dbUp = await dbReachable();

test(
  'sandbox_runs: record + list round-trip, org-scoped, newest-first (real Postgres)',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { recordSandboxRun, listSandboxRuns, deleteSandboxRunsForOrg } = await import(
      '@/lib/sandbox-runs-store.ts'
    );
    const { normalizeSandbox } = await import('@/lib/sandbox-view.ts');

    const orgId = `org-sbx-${Date.now()}`;
    const otherOrg = `${orgId}-other`;
    t.after(async () => {
      await deleteSandboxRunsForOrg(orgId).catch(() => {});
      await deleteSandboxRunsForOrg(otherOrg).catch(() => {});
    });

    await recordSandboxRun(
      { engine: 'docker', language: 'python', ok: true, exitCode: 0, timedOut: false, refused: '', durationMs: 120 },
      orgId,
    );
    await recordSandboxRun(
      { engine: 'docker', language: 'node', ok: false, exitCode: 1, timedOut: false, refused: '', durationMs: 80 },
      orgId,
    );
    await recordSandboxRun(
      { engine: 'none', language: 'python', ok: false, exitCode: null, timedOut: false, refused: 'code execution is disabled', durationMs: 0 },
      otherOrg,
    );

    const rows = await listSandboxRuns(orgId);
    assert.equal(rows.length, 2, 'only this org\'s runs come back');
    // Newest-first.
    assert.equal(rows[0].language, 'node');
    assert.equal(rows[1].language, 'python');
    assert.equal(rows[0].exitCode, 1);
    assert.equal(rows[1].ok, true);

    const otherRows = await listSandboxRuns(otherOrg);
    assert.equal(otherRows.length, 1);
    assert.equal(otherRows[0].refused, 'code execution is disabled');

    // Feeds straight into the pure normalizer the page/route actually render with.
    const view = normalizeSandbox({ id: 'docker', reachable: true }, rows);
    assert.equal(view.total, 2);
    assert.equal(view.counts.ok, 1);
    assert.equal(view.counts.failed, 1);
  },
);
