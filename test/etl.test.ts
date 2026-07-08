import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeJobStatus,
  summarizeConnection,
  summarizeJob,
  buildConnectionsListBody,
  buildJobsListBody,
  buildSyncBody,
  buildJobGetBody,
} from '../src/lib/etl-model.ts';

// ─── UNIT: normalizeJobStatus ─────────────────────────────────────────────────
test('normalizeJobStatus maps known Airbyte statuses onto the console vocabulary', () => {
  assert.equal(normalizeJobStatus('running'), 'running');
  assert.equal(normalizeJobStatus('incomplete'), 'running');
  assert.equal(normalizeJobStatus('succeeded'), 'succeeded');
  assert.equal(normalizeJobStatus('success'), 'succeeded');
  assert.equal(normalizeJobStatus('failed'), 'failed');
  assert.equal(normalizeJobStatus('error'), 'failed');
  assert.equal(normalizeJobStatus('cancelled'), 'cancelled');
  assert.equal(normalizeJobStatus('canceled'), 'cancelled');
  assert.equal(normalizeJobStatus('pending'), 'pending');
  assert.equal(normalizeJobStatus('queued'), 'pending');
});

test('normalizeJobStatus is case/whitespace insensitive', () => {
  assert.equal(normalizeJobStatus('  RUNNING '), 'running');
  assert.equal(normalizeJobStatus('Succeeded'), 'succeeded');
});

test('normalizeJobStatus folds unknown / missing → pending', () => {
  assert.equal(normalizeJobStatus('weird_state'), 'pending');
  assert.equal(normalizeJobStatus(''), 'pending');
  assert.equal(normalizeJobStatus(undefined), 'pending');
  assert.equal(normalizeJobStatus(null), 'pending');
  assert.equal(normalizeJobStatus(42), 'pending');
});

// ─── UNIT: summarizeConnection ────────────────────────────────────────────────
test('summarizeConnection maps a verbose Airbyte connection to the compact shape', () => {
  const c = summarizeConnection({
    connectionId: 'conn-1',
    name: 'CoreBank → Lake',
    status: 'active',
    sourceId: 'src-1',
    destinationId: 'dst-1',
    scheduleType: 'cron',
    scheduleData: { cron: { cronExpression: '0 0 * * *' } },
    extraNoise: 'ignored',
  });
  assert.equal(c.connectionId, 'conn-1');
  assert.equal(c.name, 'CoreBank → Lake');
  assert.equal(c.status, 'active');
  assert.equal(c.sourceId, 'src-1');
  assert.equal(c.destinationId, 'dst-1');
  assert.equal(c.schedule, 'cron: 0 0 * * *');
  assert.ok(!('extraNoise' in c));
});

test('summarizeConnection defaults and legacy schedule shape', () => {
  const manual = summarizeConnection({ connectionId: 'c2', scheduleType: 'manual' });
  assert.equal(manual.name, 'c2'); // falls back to id when name missing
  assert.equal(manual.status, 'unknown');
  assert.equal(manual.schedule, 'manual');

  const legacy = summarizeConnection({ connectionId: 'c3', schedule: { units: 6, timeUnit: 'hours' } });
  assert.equal(legacy.schedule, 'every 6 hours');

  const empty = summarizeConnection({});
  assert.equal(empty.connectionId, '');
  assert.equal(empty.name, 'connection');
  assert.equal(empty.schedule, undefined);
});

// ─── UNIT: summarizeJob ───────────────────────────────────────────────────────
test('summarizeJob reads the { job, attempts } wrapper and sums attempt metrics', () => {
  const j = summarizeJob({
    job: { id: 101, configType: 'sync', configId: 'conn-1', status: 'succeeded', createdAt: 1700, updatedAt: 1800 },
    attempts: [
      { status: 'failed', recordsSynced: 10, bytesSynced: 100 },
      { status: 'succeeded', recordsSynced: 90, bytesSynced: 900 },
    ],
  });
  assert.equal(j.jobId, 101);
  assert.equal(j.connectionId, 'conn-1');
  assert.equal(j.status, 'succeeded');
  assert.equal(j.jobType, 'sync');
  assert.equal(j.createdAt, 1700);
  assert.equal(j.updatedAt, 1800);
  assert.equal(j.recordsSynced, 100);
  assert.equal(j.bytesSynced, 1000);
});

