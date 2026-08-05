import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contentTypeFor,
  defaultObjectName,
  describeObjectWrite,
  planObjectSink,
} from '../src/lib/object-sink-policy.ts';

const RUN = 'apprun_ab12cd34';

test('THE RULE THIS EXISTS FOR: a file name may not name a folder', () => {
  // Every other sink names its own destination. An object store cannot work that way: the connector's
  // keypair usually reaches the WHOLE store, so a path taken from step config would let anyone who can
  // edit an app write anywhere that keypair reaches — including over the app's own source data. The
  // folder comes from the approved data domain; the step may only name a file inside it.
  for (const bad of ['../escape.txt', 'nested/file.txt', '/absolute.txt', '..', '.', 'a\\b.txt']) {
    const p = planObjectSink({ domain: 'dom_x', filename: bad }, RUN);
    assert.equal(p.ok, false, `${bad} must be refused`);
    if (!p.ok) assert.equal(p.problem, 'filename-invalid');
  }
});

test('a step with no data location saves nothing and says so in plain words', () => {
  const p = planObjectSink({}, RUN);
  assert.equal(p.ok, false);
  if (p.ok) return;
  assert.equal(p.problem, 'domain-missing');
  assert.match(p.sentence, /nothing is saved/);
  // No storage vocabulary leaks to the person reading it.
  assert.doesNotMatch(p.sentence, /bucket|prefix|S3|object store/i);
});

test('two runs of one app do not silently overwrite each other', () => {
  // The default name is the run id. A fixed default would mean every run replaced the last, and the
  // loss would only be noticed when someone went looking for an older one.
  const a = planObjectSink({ domain: 'd' }, 'apprun_one');
  const b = planObjectSink({ domain: 'd' }, 'apprun_two');
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.filename, b.filename);
  assert.equal(a.filename, defaultObjectName('apprun_one'));
});

test('a name can be made unique per run with a token, or deliberately stable without one', () => {
  const perRun = planObjectSink({ domain: 'd', filename: 'claims-{runId}.json' }, RUN);
  assert.equal(perRun.ok && perRun.filename, `claims-${RUN}.json`);
  // A stable name is a legitimate choice — "latest.json" that each run replaces.
  const stable = planObjectSink({ domain: 'd', filename: 'latest.json' }, RUN);
  assert.equal(stable.ok && stable.filename, 'latest.json');
});

test('the content type follows the name, because a JSON file served as text breaks the next reader', () => {
  assert.equal(contentTypeFor('a.json'), 'application/json');
  assert.equal(contentTypeFor('a.csv'), 'text/csv');
  assert.equal(contentTypeFor('a.md'), 'text/markdown');
  assert.equal(contentTypeFor('a.unknown'), 'text/plain');
  assert.equal(contentTypeFor('A.JSON'), 'application/json', 'extension case must not matter');
  // An explicit choice always wins over the guess.
  assert.equal(contentTypeFor('a.json', 'text/plain'), 'text/plain');
});

test('an over-long name is refused rather than truncated into a different file', () => {
  const p = planObjectSink({ domain: 'd', filename: `${'a'.repeat(250)}.txt` }, RUN);
  assert.equal(p.ok, false);
});

test('the step detail says what was saved where, with no storage jargon', () => {
  const line = describeObjectWrite('Claim intimations (lake)', 'intimations/x.json', 1);
  assert.match(line, /Saved 1 byte to Claim intimations \(lake\)/);
  assert.match(describeObjectWrite('D', 'k', 2), /2 bytes/);
});
