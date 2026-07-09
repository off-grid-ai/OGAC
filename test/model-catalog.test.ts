import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MODEL_CATALOG,
  MODEL_FAMILIES,
  MODALITIES,
  getModelSpec,
  catalogByFamily,
  catalogByModality,
  filterCatalog,
  mergeFleetServed,
  fleetModelTags,
  type ModelSpec,
} from '../src/lib/model-catalog.ts';

// PURE unit tests for the curated model-spec catalog + fleet-served merge + filter (Task #128).
// No I/O. Grounded in the real fleet SSOT (SERVER_STATE.md / SERVICE_MAP.md) and real published specs.

test('catalog is a non-trivial curated set', () => {
  assert.ok(MODEL_CATALOG.length >= 12, `expected >=12 models, got ${MODEL_CATALOG.length}`);
});

test('every entry carries the full required metadata with valid types', () => {
  for (const m of MODEL_CATALOG) {
    assert.ok(m.id && m.id.trim() === m.id, `id must be a trimmed non-empty string: ${JSON.stringify(m)}`);
    assert.ok(m.name && m.name.length > 0, `name required: ${m.id}`);
    assert.ok(MODEL_FAMILIES.includes(m.family), `family must be known: ${m.id} → ${m.family}`);
    assert.ok(MODALITIES.includes(m.modality), `modality must be known: ${m.id} → ${m.modality}`);
    // contextWindow / paramsB / license are honest nullable — either null OR a valid value.
    assert.ok(
      m.contextWindow === null || (Number.isInteger(m.contextWindow) && m.contextWindow > 0),
      `contextWindow must be null or a positive int (never fabricated): ${m.id}`,
    );
    assert.ok(
      m.paramsB === null || (typeof m.paramsB === 'number' && m.paramsB > 0),
      `paramsB must be null or a positive number: ${m.id}`,
    );
    assert.ok(m.license === null || typeof m.license === 'string', `license null or string: ${m.id}`);
    assert.equal(typeof m.servedOnFleet, 'boolean', `servedOnFleet must be boolean: ${m.id}`);
  }
});

test('ids are unique (case-insensitively)', () => {
  const seen = new Set<string>();
  for (const m of MODEL_CATALOG) {
    const key = m.id.toLowerCase();
    assert.ok(!seen.has(key), `duplicate id: ${m.id}`);
    seen.add(key);
  }
});

test('the four fleet-served models from the SSOT are present and marked servedOnFleet', () => {
  const fleet = ['qwythos-9b', 'gemma-4-e4b', 'qwen3-vl-8b', 'juggernaut-xl'];
  for (const id of fleet) {
    const spec = getModelSpec(id);
    assert.ok(spec, `fleet model missing from catalog: ${id}`);
    assert.equal(spec!.servedOnFleet, true, `fleet model not marked served: ${id}`);
  }
});

test('juggernaut is an image model with no token context window (honest null)', () => {
  const spec = getModelSpec('juggernaut-xl');
  assert.equal(spec!.modality, 'image');
  assert.equal(spec!.contextWindow, null);
});

test('qwythos context window is honestly null (community fine-tune, not publicly fixed)', () => {
  assert.equal(getModelSpec('qwythos-9b')!.contextWindow, null);
});

test('known published context windows are recorded accurately', () => {
  assert.equal(getModelSpec('qwen3-vl-8b')!.contextWindow, 262144); // 256K
  assert.equal(getModelSpec('llama-3.1-8b-instruct')!.contextWindow, 131072); // 128K
  assert.equal(getModelSpec('gemma-2-9b-it')!.contextWindow, 8192); // 8K
  assert.equal(getModelSpec('mistral-7b-instruct')!.contextWindow, 32768); // 32K
});

test('getModelSpec is case-insensitive and trims', () => {
  assert.ok(getModelSpec('  QWEN3-VL-8B  '));
  assert.equal(getModelSpec('nope'), undefined);
});

test('cloud flagship models: DeepSeek + GLM specs are present with real metadata', () => {
  const dsChat = getModelSpec('deepseek-chat');
  const dsReason = getModelSpec('deepseek-reasoner');
  assert.equal(dsChat?.family, 'DeepSeek');
  assert.equal(dsChat?.contextWindow, 131072); // 128K per DeepSeek API docs
  assert.equal(dsReason?.family, 'DeepSeek');
  assert.equal(dsReason?.contextWindow, 131072);

  const glm46 = getModelSpec('glm-4.6');
  const glm52 = getModelSpec('glm-5.2');
  assert.equal(glm46?.family, 'GLM');
  assert.equal(glm46?.contextWindow, 200000); // 200K per Z.AI GLM-4.6
  assert.equal(glm46?.license, 'MIT');
  assert.equal(glm52?.family, 'GLM');
  assert.equal(glm52?.contextWindow, 1000000); // 1M per Z.AI GLM-5.2
  // GLM is a real, grouped family in the picker.
  const glmGroup = catalogByFamily().find((g) => g.family === 'GLM');
  assert.ok(glmGroup && glmGroup.models.length >= 2);
});

test('catalog covers multiple families and modalities', () => {
  const families = new Set(MODEL_CATALOG.map((m) => m.family));
  assert.ok(families.size >= 4, `expected >=4 families, got ${families.size}`);
  const modalities = new Set(MODEL_CATALOG.map((m) => m.modality));
  assert.ok(modalities.has('text'));
  assert.ok(modalities.has('vision'));
  assert.ok(modalities.has('image'));
  assert.ok(modalities.has('embedding'));
});

