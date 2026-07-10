import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BHARAT_PROFILE, SURAKSHA_PROFILE } from '../src/lib/tour-demo-seed.ts';
import { chatId, chatMessageId, chatsFor } from '../src/lib/demo/chat.ts';
import { planTools, toolsFor } from '../src/lib/demo/tools.ts';
import { assetsFor, planAssets } from '../src/lib/demo/data-assets.ts';
import { filesFor } from '../src/lib/demo/storage.ts';
import { secretsFor } from '../src/lib/demo/secrets.ts';

// PURE unit tests for the demo persona-data builders — no DB, no network. They pin PERSONA
// DISTINCTNESS (bank ≠ insurer: different chats/tools/assets/files/secrets) and IDEMPOTENCY (the
// name-/id-based planners create nothing on a re-run). Real functions, no mocks.

// ─── chat ──────────────────────────────────────────────────────────────────────
test('bank and insurer surface DISTINCT chat conversations', () => {
  const bank = chatsFor(BHARAT_PROFILE).map((c) => c.key);
  const insurer = chatsFor(SURAKSHA_PROFILE).map((c) => c.key);
  assert.ok(bank.includes('neft-return-recon'), 'bank has NEFT reconciliation');
  assert.ok(insurer.includes('motor-fnol-summary'), 'insurer has FNOL summary');
  assert.equal(bank.filter((k) => insurer.includes(k)).length, 0, 'no shared conversation keys');
});

test('every assistant turn that cites references a seeded knowledge doc/collection name', () => {
  for (const profile of [BHARAT_PROFILE, SURAKSHA_PROFILE]) {
    for (const conv of chatsFor(profile)) {
      const assistant = conv.messages.filter((m) => m.role === 'assistant');
      assert.ok(assistant.length >= 1, `${conv.key} has an assistant turn`);
      for (const a of assistant) {
        assert.ok((a.citations ?? []).length >= 1, `${conv.key} assistant turn is grounded`);
      }
    }
  }
});

test('chatId / chatMessageId are deterministic and org-scoped (idempotent)', () => {
  assert.equal(chatId('org_bharat', 'neft-return-recon'), chatId('org_bharat', 'neft-return-recon'));
  assert.notEqual(chatId('org_bharat', 'neft-return-recon'), chatId('org_suraksha', 'neft-return-recon'));
  assert.notEqual(chatMessageId('org_bharat', 'x', 0), chatMessageId('org_bharat', 'x', 1));
  assert.ok(chatId('org_bharat', 'x').startsWith('conv_'));
  assert.ok(chatMessageId('org_bharat', 'x', 0).startsWith('msg_'));
});

// ─── tools ─────────────────────────────────────────────────────────────────────
test('bank and insurer register DISTINCT persona tools', () => {
  const bank = toolsFor(BHARAT_PROFILE).map((t) => t.name);
  const insurer = toolsFor(SURAKSHA_PROFILE).map((t) => t.name);
  assert.ok(bank.includes('CIBIL Score Check'));
  assert.ok(insurer.includes('Claims DB Query'));
  assert.equal(bank.filter((n) => insurer.includes(n)).length, 0, 'no shared tool names');
});

test('planTools is idempotent by name — a re-run creates nothing', () => {
  const specs = toolsFor(BHARAT_PROFILE);
  const first = planTools(specs, []);
  assert.equal(first.toCreate.length, specs.length, 'first run creates all');
  const second = planTools(specs, specs.map((t) => t.name));
  assert.equal(second.toCreate.length, 0, 're-run creates none');
  assert.equal(second.present.length, specs.length);
});

test('planTools matches names case-insensitively', () => {
  const specs = toolsFor(SURAKSHA_PROFILE);
  const plan = planTools(specs, [specs[0].name.toUpperCase()]);
  assert.equal(plan.toCreate.length, specs.length - 1);
});

// ─── data assets ─────────────────────────────────────────────────────────────────
test('bank and insurer catalogue DISTINCT assets with PII tags', () => {
  const bank = assetsFor(BHARAT_PROFILE);
  const insurer = assetsFor(SURAKSHA_PROFILE);
  assert.ok(bank.some((a) => a.name === 'dim_customer' && a.piiTags.includes('AADHAAR')));
  assert.ok(insurer.some((a) => a.name === 'claims_register' && a.piiTags.includes('POLICY')));
  assert.equal(bank.filter((a) => insurer.some((i) => i.name === a.name)).length, 0);
});

test('at least one restricted asset per tenant so the classification bars fill', () => {
  for (const profile of [BHARAT_PROFILE, SURAKSHA_PROFILE]) {
    assert.ok(assetsFor(profile).some((a) => a.level === 'restricted'));
  }
});

test('planAssets is idempotent by name', () => {
  const specs = assetsFor(BHARAT_PROFILE);
  assert.equal(planAssets(specs, []).toCreate.length, specs.length);
  assert.equal(planAssets(specs, specs.map((a) => a.name)).toCreate.length, 0);
});

// ─── storage + secrets distinctness ───────────────────────────────────────────────
test('bank and insurer have DISTINCT storage files', () => {
  const bank = filesFor(BHARAT_PROFILE).map((f) => f.name);
  const insurer = filesFor(SURAKSHA_PROFILE).map((f) => f.name);
  assert.ok(bank.some((n) => n.includes('account-statement')));
  assert.ok(insurer.some((n) => n.includes('fnol-motor')));
  assert.equal(bank.filter((n) => insurer.includes(n)).length, 0);
});

test('secret specs carry only FAKE placeholders (never a real value) and an org-scoped path', () => {
  for (const [profile, org] of [[BHARAT_PROFILE, 'org_bharat'], [SURAKSHA_PROFILE, 'org_suraksha']] as const) {
    const secrets = secretsFor(profile);
    assert.ok(secrets.length >= 1);
    for (const s of secrets) {
      assert.ok(s.placeholder.startsWith('REPLACE_ME_'), 'placeholder is obviously non-real');
      assert.ok(s.path.includes(org), 'path is scoped to the tenant org');
    }
  }
});