test('summarizeJob falls back to the latest attempt status and handles bare job objects', () => {
  const j = summarizeJob({
    job: { id: 7, configType: 'sync' }, // no job-level status
    attempts: [{ status: 'running' }],
  });
  assert.equal(j.status, 'running');
  assert.equal(j.recordsSynced, undefined); // no metrics present

  const bare = summarizeJob({ id: 9, status: 'weird', configId: 'c' });
  assert.equal(bare.jobId, 9);
  assert.equal(bare.status, 'pending'); // unknown status → pending

  const junk = summarizeJob({});
  assert.equal(junk.jobId, null);
  assert.equal(junk.status, 'pending');
});

// ─── UNIT: request-body builders ──────────────────────────────────────────────
test('body builders produce exactly the shapes Airbyte expects', () => {
  assert.deepEqual(buildConnectionsListBody('ws-1'), { workspaceId: 'ws-1' });
  assert.deepEqual(buildJobsListBody(), { configTypes: ['sync'] });
  assert.deepEqual(buildJobsListBody('conn-1'), { configTypes: ['sync'], configId: 'conn-1' });
  assert.deepEqual(buildSyncBody('conn-1'), { connectionId: 'conn-1' });
  assert.deepEqual(buildJobGetBody(101), { id: 101 });
});

// ─── REAL integration: hit the live Airbyte box ───────────────────────────────
// Point the adapter at the LAN box (prod default is loopback). Skips if unreachable so offline CI
// still passes; MUST run+pass on the dev LAN where the box is live.
const LIVE_URL = 'http://192.168.1.60:8005';

test('airbyteEtl integration — live health() and listWorkspaces()', async (t) => {
  process.env.OFFGRID_AIRBYTE_URL = LIVE_URL;
  // Import AFTER setting the env so the adapter reads the live URL (it reads process.env per-call).
  const { airbyteEtl } = await import('../src/lib/adapters/airbyte.ts');

  // Probe reachability first so an offline environment skips cleanly instead of failing.
  let reachable = false;
  try {
    const res = await fetch(`${LIVE_URL}/api/v1/health`, { signal: AbortSignal.timeout(2500) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    t.skip('live Airbyte box unreachable — skipping integration assertions');
    return;
  }

  const healthy = await airbyteEtl.health();
  assert.equal(healthy, true, 'health() must be true against a live {available:true} box');

  const workspaces = await airbyteEtl.listWorkspaces();
  assert.ok(Array.isArray(workspaces), 'listWorkspaces() returns an array (may be empty)');

  // Connections + jobs must also degrade gracefully to arrays (empty on a fresh box is fine).
  const connections = await airbyteEtl.listConnections();
  assert.ok(Array.isArray(connections), 'listConnections() returns an array');

  const jobs = await airbyteEtl.listJobs();
  assert.ok(Array.isArray(jobs), 'listJobs() returns an array');
});

test('airbyteEtl integration — unreachable URL degrades to false / empty, never throws', async () => {
  process.env.OFFGRID_AIRBYTE_URL = 'http://127.0.0.1:9';
  const { airbyteEtl } = await import('../src/lib/adapters/airbyte.ts');
  assert.equal(await airbyteEtl.health(), false);
  assert.deepEqual(await airbyteEtl.listWorkspaces(), []);
  assert.deepEqual(await airbyteEtl.listConnections(), []);
  assert.deepEqual(await airbyteEtl.listJobs(), []);
  assert.equal(await airbyteEtl.triggerSync('nope'), null);
  assert.equal(await airbyteEtl.jobStatus(1), null);
});
