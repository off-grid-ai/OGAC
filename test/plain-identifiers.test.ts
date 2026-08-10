// The strings below are verbatim from a copilot answer shown to a demo viewer on 2026-08-06: asked
// what stops a bad answer reaching a customer, they were told it was blocked "by proof:ceiling on
// org_suraksha". Every word true, none of it usable.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  plainAction,
  plainOrg,
  plainRefs,
  publicActionLabel,
  stripOrgIds,
} from '@/lib/plain-identifiers';
import { leaksInternalName } from '@/lib/lineage-labels';

test('an action code becomes a phrase', () => {
  assert.equal(plainAction('pipeline.data.deny'), 'pipeline data refused');
  assert.equal(plainAction('app.run.report'), 'app run report');
  assert.equal(plainAction('access.machine.rotate'), 'access machine rotated');
  assert.equal(plainAction('device.kill'), 'device stopped');
  assert.equal(plainAction('data.erasure'), 'data erased');
});

test('an unlisted verb keeps its own word rather than getting an invented synonym', () => {
  // A wrong explanation of a governance event is far worse than a plain one, so anything not in the
  // short list is simply un-dotted.
  assert.equal(plainAction('claim.disposition.write'), 'claim disposition written');
  assert.equal(plainAction('some.brand.new.action'), 'some brand new action');
});

test('an empty or malformed action yields nothing, not the word "undefined"', () => {
  for (const v of [null, undefined, '', '  ', '...']) assert.equal(plainAction(v), '');
});

test('an org identifier never reaches the reader', () => {
  // Naming the tenant to itself adds nothing, and "on org_suraksha" invites the question of whose
  // other orgs are in there.
  assert.equal(plainOrg('org_suraksha'), 'this organisation');
  assert.equal(plainOrg('org_bharat'), 'this organisation');
  assert.equal(plainOrg('default'), 'this organisation');
  assert.equal(plainOrg(''), '');
});

test('a real project name is left alone — it is the customer\'s own word', () => {
  assert.equal(plainOrg('Claims Automation'), 'Claims Automation');
  assert.equal(plainOrg('renewals'), 'renewals');
});

test('a machine reference loses its colon', () => {
  assert.equal(plainRefs('blocked by proof:ceiling'), 'blocked by proof ceiling');
  assert.equal(plainRefs('guardrail:pii and injection:pass'), 'guardrail pii and injection pass');
});

test('a colon that is not a machine reference survives', () => {
  // A time, a URL and ordinary punctuation all contain colons; mangling those would trade one
  // unreadable answer for another.
  assert.equal(plainRefs('at 09:30 today'), 'at 09:30 today');
  assert.equal(plainRefs('see https://example.com/x'), 'see https://example.com/x');
  assert.equal(plainRefs('Note: this is fine'), 'Note: this is fine');
  assert.equal(plainRefs('Rationale: the premium'), 'Rationale: the premium');
});

test('the sentence that shipped comes out readable', () => {
  const shipped = 'pipeline.data.deny by proof:ceiling on org_suraksha';
  const fixed = `${plainAction('pipeline.data.deny')} by ${plainRefs('proof:ceiling')} in ${plainOrg('org_suraksha')}`;
  assert.notEqual(fixed, shipped);
  assert.equal(fixed, 'pipeline data refused by proof ceiling in this organisation');
  assert.ok(!/[a-z]+\.[a-z]+|org_|:[a-z]/.test(fixed), 'no machine syntax may survive');
});

test('an org id buried inside an identifier is removed, and the id stays usable', () => {
  // The shape that survived two rounds of fixing: the audit trail's resource column read
  // `pipeline:pl_seed_org_suraksha_fraud-screening`. plainOrg handles a whole field and could not see
  // it; publicLabel's vocabulary is engine names, so it could not either.
  assert.equal(
    stripOrgIds('pipeline:pl_seed_org_suraksha_fraud-screening'),
    'pipeline:pl_seed_fraud-screening',
  );
  assert.equal(stripOrgIds('app_org_bharat'), 'app');
  assert.equal(stripOrgIds('scoped to org_suraksha today'), 'scoped to this organisation today');
});

test('an identifier with no org in it is untouched', () => {
  for (const v of ['pl_seed_fraud-screening', 'agent:agent_c6ac38cb', 'apprun_eee51b30', '']) {
    assert.equal(stripOrgIds(v), v);
  }
});

test('the audit resource string comes out with no org id at all', () => {
  // The closing assertion, on the real value read off the rendered page.
  const shipped = 'model:agent:agent_c6ac38cb pipeline:pl_seed_org_suraksha_fraud-screening';
  const out = plainRefs(stripOrgIds(shipped));
  assert.doesNotMatch(out, /org_[a-z]/i, out);
  assert.match(out, /fraud-screening/, 'the reference is still recognisable');
});

test('an action code is made safe AND readable — each mapper alone is not enough', () => {
  // 'data.airbyte.schedule' reached the regulatory page and the audit filter dropdown. plainAction
  // fixes the syntax and knows nothing about vocabulary, so the engine name walked through it;
  // publicLabel fixes the vocabulary and knows nothing about dots. Composed they produce a repeated
  // word, because the replacement starts with a word the code already had.
  assert.equal(publicActionLabel('data.airbyte.schedule'), 'data movement schedule');
  assert.doesNotMatch(publicActionLabel('data.airbyte.schedule'), /airbyte/i);
});

test('no action code we ship leaks an engine name through the composed label', () => {
  const CODES = [
    'data.airbyte.schedule', 'brain.ingest', 'guardrail.change', 'pipeline.data.deny',
    'gateway.egress.dlp', 'access.machine.rotate', 'policy.decision-log.ingest', 'backup.run',
  ];
  for (const c of CODES) {
    const out = publicActionLabel(c);
    assert.ok(!leaksInternalName(out), `${c} → ${out}`);
    assert.doesNotMatch(out, /\./, `${c} → ${out} still reads as a machine code`);
  }
});
