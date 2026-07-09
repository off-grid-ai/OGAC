import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GUARDRAIL_CATALOG,
  GUARDRAIL_CATEGORIES,
  REGEX_FLOOR_ENTITIES,
  ENABLE_ACTIONS,
  getGuardrailItem,
  catalogByCategory,
  filterCatalog,
  isFilterActive,
  itemAvailability,
  buildEnablePayload,
  isItemEnabled,
} from '../src/lib/guardrails-catalog.ts';

// PURE unit tests for the standard GUARDRAILS catalog + availability + enable-payload builder
// (Builder Epic #124). No I/O. Grounded in real Presidio entities + real Guardrails-AI validators.

// ─── Catalog integrity ──────────────────────────────────────────────────────────────────────────
test('catalog is a non-trivial curated set', () => {
  assert.ok(GUARDRAIL_CATALOG.length >= 20, `expected >=20, got ${GUARDRAIL_CATALOG.length}`);
});

test('every item carries the full required metadata', () => {
  for (const i of GUARDRAIL_CATALOG) {
    assert.ok(i.id, 'id');
    assert.ok(i.name, `name for ${i.id}`);
    assert.ok(GUARDRAIL_CATEGORIES.includes(i.category), `valid category for ${i.id}`);
    assert.ok(
      i.kind === 'presidio-entity' ||
        i.kind === 'guardrails-validator' ||
        i.kind === 'llm-guard-scanner',
      `kind ${i.id}`,
    );
    assert.ok(
      i.engine === 'presidio' || i.engine === 'guardrails-ai' || i.engine === 'llm-guard',
      `engine ${i.id}`,
    );
    // An llm-guard-scanner item names the exact LLM Guard scanner class it enforces.
    if (i.kind === 'llm-guard-scanner') {
      assert.ok(i.scanner && /^[A-Z][A-Za-z]+$/.test(i.scanner), `scanner class for ${i.id}`);
      assert.equal(i.engine, 'llm-guard', `llm-guard engine for ${i.id}`);
    }
    assert.ok(i.description.length > 10, `description for ${i.id}`);
    assert.equal(typeof i.defaultEnabled, 'boolean', `defaultEnabled for ${i.id}`);
    // entity is a stable UPPER_SNAKE token (what a guardrails rule stores as its pattern).
    assert.match(i.entity, /^[A-Z][A-Z0-9_]*$/, `UPPER_SNAKE entity for ${i.id}`);
  }
});

test('ids and entity tokens are unique', () => {
  const ids = GUARDRAIL_CATALOG.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
  const entities = GUARDRAIL_CATALOG.map((i) => i.entity);
  assert.equal(new Set(entities).size, entities.length, 'duplicate entity token');
});

test('kind/engine are consistent per kind (presidio / guardrails-ai / llm-guard)', () => {
  for (const i of GUARDRAIL_CATALOG) {
    if (i.kind === 'presidio-entity') {
      assert.equal(i.engine, 'presidio', `${i.id} presidio-entity must use presidio`);
      assert.equal(i.hubId, undefined, `${i.id} presidio-entity should not carry a hubId`);
    } else if (i.kind === 'guardrails-validator') {
      assert.equal(i.engine, 'guardrails-ai', `${i.id} validator must use guardrails-ai`);
      assert.ok(i.hubId, `${i.id} validator must carry a hubId`);
    } else {
      assert.equal(i.kind, 'llm-guard-scanner');
      assert.equal(i.engine, 'llm-guard', `${i.id} scanner must use llm-guard`);
      assert.equal(i.hubId, undefined, `${i.id} scanner should not carry a hubId`);
      assert.ok(i.scanner, `${i.id} scanner must name its LLM Guard scanner class`);
    }
  }
});

test('contains the real Presidio predefined entities we ground on', () => {
  const entities = new Set(GUARDRAIL_CATALOG.map((i) => i.entity));
  for (const e of ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'CREDIT_CARD', 'US_SSN', 'IBAN_CODE']) {
    assert.ok(entities.has(e), `expected Presidio entity ${e}`);
  }
});

