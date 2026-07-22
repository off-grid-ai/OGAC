import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  epochMsToIso,
  isPluginUnsupported,
  mergeDetectorAlerts,
  parseAliases,
  parseDetectorAlerts,
  parseDetectors,
  parseIndexTemplates,
} from '../src/lib/opensearch-admin.ts';

// Pure response shaping for the OpenSearch index-admin + security-analytics surfaces. No network, no
// mocks — representative OpenSearch JSON in, asserted summaries out. Exercises the real parsers plus
// the edge cases (missing pieces, flattened vs nested settings, system aliases, empty envelopes).

// ── epochMsToIso ─────────────────────────────────────────────────────────────────────────────────

test('epochMsToIso: number, numeric string, and non-values', () => {
  assert.equal(epochMsToIso(1700000000000), new Date(1700000000000).toISOString());
  assert.equal(epochMsToIso('1700000000000'), new Date(1700000000000).toISOString());
  assert.equal(epochMsToIso(0), null, 'zero → null');
  assert.equal(epochMsToIso(-5), null, 'negative → null');
  assert.equal(epochMsToIso(undefined), null);
  assert.equal(epochMsToIso('nope'), null);
  assert.equal(epochMsToIso(''), null);
});

// ── re-export DRY ────────────────────────────────────────────────────────────────────────────────

test('isPluginUnsupported is re-exported from the shape module (single source of truth)', () => {
  assert.equal(isPluginUnsupported(404, ''), true);
  assert.equal(isPluginUnsupported(200, 'no handler found'), true);
  assert.equal(isPluginUnsupported(500, 'boom'), false);
});

// ── parseIndexTemplates ────────────────────────────────────────────────────────────────────────

test('parseIndexTemplates: flattens nested settings, mappings, rollover alias, data stream', () => {
  const out = parseIndexTemplates({
    index_templates: [
      {
        name: 'offgrid-audit-template',
        index_template: {
          index_patterns: ['offgrid-audit*', ''],
          priority: 100,
          composed_of: ['comp-a', 'comp-b'],
          template: {
            settings: {
              index: {
                number_of_shards: '2',
                number_of_replicas: 1,
                plugins: { index_state_management: { rollover_alias: 'offgrid-audit' } },
              },
            },
            mappings: { properties: { ts: {}, actorId: {}, action: {} } },
          },
        },
      },
    ],
  });
  assert.equal(out.length, 1);
  const t = out[0];
  assert.equal(t.name, 'offgrid-audit-template');
  assert.deepEqual(t.indexPatterns, ['offgrid-audit*'], 'empty pattern filtered');
  assert.equal(t.priority, 100);
  assert.equal(t.numberOfShards, 2, 'numeric string coerced');
  assert.equal(t.numberOfReplicas, 1);
  assert.equal(t.mappedFields, 3);
  assert.deepEqual(t.composedOf, ['comp-a', 'comp-b']);
  assert.equal(t.rolloverAlias, 'offgrid-audit');
  assert.equal(t.dataStream, false);
});

test('parseIndexTemplates: FLATTENED dotted setting keys + data stream + missing pieces', () => {
  const out = parseIndexTemplates({
    index_templates: [
      {
        name: 'ds-template',
        index_template: {
          index_patterns: ['logs-*'],
          data_stream: {},
          template: {
            settings: {
              'index.number_of_shards': 3,
              'index.plugins.index_state_management.rollover_alias': 'logs',
            },
          },
        },
      },
      {
        name: 'bare',
        index_template: {},
      },
    ],
  });
  const ds = out.find((t) => t.name === 'ds-template')!;
  assert.equal(ds.numberOfShards, 3, 'flattened dotted key read');
  assert.equal(ds.rolloverAlias, 'logs', 'flattened rollover alias read');
  assert.equal(ds.dataStream, true);
  const bare = out.find((t) => t.name === 'bare')!;
  assert.deepEqual(bare.indexPatterns, []);
  assert.equal(bare.priority, null);
  assert.equal(bare.numberOfShards, null);
  assert.equal(bare.numberOfReplicas, null);
  assert.equal(bare.mappedFields, 0);
  assert.deepEqual(bare.composedOf, []);
  assert.equal(bare.rolloverAlias, null);
  assert.equal(bare.dataStream, false);
});

test('parseIndexTemplates: name-sorted; null/empty envelope → []', () => {
  const out = parseIndexTemplates({
    index_templates: [
      { name: 'zeta', index_template: {} },
      { name: 'alpha', index_template: {} },
    ],
  });
  assert.deepEqual(
    out.map((t) => t.name),
    ['alpha', 'zeta'],
  );
  assert.deepEqual(parseIndexTemplates(null), []);
  assert.deepEqual(parseIndexTemplates(undefined), []);
  assert.deepEqual(parseIndexTemplates({}), []);
});

// ── parseAliases ─────────────────────────────────────────────────────────────────────────────────

test('parseAliases: inverts index→alias to alias→indices, marks write index + system aliases', () => {
  const out = parseAliases({
    'offgrid-audit-000002': { aliases: { 'offgrid-audit': { is_write_index: true } } },
    'offgrid-audit-000001': { aliases: { 'offgrid-audit': { is_write_index: false } } },
    '.opensearch-observability': { aliases: { '.kibana_task': {} } },
    'orphan-index': { aliases: {} },
    'no-aliases-key': {},
  });
  const audit = out.find((a) => a.alias === 'offgrid-audit')!;
  assert.equal(audit.members.length, 2);
  // members sorted by index name
  assert.deepEqual(
    audit.members.map((m) => m.index),
    ['offgrid-audit-000001', 'offgrid-audit-000002'],
  );
  assert.equal(audit.members.find((m) => m.index === 'offgrid-audit-000002')!.isWriteIndex, true);
  assert.equal(audit.members.find((m) => m.index === 'offgrid-audit-000001')!.isWriteIndex, false);
  assert.equal(audit.system, false);

  const sys = out.find((a) => a.alias === '.kibana_task')!;
  assert.equal(sys.system, true);
  assert.equal(sys.members[0].isWriteIndex, false, 'missing is_write_index → false');

  // aliases are alpha-sorted; orphan/no-alias indices produce no alias entries
  assert.deepEqual(
    out.map((a) => a.alias),
    ['.kibana_task', 'offgrid-audit'],
  );
});

