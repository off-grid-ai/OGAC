import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processRole } from '../src/lib/cache-tallies-store.ts';

// The role is the primary key of a process's snapshot row, so getting it wrong means two processes
// overwrite each other's numbers and the panel silently under-reports.

test('the worker is recognised from how it is actually launched on the box', () => {
  // Verbatim shape of the live process: tsx scripts/app-worker.mts
  const argv = ['/usr/local/bin/node', '/Users/admin/offgrid/console/node_modules/.bin/tsx', 'scripts/app-worker.mts'];
  assert.equal(processRole(argv), 'worker');
});

test('the web process is not mistaken for a worker', () => {
  assert.equal(processRole(['/usr/local/bin/node', 'node_modules/.bin/next', 'start', '-p', '3000']), 'web');
});

test('an explicit role always wins over sniffing argv', () => {
  // So a new process type can name itself instead of hoping its argv contains the right word.
  const workerish = ['node', 'scripts/app-worker.mts'];
  assert.equal(processRole(workerish, 'eval-runner'), 'eval-runner');
  assert.equal(processRole(['node', 'next'], 'worker'), 'worker');
});

test('a blank or whitespace role falls back to sniffing rather than keying on an empty string', () => {
  // An empty label would collide across every process — the exact failure this key exists to avoid.
  for (const blank of ['', '   ', undefined]) {
    assert.equal(processRole(['node', 'scripts/app-worker.mts'], blank), 'worker');
    assert.equal(processRole(['node', 'next', 'start'], blank), 'web');
  }
});

test('matching is case-insensitive, since the launcher name is not ours to control', () => {
  assert.equal(processRole(['node', 'scripts/App-Worker.mts']), 'worker');
});