test('contains real Guardrails-AI Hub validators', () => {
  const validators = GUARDRAIL_CATALOG.filter((i) => i.kind === 'guardrails-validator');
  assert.ok(validators.length >= 5, 'expected several validators');
  const tokens = new Set(validators.map((i) => i.entity));
  for (const t of ['TOXIC_LANGUAGE', 'PROMPT_INJECTION', 'SECRETS_PRESENT', 'DETECT_PII']) {
    assert.ok(tokens.has(t), `expected validator ${t}`);
  }
});

// ─── Lookup + grouping ────────────────────────────────────────────────────────────────────────────
test('getGuardrailItem finds by id, null otherwise', () => {
  assert.equal(getGuardrailItem('email')?.entity, 'EMAIL_ADDRESS');
  assert.equal(getGuardrailItem('nope'), null);
});

test('catalogByCategory groups in canonical order, no empty groups', () => {
  const groups = catalogByCategory();
  assert.ok(groups.length > 0);
  for (const g of groups) assert.ok(g.items.length > 0, `no empty group ${g.category}`);
  // canonical order preserved among the categories that appear
  const order = groups.map((g) => g.category);
  const canonicalIdx = order.map((c) => GUARDRAIL_CATEGORIES.indexOf(c));
  const sorted = [...canonicalIdx].sort((a, b) => a - b);
  assert.deepEqual(canonicalIdx, sorted, 'groups not in canonical order');
  // every item appears exactly once across groups
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, GUARDRAIL_CATALOG.length);
});

// ─── Filter ─────────────────────────────────────────────────────────────────────────────────────
test('isFilterActive reflects any constraint', () => {
  assert.equal(isFilterActive({}), false);
  assert.equal(isFilterActive({ q: '  ' }), false);
  assert.equal(isFilterActive({ q: 'ssn' }), true);
  assert.equal(isFilterActive({ category: 'Financial' }), true);
  assert.equal(isFilterActive({ kind: 'guardrails-validator' }), true);
});

test('filterCatalog matches name/description/entity, case-insensitive', () => {
  assert.ok(filterCatalog(GUARDRAIL_CATALOG, { q: 'SSN' }).some((i) => i.id === 'us-ssn'));
  assert.ok(filterCatalog(GUARDRAIL_CATALOG, { q: 'iban_code' }).some((i) => i.id === 'iban'));
  assert.ok(filterCatalog(GUARDRAIL_CATALOG, { q: 'jailbreak' }).some((i) => i.entity === 'PROMPT_INJECTION'));
});

test('filterCatalog respects category + kind, does not mutate input', () => {
  const before = [...GUARDRAIL_CATALOG];
  const fin = filterCatalog(GUARDRAIL_CATALOG, { category: 'Financial' });
  assert.ok(fin.length > 0 && fin.every((i) => i.category === 'Financial'));
  const vals = filterCatalog(GUARDRAIL_CATALOG, { kind: 'guardrails-validator' });
  assert.ok(vals.every((i) => i.kind === 'guardrails-validator'));
  assert.deepEqual(GUARDRAIL_CATALOG, before, 'input mutated');
});

// ─── Availability (honest engine gating) ──────────────────────────────────────────────────────────
test('presidio entity: ready when presidio configured', () => {
  const item = getGuardrailItem('person')!;
  assert.equal(itemAvailability(item, { presidioReady: true, guardrailsAiReady: false }).status, 'ready');
});

test('presidio entity: floor for email/phone when presidio down, fallback otherwise', () => {
  const off = { presidioReady: false, guardrailsAiReady: false };
  assert.equal(itemAvailability(getGuardrailItem('email')!, off).status, 'floor');
  assert.equal(itemAvailability(getGuardrailItem('phone')!, off).status, 'floor');
  assert.equal(itemAvailability(getGuardrailItem('us-ssn')!, off).status, 'fallback');
  // floor entities are exactly the two the regex floor covers
  for (const e of REGEX_FLOOR_ENTITIES) {
    assert.ok(['EMAIL_ADDRESS', 'PHONE_NUMBER'].includes(e));
  }
});

test('validator: ready when guardrails-ai configured, fallback otherwise', () => {
  const item = getGuardrailItem('toxic-language')!;
  assert.equal(itemAvailability(item, { presidioReady: true, guardrailsAiReady: true }).status, 'ready');
  assert.equal(itemAvailability(item, { presidioReady: true, guardrailsAiReady: false }).status, 'fallback');
});

