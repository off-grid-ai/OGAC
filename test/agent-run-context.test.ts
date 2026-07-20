import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  effectiveRunId,
  retrievalMode,
  resolveRunAttribution,
} from '../src/lib/agent-run-context.ts';
import { correlationIds } from '../src/lib/correlation.ts';

// Pure-logic unit tests for the C4 caller-context resolution — no Temporal, no db, no mocks. This is
// exactly what makes a durable run attribute/correlate identically to an inline run.

const SYSTEM = { type: 'machine' as const, id: 'system', label: 'system' };

test('resolveRunAttribution: context wins (durable path — resolved actor/org/project preserved)', () => {
  const actor = { type: 'machine' as const, id: 'svc-abc', label: 'CI Bot' };
  const a = resolveRunAttribution({
    context: { actor, org: 'org_2', project: 'proj_x' },
    caller: 'me@x.io', // present but context.actor must win
    orgId: 'org_default',
    machineFallback: SYSTEM,
  });
  // The resolved machine actor + label are preserved — NOT flattened to actorFrom(email).
  assert.deepEqual(a.actor, actor);
  assert.equal(a.org, 'org_2');
  assert.equal(a.project, 'proj_x');
});

test('resolveRunAttribution: no context → derive from caller (inline path, unchanged)', () => {
  const a = resolveRunAttribution({
    caller: 'alice@x.io',
    orgId: 'org_1',
    machineFallback: SYSTEM,
  });
  assert.deepEqual(a.actor, { type: 'user', id: 'alice@x.io', label: 'alice@x.io' });
  assert.equal(a.org, 'org_1');
  assert.equal(a.project, undefined);
});

test('resolveRunAttribution: no context, no caller → system machine fallback', () => {
  const a = resolveRunAttribution({ orgId: 'org_1', machineFallback: SYSTEM });
  assert.deepEqual(a.actor, SYSTEM);
  assert.equal(a.org, 'org_1');
});

test('resolveRunAttribution: blank context org/project fall back to the orgId param / undefined', () => {
  const a = resolveRunAttribution({
    context: { org: '   ', project: '  ' },
    caller: 'bob@x.io',
    orgId: 'org_9',
    machineFallback: SYSTEM,
  });
  assert.equal(a.org, 'org_9');
  assert.equal(a.project, undefined);
});

test('effectiveRunId: honors a context-supplied id (durable), else mints', () => {
  // Provided id is used verbatim so the persisted run + all four planes share the workflow's key.
  assert.equal(
    effectiveRunId('run_abcd1234', () => 'run_minted'),
    'run_abcd1234',
  );
  // Blank/absent → mint.
  assert.equal(effectiveRunId(undefined, () => 'run_minted'), 'run_minted');
  assert.equal(effectiveRunId('   ', () => 'run_minted'), 'run_minted');
});

test('C4: a threaded runId yields the identical four-plane correlation as an inline run', () => {
  // The whole point of honoring context.runId: given ONE runId, both inline and durable derive the
  // exact same audit/trace/lineage/provenance keys. Prove the derivation is stable + shared.
  const runId = effectiveRunId('run_c4f00d99', () => 'run_never');
  const ids = correlationIds(runId);
  assert.equal(ids.auditId, runId);
  assert.equal(ids.provenanceRef, runId);
  assert.equal(ids.traceId, 'runc4f00d99'); // normalized (underscore stripped)
  assert.match(ids.lineageRunId, /^[0-9a-f-]{36}$/); // deterministic UUIDv5
  // Deterministic: same runId → same lineage UUID every time (no state/randomness).
  assert.equal(correlationIds(runId).lineageRunId, ids.lineageRunId);
});

test('retrievalMode: governed workflow sources win; otherwise grounded retrieves and ungrounded skips', () => {
  const source = {
    sourceId: 'step-1',
    sourceKind: 'database' as const,
    title: 'corebank:accounts',
    snippet: '1 row',
    ref: 'corebank:accounts',
    score: 1,
  };

  assert.equal(retrievalMode(true, [source]), 'provided');
  assert.equal(retrievalMode(false, [source]), 'provided');
  assert.equal(retrievalMode(true, []), 'retrieve');
  assert.equal(retrievalMode(false, undefined), 'skip');
});
