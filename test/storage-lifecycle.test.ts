import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLifecycleXml,
  normalizeLifecycleRule,
  parseLifecycleXml,
  type LifecycleRule,
} from '../src/lib/storage-lifecycle.ts';

const rule = (over: Partial<LifecycleRule> = {}): LifecycleRule => ({
  id: 'expire-exports-30d',
  prefix: 'exports/',
  expireDays: 30,
  enabled: true,
  ...over,
});

test('THE DEFECT THIS GUARD EXISTS FOR: a rule with no day count is refused, not serialised', () => {
  // The lifecycle route was passing request bodies straight to the XML builder. A rule missing
  // `expireDays` became `<Days>undefined</Days>`, and the store answered `MalformedXML` — which names
  // neither the rule nor the field, so the operator learns nothing. Found live against SeaweedFS.
  for (const bad of [{}, { expireDays: 0 }, { expireDays: -5 }, { expireDays: 'thirty' }, { expireDays: null }]) {
    assert.equal(normalizeLifecycleRule(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
  // And a fractional day count is floored rather than emitted as a decimal the store would reject.
  assert.equal(normalizeLifecycleRule({ expireDays: 30.9 })?.expireDays, 30);
});

test('a retention period is capped at ten years rather than accepted unbounded', () => {
  // "Keep for 999999 days" is not retention, it is keeping it forever while claiming a policy.
  assert.equal(normalizeLifecycleRule({ expireDays: 999_999 })?.expireDays, 3650);
  assert.equal(normalizeLifecycleRule({ expireDays: 3650 })?.expireDays, 3650);
});

test('an unnamed rule is given a name that says what it does', () => {
  assert.equal(normalizeLifecycleRule({ expireDays: 30, prefix: 'exports/' })?.id, 'expire-exports/-30d');
  assert.equal(normalizeLifecycleRule({ expireDays: 7 })?.id, 'expire-all-7d');
  // An explicit name is kept and trimmed.
  assert.equal(normalizeLifecycleRule({ expireDays: 7, id: '  keep-me  ' })?.id, 'keep-me');
});

test('enabled defaults to on — a rule saved without a status is meant to apply', () => {
  assert.equal(normalizeLifecycleRule({ expireDays: 1 })?.enabled, true);
  assert.equal(normalizeLifecycleRule({ expireDays: 1, enabled: false })?.enabled, false);
});

test('a prefix carrying XML metacharacters cannot break out of the document', () => {
  // A bucket prefix is operator input that goes straight into a request body.
  const xml = buildLifecycleXml([rule({ prefix: 'a&b<c>"d\'', id: 'x<y' })]);
  // The hostile characters must survive only as entities: the values, with every real tag removed,
  // may not contain a bracket of their own.
  const values = xml
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<\/?(Rule|ID|Filter|Prefix|Status|Expiration|Days|LifecycleConfiguration)[^>]*>/g, '');
  assert.doesNotMatch(values, /[<>]/);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;/);
  // And a round trip returns exactly what went in, entities decoded by the parser's own matching.
  assert.equal(parseLifecycleXml(xml).length, 1);
});

test('rules survive the round trip through the wire format', () => {
  const rules = [rule(), rule({ id: 'purge-tmp', prefix: 'tmp/', expireDays: 1, enabled: false })];
  const back = parseLifecycleXml(buildLifecycleXml(rules));
  assert.deepEqual(back, rules);
});

test('an empty rule list is a valid document — that is how retention is cleared', () => {
  const xml = buildLifecycleXml([]);
  assert.match(xml, /<LifecycleConfiguration[^>]*><\/LifecycleConfiguration>$/);
  assert.deepEqual(parseLifecycleXml(xml), []);
});

test('a bare v1 <Prefix> outside a Filter is still understood', () => {
  // Real stores answer with either shape; reading only v2 would show an existing rule as absent, and
  // "no retention rule" is exactly the wrong thing to tell a compliance reader.
  const v1 = `<LifecycleConfiguration><Rule><ID>legacy</ID><Prefix>logs/</Prefix><Status>Enabled</Status><Expiration><Days>14</Days></Expiration></Rule></LifecycleConfiguration>`;
  assert.deepEqual(parseLifecycleXml(v1), [
    { id: 'legacy', prefix: 'logs/', expireDays: 14, enabled: true },
  ]);
});

test('a rule the parser cannot express as days-to-expiry is skipped, not half-read', () => {
  // Transitions and date-based expiry exist in S3 and this model does not represent them. Returning a
  // partial rule would let the UI overwrite one it never showed the operator.
  const other = `<LifecycleConfiguration><Rule><ID>to-glacier</ID><Status>Enabled</Status><Transition><Days>1</Days><StorageClass>GLACIER</StorageClass></Transition></Rule></LifecycleConfiguration>`;
  assert.deepEqual(parseLifecycleXml(other), []);
  assert.deepEqual(parseLifecycleXml('not xml at all'), []);
});
