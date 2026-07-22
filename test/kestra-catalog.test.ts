import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizePluginList,
  summarizePluginCatalog,
  findPluginGroup,
  pluginGroupMatches,
  filterPluginGroups,
  normalizePluginSchema,
  normalizeNamespaceList,
  normalizeSecretCatalog,
  normalizeKvList,
  unwrapResults,
  validateNamespaceName,
  validateKvKey,
  validateKvValue,
  validateKvWrite,
  type PluginGroup,
} from '../src/lib/kestra-catalog.ts';

// PURE unit tests: normalize the real Kestra catalog/namespace/secret/KV API envelopes into typed
// rows, and validate the names/keys a write supplies. Fixtures are trimmed copies of responses
// captured LIVE from the deployed engine (2026-07) so the shaping is pinned to real behavior.

// ── fixtures mirroring the live API shapes ────────────────────────────────────────────────────────
const RAW_PLUGINS = [
  {
    name: 'core',
    title: 'core',
    group: 'io.kestra.plugin.core',
    categories: ['CORE'],
    tasks: [
      { cls: 'io.kestra.plugin.core.log.Log', title: 'Emit log entries', description: 'Logs.' },
      {
        cls: 'io.kestra.plugin.core.debug.Echo',
        title: 'Echo (deprecated)',
        description: 'old',
        deprecated: true,
      },
    ],
    triggers: [
      { cls: 'io.kestra.plugin.core.trigger.Schedule', title: 'Schedule', description: 'cron' },
    ],
    conditions: [{ cls: 'io.kestra.plugin.core.condition.OrCondition', title: 'Or', description: '' }],
  },
  {
    name: 'slack',
    title: 'Slack',
    group: 'io.kestra.plugin.notifications.slack',
    categories: ['MESSAGING'],
    tasks: [
      {
        cls: 'io.kestra.plugin.notifications.slack.SlackExecution',
        title: 'Send a Slack message',
        description: 'Post to a channel.',
      },
    ],
    triggers: [],
    conditions: [],
  },
  // dropped: no group id
  { name: 'ghost', title: 'Ghost', tasks: [{ cls: 'x.Y', title: 't', description: '' }] },
  // dropped: empty (no tasks/triggers/conditions)
  { group: 'io.kestra.plugin.empty', name: 'empty', title: 'Empty', tasks: [], triggers: [] },
];

const RAW_SCHEMA = {
  markdown: '---\ntitle: Request\nicon: BIGBASE64BLOB...\n---',
  schema: {
    properties: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Send an HTTP request and capture the response.',
      description: 'Generic HTTP client.',
      required: ['uri'],
      properties: {
        uri: { type: 'string', title: 'The URI to request', description: 'target' },
        body: { type: 'string', title: 'The full body as a string', description: '' },
        allowFailed: { title: 'If true, allow a failed response code', description: 'flag' }, // no type
        headers: { type: 'object', title: 'The headers', description: 'map' },
      },
    },
    outputs: {
      properties: {
        code: { type: 'integer', title: 'The status code', description: 'http code' },
      },
    },
    definitions: {},
  },
};

// ── plugin catalog ────────────────────────────────────────────────────────────────────────────
test('normalizePluginList: keeps groups with actions, drops id-less + empty, sorts by title', () => {
  const groups = normalizePluginList(RAW_PLUGINS);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.title), ['core', 'Slack']); // localeCompare order
  const core = findPluginGroup(groups, 'io.kestra.plugin.core')!;
  assert.equal(core.taskCount, 2);
  assert.equal(core.triggerCount, 1);
  assert.equal(core.conditionCount, 1);
  assert.equal(core.tasks[1].deprecated, true);
  assert.equal(core.tasks[0].deprecated, false);
  assert.deepEqual(core.categories, ['CORE']);
});

test('normalizePluginList: falls back name→group and title→name→group', () => {
  const groups = normalizePluginList([
    { group: 'g.only', tasks: [{ cls: 'g.T', title: '', description: '' }] },
  ]);
  assert.equal(groups[0].name, 'g.only');
  assert.equal(groups[0].title, 'g.only');
});

test('normalizePluginList: non-array / garbage input → empty array', () => {
  assert.deepEqual(normalizePluginList(null), []);
  assert.deepEqual(normalizePluginList('nope'), []);
  assert.deepEqual(normalizePluginList([null, 42, 'x']), []);
});

test('normalizeTypeList (via list): drops types with no cls', () => {
  const groups = normalizePluginList([
    { group: 'g', tasks: [{ title: 'no cls' }, { cls: 'g.Real', title: 'r', description: '' }] },
  ]);
  assert.equal(groups[0].taskCount, 1);
  assert.equal(groups[0].tasks[0].cls, 'g.Real');
});