test('parseAliases: null/empty → []', () => {
  assert.deepEqual(parseAliases(null), []);
  assert.deepEqual(parseAliases(undefined), []);
  assert.deepEqual(parseAliases({}), []);
});

// ── parseDetectors ───────────────────────────────────────────────────────────────────────────────

test('parseDetectors: flattens source, counts rules + triggers, name-sorted', () => {
  const out = parseDetectors({
    hits: {
      hits: [
        {
          _id: 'det-2',
          _source: {
            name: 'zeta-detector',
            enabled: false,
            detector_type: 'network',
            inputs: [{ detector_input: { indices: ['offgrid-gateway*'], custom_rules: [{ id: 'r1' }] } }],
            triggers: [{ name: 't1' }, { name: 't2' }],
            last_update_time: 1700000000000,
          },
        },
        {
          _id: 'det-1',
          _source: {
            name: 'alpha-detector',
            enabled: true,
            detector_type: 'windows',
            inputs: [
              {
                detector_input: {
                  indices: ['offgrid-audit*', ''],
                  custom_rules: [{ id: 'c1' }, { id: 'c2' }],
                  pre_packaged_rules: [{ id: 'p1' }],
                },
              },
            ],
            triggers: [{ name: 't1' }],
          },
        },
      ],
    },
  });
  assert.deepEqual(
    out.map((d) => d.name),
    ['alpha-detector', 'zeta-detector'],
    'name-sorted',
  );
  const alpha = out[0];
  assert.equal(alpha.id, 'det-1');
  assert.equal(alpha.enabled, true);
  assert.equal(alpha.detectorType, 'windows');
  assert.deepEqual(alpha.indices, ['offgrid-audit*'], 'empty index filtered');
  assert.equal(alpha.customRuleCount, 2);
  assert.equal(alpha.prePackagedRuleCount, 1);
  assert.equal(alpha.triggerCount, 1);
  assert.equal(alpha.lastUpdate, null, 'missing last_update_time → null');
  assert.equal(alpha.activeAlerts, 0);
  assert.equal(alpha.acknowledgedAlerts, 0);

  const zeta = out[1];
  assert.equal(zeta.enabled, false);
  assert.equal(zeta.customRuleCount, 1);
  assert.equal(zeta.prePackagedRuleCount, 0, 'no pre_packaged_rules → 0');
  assert.equal(zeta.triggerCount, 2);
  assert.equal(zeta.lastUpdate, new Date(1700000000000).toISOString());
});

test('parseDetectors: missing inputs / envelope tolerant', () => {
  const out = parseDetectors({ hits: { hits: [{ _id: 'x', _source: { name: 'bare' } }] } });
  assert.equal(out[0].detectorType, '');
  assert.deepEqual(out[0].indices, []);
  assert.equal(out[0].triggerCount, 0);
  assert.deepEqual(parseDetectors(null), []);
  assert.deepEqual(parseDetectors({}), []);
  assert.deepEqual(parseDetectors({ hits: {} }), []);
});

// ── parseDetectorAlerts + mergeDetectorAlerts ────────────────────────────────────────────────────

test('parseDetectorAlerts: tallies ACTIVE + ACKNOWLEDGED per detector, both key styles', () => {
  const counts = parseDetectorAlerts({
    alerts: [
      { detector_id: 'det-1', state: 'ACTIVE' },
      { detector_id: 'det-1', state: 'active' },
      { detector_id: 'det-1', state: 'ACKNOWLEDGED' },
      { detectorId: 'det-2', state: 'COMPLETED' },
      { detector_id: 'det-2', state: 'ERROR' },
      { state: 'ACTIVE' }, // no id → skipped
    ],
  });
  assert.deepEqual(counts.get('det-1'), { active: 2, acknowledged: 1 });
  assert.deepEqual(counts.get('det-2'), { active: 0, acknowledged: 0 }, 'seen but no active/ack');
  assert.equal(counts.has(''), false, 'idless alert skipped');
});

test('parseDetectorAlerts: null/empty → empty map', () => {
  assert.equal(parseDetectorAlerts(null).size, 0);
  assert.equal(parseDetectorAlerts({}).size, 0);
  assert.equal(parseDetectorAlerts({ alerts: [] }).size, 0);
});

test('mergeDetectorAlerts: joins counts onto matching detectors, leaves others at zero', () => {
  const detectors = parseDetectors({
    hits: { hits: [{ _id: 'det-1', _source: { name: 'a' } }, { _id: 'det-9', _source: { name: 'b' } }] },
  });
  const merged = mergeDetectorAlerts(detectors, new Map([['det-1', { active: 3, acknowledged: 1 }]]));
  const a = merged.find((d) => d.id === 'det-1')!;
  assert.equal(a.activeAlerts, 3);
  assert.equal(a.acknowledgedAlerts, 1);
  const b = merged.find((d) => d.id === 'det-9')!;
  assert.equal(b.activeAlerts, 0, 'unmatched detector stays at zero');
  assert.equal(b.acknowledgedAlerts, 0);
  // non-mutating
  assert.equal(detectors.find((d) => d.id === 'det-1')!.activeAlerts, 0);
});
