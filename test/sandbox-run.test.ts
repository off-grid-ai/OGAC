import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRunRequest,
  normalizeRunResult,
  RUN_TIMEOUT_MS,
} from '../src/lib/sandbox-view.ts';

// Unit tests for the pure Run Code request-validation + result-normalization. NO mocks — exercises
// the real logic the Run Code panel + run route rely on.

test('buildRunRequest: accepts valid python/node with code', () => {
  const py = buildRunRequest('python', 'print(1)');
  assert.equal(py.ok, true);
  assert.deepEqual(py.ok && py.request, {
    language: 'python',
    code: 'print(1)',
    timeoutMs: RUN_TIMEOUT_MS,
  });

  const node = buildRunRequest('node', 'console.log(1)');
  assert.equal(node.ok, true);
  assert.equal(node.ok && node.request.language, 'node');
});

test('buildRunRequest: caps timeout at the 30s route limit', () => {
  assert.equal(RUN_TIMEOUT_MS, 30_000);
  const r = buildRunRequest('python', 'x');
  assert.equal(r.ok && r.request.timeoutMs, 30_000);
});

test('buildRunRequest: rejects unknown language', () => {
  const r = buildRunRequest('ruby', 'puts 1');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /python.*node/);
});

test('buildRunRequest: rejects empty / whitespace-only code', () => {
  assert.equal(buildRunRequest('python', '').ok, false);
  assert.equal(buildRunRequest('python', '   \n\t ').ok, false);
  assert.equal(buildRunRequest('node', undefined).ok, false);
  assert.equal(buildRunRequest('node', 42).ok, false);
});

test('normalizeRunResult: ok run', () => {
  const v = normalizeRunResult({
    engine: 'docker',
    ok: true,
    stdout: 'hello\n',
    stderr: '',
    exitCode: 0,
    timedOut: false,
  });
  assert.equal(v.outcome, 'ok');
  assert.equal(v.engine, 'docker');
  assert.equal(v.stdout, 'hello\n');
  assert.equal(v.exitCode, 0);
  assert.equal(v.refused, '');
});

test('normalizeRunResult: failed run (non-zero exit)', () => {
  const v = normalizeRunResult({
    engine: 'docker',
    ok: false,
    stdout: '',
    stderr: 'Traceback...',
    exitCode: 1,
    timedOut: false,
  });
  assert.equal(v.outcome, 'failed');
  assert.equal(v.exitCode, 1);
  assert.equal(v.stderr, 'Traceback...');
});

test('normalizeRunResult: timeout takes precedence over ok', () => {
  const v = normalizeRunResult({ engine: 'docker', ok: false, timedOut: true, exitCode: null });
  assert.equal(v.outcome, 'timeout');
  assert.equal(v.timedOut, true);
  assert.equal(v.exitCode, null);
});

test('normalizeRunResult: refused (no-exec default) takes highest precedence', () => {
  const v = normalizeRunResult({
    engine: 'none',
    ok: false,
    refused: 'code execution is disabled (sandbox=none).',
    timedOut: true,
  });
  assert.equal(v.outcome, 'refused');
  assert.match(v.refused, /disabled/);
});

test('normalizeRunResult: surfaces a route { error } body as stderr', () => {
  const v = normalizeRunResult({ error: 'code execution disabled (flag: agent-code-exec is off)' });
  assert.equal(v.outcome, 'failed');
  assert.match(v.stderr, /agent-code-exec/);
});

test('normalizeRunResult: tolerates missing/garbage input without throwing', () => {
  const a = normalizeRunResult(null);
  assert.equal(a.outcome, 'failed');
  assert.equal(a.engine, 'unknown');
  assert.equal(a.exitCode, null);

  const b = normalizeRunResult({ ok: 'yes', exitCode: 'x', refused: '   ' });
  assert.equal(b.outcome, 'failed'); // non-true ok, blank refused ignored
  assert.equal(b.exitCode, null);
  assert.equal(b.refused, '');
});
