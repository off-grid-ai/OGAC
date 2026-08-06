// The seventh cross-tenant leak of the same class, and the test that pins it shut.
//
// LIVE FINDING (2026-08-05): the bank's `bhcon_corebank:claims` dataset and a "Credit card upsell
// policy" job both rendered on the INSURER's /data/lineage/graph. Lineage lives in a single shared
// Marquez namespace with no tenant dimension, and both readers fetched all of it.
//
// The hard part is not the filter, it is that a lineage node carries NO owner marker — measured on the
// live graph, every dataset returns `tags: []` and no facets. Ownership has to be inferred from the
// NAME and resolved against our own tables, so these tests care most about the parsing being strict:
// a name we cannot confidently attribute must belong to nobody, because the failure mode of a lenient
// guess is silent disclosure rather than a visible error.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterLineageEdges,
  filterLineageNodes,
  lineageRef,
  NO_LINEAGE_KEYS,
  ownsLineageNode,
  type OwnedLineageKeys,
} from '@/lib/lineage-tenancy';

const insurer: OwnedLineageKeys = {
  runs: new Set(['run_008ec4f1']),
  chatRuns: new Set(['chatrun_6b9b88d9']),
  agents: new Set(['agent_c6ac38cb']),
  chats: new Set(['conv_proof_msektf9o']),
  connectors: new Set(['surcon_coreins', 'surcon_policyadmin']),
};

test('every real name shape on the live graph is parsed to the right entity', () => {
  assert.deepEqual(lineageRef('run_008ec4f1'), { kind: 'run', id: 'run_008ec4f1' });
  assert.deepEqual(lineageRef('chatrun_6b9b88d9'), { kind: 'chatrun', id: 'chatrun_6b9b88d9' });
  assert.deepEqual(lineageRef('agent:agent_c6ac38cb'), { kind: 'agent', id: 'agent_c6ac38cb' });
  assert.deepEqual(lineageRef('chat:conv_proof_msektf9o'), {
    kind: 'chat',
    id: 'conv_proof_msektf9o',
  });
  assert.deepEqual(lineageRef('surcon_coreins:premiums'), {
    kind: 'connector',
    id: 'surcon_coreins',
  });
  assert.deepEqual(lineageRef('bhcon_corebank:claims'), { kind: 'connector', id: 'bhcon_corebank' });
});

test('a name we cannot attribute is UNKNOWN, and unknown belongs to nobody', () => {
  // These are the actual prose-named nodes on the live graph — and the ones the audit caught leaking.
  for (const name of [
    'Credit card upsell policy',
    'Home Loan top-up eligibility',
    'Premier Savings cross-sell rules',
    'Knowledge base (Brain)',
    'Connectors (declared data-domains)',
    'SOP',
    'retrieval-result',
    '',
    '   ',
    undefined,
    null,
  ]) {
    assert.equal(lineageRef(name).kind, 'unknown', `${JSON.stringify(name)} should be unknown`);
    assert.equal(ownsLineageNode(name, insurer), false, `${JSON.stringify(name)} must belong to nobody`);
  }
});

test("the bank's dataset does not belong to the insurer — the leak, stated directly", () => {
  assert.equal(ownsLineageNode('bhcon_corebank:claims', insurer), false);
  assert.equal(ownsLineageNode('surcon_coreins:premiums', insurer), true);
});

test('an unrecognised prefix is not treated as a connector', () => {
  // Guards the shape-matched connector rule from becoming a catch-all: `foo:bar` must not be read as
  // "connector foo owns this", or every prose name containing a colon becomes attributable.
  assert.equal(lineageRef('pipeline:something').kind, 'unknown');
  assert.equal(lineageRef('Revenue: Q3 forecast').kind, 'unknown');
  assert.equal(lineageRef('agent:').kind, 'unknown', 'a prefix with no id is not an entity');
});

test('an org that owns nothing sees nothing', () => {
  const names = ['run_008ec4f1', 'agent:agent_c6ac38cb', 'surcon_coreins:premiums'];
  for (const n of names) assert.equal(ownsLineageNode(n, NO_LINEAGE_KEYS), false);
  // This is also the failure posture: the ownership lookup returns NO_LINEAGE_KEYS when the database
  // read fails, so a hiccup empties the graph rather than widening the boundary.
  assert.deepEqual(filterLineageNodes(names.map((name) => ({ name })), NO_LINEAGE_KEYS), []);
});

test('filtering keeps only owned nodes', () => {
  const nodes = [
    { name: 'run_008ec4f1' },
    { name: 'bhcon_corebank:claims' },
    { name: 'Credit card upsell policy' },
    { name: 'surcon_policyadmin:employee_quota' },
  ];
  assert.deepEqual(
    filterLineageNodes(nodes, insurer).map((n) => n.name),
    ['run_008ec4f1', 'surcon_policyadmin:employee_quota'],
  );
});

test('an edge touching a hidden node is dropped, not left dangling', () => {
  // This is the subtle half of the leak: an edge naming `bhcon_corebank:claims` discloses that
  // dataset's existence — and the bank's table name — even after the node itself is filtered out.
  const visible = new Set(['run_008ec4f1', 'agent:agent_c6ac38cb']);
  const edges = [
    { from: 'agent:agent_c6ac38cb', to: 'run_008ec4f1', kind: 'output' as const },
    { from: 'bhcon_corebank:claims', to: 'agent:agent_c6ac38cb', kind: 'input' as const },
    { from: 'agent:agent_c6ac38cb', to: 'Credit card upsell policy', kind: 'output' as const },
  ];
  assert.deepEqual(filterLineageEdges(edges, visible), [
    { from: 'agent:agent_c6ac38cb', to: 'run_008ec4f1', kind: 'output' },
  ]);
});

test('the two tenants get disjoint views of the same graph', () => {
  const bank: OwnedLineageKeys = {
    ...NO_LINEAGE_KEYS,
    connectors: new Set(['bhcon_corebank']),
  };
  const shared = [{ name: 'surcon_coreins:premiums' }, { name: 'bhcon_corebank:claims' }];
  const forInsurer = filterLineageNodes(shared, insurer).map((n) => n.name);
  const forBank = filterLineageNodes(shared, bank).map((n) => n.name);
  assert.deepEqual(forInsurer, ['surcon_coreins:premiums']);
  assert.deepEqual(forBank, ['bhcon_corebank:claims']);
  assert.equal(forInsurer.some((n) => forBank.includes(n)), false, 'no node appears in both views');
});
