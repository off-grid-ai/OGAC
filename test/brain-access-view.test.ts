import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  capabilityRows,
  describeBrainAccess,
  parseBrainGrants,
} from '../src/lib/brain-access-view.ts';

// The fixture is the policy actually deployed on the box (OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY),
// which is why a viewer's memory search is refused: only `admin` holds `retrieve` on this tenant.
const DEPLOYED = [
  {
    tenantId: 'org_bharat',
    roles: ['admin'],
    documentSetSlugs: ['organizational-brain'],
    capabilities: ['retrieve', 'ingest', 'manageSources'],
    ingestionConnectionId: 1,
  },
];

test('the deployed policy parses, and explains the refusal a viewer actually saw', () => {
  const { grants, dropped } = parseBrainGrants(DEPLOYED, 'org_bharat');
  assert.equal(dropped, 0);
  assert.equal(grants.length, 1);
  const rows = capabilityRows(grants);
  const retrieve = rows.find((r) => r.capability === 'retrieve');
  assert.deepEqual(retrieve?.holders, ['admin (role)']);
  assert.match(describeBrainAccess(rows, grants, dropped), /Search access is held by admin \(role\)/);
});

test('another tenant’s grant is never shown here', () => {
  const { grants } = parseBrainGrants(DEPLOYED, 'org_suraksha');
  assert.deepEqual(grants, []);
  // And with no grants the sentence says nobody can use it — not that access is unrestricted.
  assert.match(describeBrainAccess([], grants, 0), /nobody can search or add/);
});

test('EVERY capability is listed, including ones nobody holds', () => {
  const readOnly = [{ ...DEPLOYED[0], capabilities: ['retrieve'] }];
  const rows = capabilityRows(parseBrainGrants(readOnly, 'org_bharat').grants);
  assert.equal(rows.length, 3);
  const ingest = rows.find((r) => r.capability === 'ingest');
  assert.equal(ingest?.nobody, true);
  // An omitted row would read as "not applicable" when the truth is the memory cannot grow.
  assert.deepEqual(ingest?.holders, []);
});

test('named subjects and roles are merged and labelled distinctly', () => {
  const mixed = [
    { ...DEPLOYED[0], roles: ['admin'], subjectIds: ['dpo@bank.example'], capabilities: ['retrieve'] },
  ];
  const rows = capabilityRows(parseBrainGrants(mixed, 'org_bharat').grants);
  const retrieve = rows.find((r) => r.capability === 'retrieve');
  assert.deepEqual(retrieve?.holders, ['admin (role)', 'dpo@bank.example']);
});

test('an unreadable entry is reported, not silently dropped or counted as a grant', () => {
  const withJunk = [DEPLOYED[0], null, 'nope', { roles: ['x'] }];
  const { grants, dropped } = parseBrainGrants(withJunk, 'org_bharat');
  assert.equal(grants.length, 1);
  assert.equal(dropped, 3);
  const s = describeBrainAccess(capabilityRows(grants), grants, dropped);
  assert.match(s, /3 policy entries were unreadable/);
});

test('an unknown capability string is ignored rather than shown as a capability', () => {
  const bogus = [{ ...DEPLOYED[0], capabilities: ['retrieve', 'deleteEverything'] }];
  const { grants } = parseBrainGrants(bogus, 'org_bharat');
  assert.deepEqual(grants[0].capabilities, ['retrieve']);
});

test('a policy that grants nobody search says the search surface will refuse everything', () => {
  const noRetrieve = [{ ...DEPLOYED[0], capabilities: ['ingest'] }];
  const { grants } = parseBrainGrants(noRetrieve, 'org_bharat');
  const s = describeBrainAccess(capabilityRows(grants), grants, 0);
  assert.match(s, /refuse every request/);
});

test('all entries unreadable blames the policy, not the people', () => {
  const { grants, dropped } = parseBrainGrants([null, 5], 'org_bharat');
  const s = describeBrainAccess(capabilityRows(grants), grants, dropped);
  assert.match(s, /unreadable/);
  assert.match(s, /broken policy/);
});

test('a non-array policy is no grants, without throwing', () => {
  for (const bad of [null, undefined, 'x', 42, {}]) {
    assert.deepEqual(parseBrainGrants(bad, 'org_bharat'), { grants: [], dropped: 0 });
  }
});