test('catalogByFamily preserves order and drops empty groups', () => {
  const groups = catalogByFamily();
  const order = groups.map((g) => g.family);
  // Order is a subsequence of MODEL_FAMILIES.
  let i = 0;
  for (const f of MODEL_FAMILIES) {
    if (order[i] === f) i++;
  }
  assert.equal(i, order.length, 'families out of MODEL_FAMILIES order');
  for (const g of groups) assert.ok(g.models.length > 0, 'empty group not dropped');
  const total = groups.reduce((n, g) => n + g.models.length, 0);
  assert.equal(total, MODEL_CATALOG.length, 'every model appears in exactly one family group');
});

test('catalogByModality groups every model exactly once', () => {
  const groups = catalogByModality();
  const total = groups.reduce((n, g) => n + g.models.length, 0);
  assert.equal(total, MODEL_CATALOG.length);
});

test('filterCatalog: fleetOnly returns only served models', () => {
  const out = filterCatalog(MODEL_CATALOG, { fleetOnly: true });
  assert.ok(out.length >= 4);
  assert.ok(out.every((m) => m.servedOnFleet));
});

test('filterCatalog: family + modality AND together', () => {
  const out = filterCatalog(MODEL_CATALOG, { family: 'Qwen', modality: 'text' });
  assert.ok(out.length > 0);
  assert.ok(out.every((m) => m.family === 'Qwen' && m.modality === 'text'));
});

test('filterCatalog: query matches id/name/family, case-insensitive', () => {
  assert.ok(filterCatalog(MODEL_CATALOG, { query: 'LLAMA' }).every((m) => m.family === 'Llama'));
  assert.ok(filterCatalog(MODEL_CATALOG, { query: 'juggernaut' }).length === 1);
  assert.equal(filterCatalog(MODEL_CATALOG, { query: 'zzz-nope' }).length, 0);
});

test('filterCatalog: empty filter returns the whole catalog', () => {
  assert.equal(filterCatalog(MODEL_CATALOG, {}).length, MODEL_CATALOG.length);
});

// ─── mergeFleetServed — the LIVE-SSOT reconciliation ──────────────────────────────────────────
test('mergeFleetServed: only live tags are marked served; stale static claims are cleared', () => {
  // Live fleet serves only qwen3-vl-8b + gemma-4-e4b right now (qwythos/juggernaut down).
  const merged = mergeFleetServed(MODEL_CATALOG, ['qwen3-vl-8b', 'gemma-4-e4b']);
  assert.equal(getModelSpec('qwen3-vl-8b', merged)!.servedOnFleet, true);
  assert.equal(getModelSpec('gemma-4-e4b', merged)!.servedOnFleet, true);
  // These are static-catalog "served" entries but NOT in the live set → forced false (no lying).
  assert.equal(getModelSpec('qwythos-9b', merged)!.servedOnFleet, false);
  assert.equal(getModelSpec('juggernaut-xl', merged)!.servedOnFleet, false);
});

test('mergeFleetServed: a live tag with no catalog entry is appended honestly (specs null)', () => {
  const merged = mergeFleetServed(MODEL_CATALOG, ['some-new-model-13b']);
  const added = getModelSpec('some-new-model-13b', merged);
  assert.ok(added, 'unknown live tag not surfaced');
  assert.equal(added!.servedOnFleet, true);
  assert.equal(added!.contextWindow, null);
  assert.equal(added!.paramsB, null);
  assert.equal(added!.family, 'Other');
});

test('mergeFleetServed: blank tags are ignored and matching is case-insensitive', () => {
  const merged = mergeFleetServed(MODEL_CATALOG, ['', '  ', 'QWEN3-VL-8B']);
  assert.equal(getModelSpec('qwen3-vl-8b', merged)!.servedOnFleet, true);
  // No blank/whitespace entry got appended.
  assert.ok(merged.every((m) => m.id.trim().length > 0));
});

test('mergeFleetServed: does not mutate the input catalog', () => {
  const before = MODEL_CATALOG.map((m) => m.servedOnFleet);
  mergeFleetServed(MODEL_CATALOG, []);
  const after = MODEL_CATALOG.map((m) => m.servedOnFleet);
  assert.deepEqual(after, before);
});

// ─── fleetModelTags — distinct serving tags from fleet-node rows ───────────────────────────────
test('fleetModelTags: dedupes, drops blanks, skips server nodes, keeps original case', () => {
  const nodes: { model: string; role?: string }[] = [
    { model: 'qwythos-9b', role: 'gateway' },
    { model: 'qwythos-9b', role: 'gateway' }, // dup
    { model: 'gemma-4-e4b', role: 'gateway' },
    { model: '', role: 'server' }, // infra node
    { model: 'juggernaut-xl', role: 'image' },
  ];
  const tags = fleetModelTags(nodes);
  assert.deepEqual(tags.sort(), ['gemma-4-e4b', 'juggernaut-xl', 'qwythos-9b']);
});

test('fleetModelTags feeds mergeFleetServed end-to-end', () => {
  const nodes = [
    { model: 'qwen3-vl-8b', role: 'gateway' },
    { model: 'gemma-4-e4b', role: 'gateway' },
    { model: '', role: 'server' },
  ];
  const merged = mergeFleetServed(MODEL_CATALOG, fleetModelTags(nodes));
  const served = merged.filter((m: ModelSpec) => m.servedOnFleet).map((m) => m.id).sort();
  assert.deepEqual(served, ['gemma-4-e4b', 'qwen3-vl-8b']);
});
