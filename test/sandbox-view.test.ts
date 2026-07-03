import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRun, normalizeSandbox } from '../src/lib/sandbox-view.ts';

// Unit tests for the pure sandbox normalizer — NO mocks. Exercises the real classification +
// display logic that the /sandbox page renders, so a regression is caught directly.

test('classifyRun: precedence refused > timeout > failed > ok', () => {
  assert.equal(classifyRun({ refused: 'exec disabled', timedOut: true, ok: true }), 'refused');
  assert.equal(classifyRun({ timedOut: true, ok: true }), 'timeout');
  assert.equal(classifyRun({ ok: false }), 'failed');
  assert.equal(classifyRun({ ok: true }), 'ok');
  assert.equal(classifyRun({}), 'failed'); // nothing set → not ok → failed
  assert.equal(classifyRun({ refused: '   ' }), 'failed'); // blank refused ignored
});

test('normalizeSandbox: maps active status + flags exec-disabled for no-exec backend', () => {
  const v = normalizeSandbox(
    { id: 'none', vendor: 'Off Grid (no-exec)', license: 'first-party', description: 'safe', reachable: true },
    [],
  );
  assert.equal(v.backend, 'none');
  assert.equal(v.vendor, 'Off Grid (no-exec)');
  assert.equal(v.license, 'first-party');
  assert.equal(v.reachable, true);
  assert.equal(v.execDisabled, true);
  assert.equal(v.total, 0);
  assert.deepEqual(v.counts, { ok: 0, failed: 0, timeout: 0, refused: 0 });
});

test('normalizeSandbox: docker backend is not exec-disabled', () => {
  const v = normalizeSandbox({ id: 'docker', reachable: false }, []);
  assert.equal(v.backend, 'docker');
  assert.equal(v.execDisabled, false);
  assert.equal(v.reachable, false); // anything non-true → false
});

test('normalizeSandbox: sorts runs newest-first and tallies counts by status', () => {
  const v = normalizeSandbox({ id: 'docker', reachable: true }, [
    { id: 'a', engine: 'docker', language: 'python', ok: true, exitCode: 0, durationMs: 120, createdAt: '2026-07-01T10:00:00Z' },
    { id: 'b', engine: 'docker', language: 'node', ok: false, exitCode: 1, durationMs: 80, createdAt: '2026-07-03T10:00:00Z' },
    { id: 'c', engine: 'docker', language: 'python', timedOut: true, createdAt: '2026-07-02T10:00:00Z' },
    { id: 'd', engine: 'none', language: 'python', refused: 'nope', createdAt: '2026-07-04T10:00:00Z' },
  ]);
  assert.equal(v.total, 4);
  assert.deepEqual(v.runs.map((r) => r.id), ['d', 'b', 'c', 'a']); // newest-first
  assert.deepEqual(v.counts, { ok: 1, failed: 1, timeout: 1, refused: 1 });
  assert.equal(v.runs[3].status, 'ok');
  assert.equal(v.runs[3].exitCode, 0);
  assert.equal(v.runs[3].durationMs, 120);
});

test('normalizeSandbox: runs without timestamps sink to the bottom, stably', () => {
  const v = normalizeSandbox({ id: 'docker' }, [
    { id: 'no-ts-1', ok: true },
    { id: 'dated', ok: true, createdAt: '2026-07-01T00:00:00Z' },
    { id: 'no-ts-2', ok: true },
  ]);
  assert.deepEqual(v.runs.map((r) => r.id), ['dated', 'no-ts-1', 'no-ts-2']);
});

test('normalizeSandbox: never throws on missing/garbage input', () => {
  const empty = normalizeSandbox(null, null);
  assert.equal(empty.backend, 'unknown');
  assert.equal(empty.vendor, 'unknown');
  assert.equal(empty.license, 'unknown');
  assert.equal(empty.reachable, false);
  assert.equal(empty.total, 0);

  const junk = normalizeSandbox(
    { id: 42 as unknown as string, reachable: 'yes' as unknown as boolean },
    // @ts-expect-error exercising garbage-tolerance at runtime
    [null, 'nope', { id: 5, ok: 'true', exitCode: 'x', durationMs: NaN }],
  );
  assert.equal(junk.backend, 'unknown'); // non-string id ignored
  assert.equal(junk.reachable, false); // non-true reachable ignored
  assert.equal(junk.total, 3);
  // garbage fields fall back cleanly
  assert.equal(junk.runs.every((r) => typeof r.id === 'string'), true);
  assert.equal(junk.runs.every((r) => r.exitCode === null), true);
  assert.equal(junk.runs.every((r) => r.durationMs === null), true);
});

test('normalizeSandbox: assigns synthetic run ids when missing', () => {
  const v = normalizeSandbox({ id: 'docker' }, [{ ok: true }, { ok: false }]);
  assert.equal(v.runs.length, 2);
  assert.equal(v.runs.every((r) => r.id.length > 0), true);
});