test('summarizePluginCatalog: sums groups/tasks/triggers/conditions', () => {
  const groups = normalizePluginList(RAW_PLUGINS);
  const s = summarizePluginCatalog(groups);
  assert.deepEqual(s, { groups: 2, tasks: 3, triggers: 1, conditions: 1 });
  assert.deepEqual(summarizePluginCatalog([]), { groups: 0, tasks: 0, triggers: 0, conditions: 0 });
});

test('findPluginGroup: returns null when absent', () => {
  const groups = normalizePluginList(RAW_PLUGINS);
  assert.equal(findPluginGroup(groups, 'nope'), null);
});

test('pluginGroupMatches: matches title, group, category, task cls/title; empty query matches all', () => {
  const groups = normalizePluginList(RAW_PLUGINS);
  const slack = findPluginGroup(groups, 'io.kestra.plugin.notifications.slack')!;
  const core = findPluginGroup(groups, 'io.kestra.plugin.core')!;
  assert.equal(pluginGroupMatches(slack, ''), true); // empty
  assert.equal(pluginGroupMatches(slack, '   '), true); // whitespace-only
  assert.equal(pluginGroupMatches(slack, 'SLACK'), true); // title, case-insensitive
  assert.equal(pluginGroupMatches(slack, 'messaging'), true); // category
  assert.equal(pluginGroupMatches(slack, 'notifications'), true); // group id
  assert.equal(pluginGroupMatches(slack, 'SlackExecution'), true); // task cls
  assert.equal(pluginGroupMatches(core, 'schedule'), true); // trigger title
  assert.equal(pluginGroupMatches(core, 'Or'), true); // condition title
  assert.equal(pluginGroupMatches(slack, 'zzz-none'), false);
});

test('filterPluginGroups: narrows the catalog', () => {
  const groups = normalizePluginList(RAW_PLUGINS);
  assert.deepEqual(filterPluginGroups(groups, 'slack').map((g) => g.title), ['Slack']);
  assert.equal(filterPluginGroups(groups, '').length, 2);
});

// ── plugin schema ────────────────────────────────────────────────────────────────────────────
test('normalizePluginSchema: extracts title/desc/props/required/outputs, drops markdown', () => {
  const s = normalizePluginSchema('io.kestra.plugin.fs.http.Request', RAW_SCHEMA);
  assert.equal(s.type, 'io.kestra.plugin.fs.http.Request');
  assert.equal(s.title, 'Send an HTTP request and capture the response.');
  assert.equal(s.description, 'Generic HTTP client.');
  assert.deepEqual(s.required, ['uri']);
  assert.equal(s.outputs.length, 1);
  assert.equal(s.outputs[0].name, 'code');
  assert.equal(s.outputs[0].required, false);
  // required property sorts first
  assert.equal(s.properties[0].name, 'uri');
  assert.equal(s.properties[0].required, true);
  // property with no type → '—'
  const allowFailed = s.properties.find((p) => p.name === 'allowFailed')!;
  assert.equal(allowFailed.type, '—');
  assert.equal(allowFailed.required, false);
});

test('normalizePluginSchema: empty/garbage → safe empty schema, title falls back to cls', () => {
  const s = normalizePluginSchema('a.B.C', {});
  assert.equal(s.title, 'a.B.C');
  assert.deepEqual(s.properties, []);
  assert.deepEqual(s.required, []);
  assert.deepEqual(s.outputs, []);
  const s2 = normalizePluginSchema('a.B.C', null);
  assert.deepEqual(s2.properties, []);
});

// ── namespaces ────────────────────────────────────────────────────────────────────────────────
test('normalizeNamespaceList: unwraps {results}, drops id-less, sorts', () => {
  const ns = normalizeNamespaceList({
    results: [{ id: 'offgrid.production' }, { id: 'offgrid.etl' }, { nope: 1 }, { id: '' }],
    total: 4,
  });
  assert.deepEqual(ns.map((n) => n.id), ['offgrid.etl', 'offgrid.production']);
});

test('normalizeNamespaceList: accepts a bare array too', () => {
  assert.deepEqual(normalizeNamespaceList([{ id: 'a' }]).map((n) => n.id), ['a']);
  assert.deepEqual(normalizeNamespaceList(null), []);
});