// ─── LLM Guard scanners ─────────────────────────────────────────────────────────────────────────
test('the catalog carries the full LLM Guard scanner spread', () => {
  const llm = GUARDRAIL_CATALOG.filter((i) => i.engine === 'llm-guard');
  assert.ok(llm.length >= 10, `expected >=10 LLM Guard scanners, got ${llm.length}`);
  const scanners = new Set(llm.map((i) => i.scanner));
  for (const s of [
    'Anonymize',
    'Secrets',
    'Sensitive',
    'Toxicity',
    'Bias',
    'BanTopics',
    'PromptInjection',
    'Language',
    'Regex',
    'TokenLimit',
  ]) {
    assert.ok(scanners.has(s), `missing LLM Guard scanner ${s}`);
  }
});

test('llm-guard scanner: ready when the LLM Guard engine is active, fallback otherwise', () => {
  const item = getGuardrailItem('llm-guard-prompt-injection')!;
  assert.equal(item.kind, 'llm-guard-scanner');
  assert.equal(
    itemAvailability(item, { presidioReady: false, guardrailsAiReady: false, llmGuardReady: true })
      .status,
    'ready',
  );
  assert.equal(
    itemAvailability(item, { presidioReady: true, guardrailsAiReady: true, llmGuardReady: false })
      .status,
    'fallback',
  );
  // Absent llmGuardReady (undefined) also degrades to fallback (not ready).
  assert.equal(
    itemAvailability(item, { presidioReady: true, guardrailsAiReady: true }).status,
    'fallback',
  );
});

test('buildEnablePayload labels an LLM Guard scanner with the LLM Guard engine', () => {
  const p = buildEnablePayload(getGuardrailItem('llm-guard-toxicity')!);
  assert.equal(p.matcher, 'entity');
  assert.equal(p.pattern, 'LLM_GUARD_TOXICITY');
  assert.match(p.label, /LLM Guard/);
  assert.equal(p.enabled, true);
});

// ─── Enable-payload builder (the load-bearing pure fn) ─────────────────────────────────────────────
test('buildEnablePayload produces a valid entity-matcher rule body', () => {
  const p = buildEnablePayload(getGuardrailItem('us-ssn')!);
  assert.equal(p.matcher, 'entity');
  assert.equal(p.pattern, 'US_SSN');
  assert.equal(p.action, 'redact'); // default
  assert.equal(p.enabled, true);
  assert.match(p.label, /Presidio/);
});

test('buildEnablePayload honours a chosen action and labels the engine', () => {
  const p = buildEnablePayload(getGuardrailItem('toxic-language')!, 'mask');
  assert.equal(p.pattern, 'TOXIC_LANGUAGE');
  assert.equal(p.action, 'mask');
  assert.match(p.label, /Guardrails-AI/);
});

test('buildEnablePayload falls back to redact on a bad action, never throws', () => {
  // @ts-expect-error — exercising the runtime guard against a bad value
  const p = buildEnablePayload(getGuardrailItem('email')!, 'nonsense');
  assert.equal(p.action, 'redact');
});

test('every enable payload passes the same shape the rules route expects', () => {
  for (const i of GUARDRAIL_CATALOG) {
    const p = buildEnablePayload(i);
    assert.equal(p.matcher, 'entity');
    assert.match(p.pattern, /^[A-Z][A-Z0-9_]*$/);
    assert.ok((ENABLE_ACTIONS as readonly string[]).includes(p.action));
  }
});

// ─── Enabled-state derivation ─────────────────────────────────────────────────────────────────────
test('isItemEnabled true when an entity-matcher rule for the token exists', () => {
  const item = getGuardrailItem('email')!;
  assert.equal(isItemEnabled(item, [{ matcher: 'entity', pattern: 'EMAIL_ADDRESS' }]), true);
  assert.equal(isItemEnabled(item, [{ matcher: 'regex', pattern: 'EMAIL_ADDRESS' }]), false);
  assert.equal(isItemEnabled(item, [{ matcher: 'entity', pattern: 'US_SSN' }]), false);
  assert.equal(isItemEnabled(item, []), false);
});
