import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseWorkerIdentity,
  shortSha,
  workerArtifactStamp,
  workerIdentity,
} from '../src/lib/worker-artifact-identity.ts';

// PURE tests for the durable worker artifact stamp (app-worker:artifact-identity).

test('shortSha truncates to 8, maps blank/unknown to "unknown"', () => {
  assert.equal(shortSha('61b86a720f725bbd6fdd40d0368e499e22c1bc2e'), '61b86a72');
  assert.equal(shortSha(''), 'unknown');
  assert.equal(shortSha('   '), 'unknown');
  assert.equal(shortSha('unknown'), 'unknown');
  assert.equal(shortSha(null), 'unknown');
  assert.equal(shortSha(undefined), 'unknown');
});

test('workerIdentity binds pid@host#sha8', () => {
  assert.equal(workerIdentity(42701, 'offgrid-s1', 'abcdef1234567890'), '42701@offgrid-s1#abcdef12');
  assert.equal(workerIdentity(1, '', 'abcdef1234'), '1@host#abcdef12');
  assert.equal(workerIdentity(9, 'h', ''), '9@h#unknown');
});

test('parseWorkerIdentity round-trips and tolerates a plain identity', () => {
  assert.deepEqual(parseWorkerIdentity('42701@offgrid-s1#abcdef12'), {
    pid: '42701',
    host: 'offgrid-s1',
    sha: 'abcdef12',
  });
  assert.deepEqual(parseWorkerIdentity('42701@offgrid-s1'), {
    pid: '42701',
    host: 'offgrid-s1',
    sha: null,
  });
  assert.equal(parseWorkerIdentity('garbage'), null);
  assert.equal(parseWorkerIdentity(''), null);
  assert.equal(parseWorkerIdentity(null), null);
});

test('parse ∘ build recovers the sha suffix', () => {
  const id = workerIdentity(7, 'g1', 'deadbeefcafe');
  assert.equal(parseWorkerIdentity(id)?.sha, 'deadbeef');
});

test('workerArtifactStamp composes the full stamp', () => {
  const s = workerArtifactStamp({
    service: 'app-worker',
    taskQueue: 'offgrid-apps',
    pid: 42701,
    host: 'offgrid-s1',
    sourceSha: '61b86a720f725bbd',
    sdkVersion: '1.20.2',
    workerScript: 'scripts/app-worker.mts',
  });
  assert.equal(s.service, 'app-worker');
  assert.equal(s.sourceSha, '61b86a720f725bbd');
  assert.equal(s.shortSha, '61b86a72');
  assert.equal(s.sdkVersion, '1.20.2');
  assert.equal(s.identity, '42701@offgrid-s1#61b86a72');
});

test('workerArtifactStamp maps missing sha/version to unknown', () => {
  const s = workerArtifactStamp({
    service: 'app-worker',
    taskQueue: 'offgrid-apps',
    pid: 1,
    host: 'h',
    sourceSha: '',
    sdkVersion: null,
    workerScript: 'scripts/app-worker.mts',
  });
  assert.equal(s.sourceSha, 'unknown');
  assert.equal(s.shortSha, 'unknown');
  assert.equal(s.sdkVersion, 'unknown');
  assert.equal(s.identity, '1@h#unknown');
});