// ── secrets ───────────────────────────────────────────────────────────────────────────────────
test('normalizeSecretCatalog: keys-only, readOnly honored, sorted', () => {
  const c = normalizeSecretCatalog({ readOnly: true, results: [], total: 0 });
  assert.deepEqual(c, { readOnly: true, keys: [], total: 0 });
  const c2 = normalizeSecretCatalog({
    readOnly: false,
    results: [{ key: 'DB_PASS' }, 'API_KEY', { nope: 1 }],
  });
  assert.equal(c2.readOnly, false);
  assert.deepEqual(c2.keys, ['API_KEY', 'DB_PASS']);
  assert.equal(c2.total, 2); // falls back to keys.length when no numeric total
});

test('normalizeSecretCatalog: missing readOnly defaults to true (safe)', () => {
  assert.equal(normalizeSecretCatalog({ results: [] }).readOnly, true);
  assert.equal(normalizeSecretCatalog(null).readOnly, true);
});

// ── KV ────────────────────────────────────────────────────────────────────────────────────────
test('normalizeKvList: maps rows, drops key-less, sorts, carries dates/version', () => {
  const rows = normalizeKvList([
    {
      namespace: 'offgrid.etl',
      key: 'zeta',
      version: 3,
      creationDate: '2026-07-22T09:00:00Z',
      updateDate: '2026-07-22T09:30:00Z',
    },
    { namespace: 'offgrid.etl', key: 'alpha' },
    { namespace: 'offgrid.etl' }, // no key → dropped
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['alpha', 'zeta']);
  const zeta = rows.find((r) => r.key === 'zeta')!;
  assert.equal(zeta.version, 3);
  assert.equal(zeta.createdAt, '2026-07-22T09:00:00Z');
  assert.equal(zeta.updatedAt, '2026-07-22T09:30:00Z');
  const alpha = rows.find((r) => r.key === 'alpha')!;
  assert.equal(alpha.version, undefined);
  assert.equal(alpha.createdAt, undefined);
});

test('normalizeKvList: non-array → empty', () => {
  assert.deepEqual(normalizeKvList(null), []);
  assert.deepEqual(normalizeKvList({ results: [] }), []); // KV endpoint returns a bare array, not {results}
});

// ── unwrapResults (shared helper) ───────────────────────────────────────────────────────────────
test('unwrapResults: array passthrough, {results} unwrap, else empty', () => {
  assert.deepEqual(unwrapResults([1, 2]), [1, 2]);
  assert.deepEqual(unwrapResults({ results: ['a'] }), ['a']);
  assert.deepEqual(unwrapResults({ nope: 1 }), []);
  assert.deepEqual(unwrapResults(null), []);
});

// ── validators ───────────────────────────────────────────────────────────────────────────────
test('validateNamespaceName: accepts dotted ids, rejects empty/bad-charset/leading-sep/too-long', () => {
  assert.equal(validateNamespaceName('offgrid.etl').ok, true);
  assert.equal(validateNamespaceName('  offgrid.prod-1_x ').ok, true); // trimmed
  assert.equal(validateNamespaceName('').ok, false);
  assert.equal(validateNamespaceName('   ').ok, false);
  assert.equal(validateNamespaceName(42).ok, false);
  assert.equal(validateNamespaceName('.leading').ok, false);
  assert.equal(validateNamespaceName('has space').ok, false);
  assert.equal(validateNamespaceName('has/slash').ok, false);
  assert.equal(validateNamespaceName('a'.repeat(151)).ok, false);
  assert.match(validateNamespaceName('bad space')!.error!, /letters, digits/);
});

test('validateKvKey: charset + length + leading separator', () => {
  assert.equal(validateKvKey('DB_HOST').ok, true);
  assert.equal(validateKvKey('a.b-c_1').ok, true);
  assert.equal(validateKvKey('').ok, false);
  assert.equal(validateKvKey(null).ok, false);
  assert.equal(validateKvKey('-lead').ok, false);
  assert.equal(validateKvKey('../escape').ok, false);
  assert.equal(validateKvKey('a'.repeat(201)).ok, false);
});

test('validateKvValue: non-empty string within bound', () => {
  assert.equal(validateKvValue('x').ok, true);
  assert.equal(validateKvValue('').ok, false);
  assert.equal(validateKvValue(123).ok, false);
  assert.equal(validateKvValue('a'.repeat(100_001)).ok, false);
});

test('validateKvWrite: returns first failure (key before value), else ok', () => {
  assert.equal(validateKvWrite('good', 'val').ok, true);
  assert.match(validateKvWrite('', 'val').error!, /key is required/);
  assert.match(validateKvWrite('good', '').error!, /value is required/);
});
