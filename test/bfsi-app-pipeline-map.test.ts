import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  governedSeedAppTitles,
  pipelineKeyForAppTitle,
  pipelineNameForAppTitle,
  resolvePipelineIdForApp,
} from '../src/lib/bfsi-app-pipeline-map.ts';
import { SAMPLE_PIPELINES } from '../src/lib/pipelines-seed.ts';

// PURE unit tests for the BFSI seed app → pipeline binding (UX-audit T4 item 1). No I/O — pins the
// title→pipeline matching so seed apps read "Runs on: <pipeline>" instead of "Ungoverned".

test('each seed app title maps to a real SAMPLE_PIPELINES key', () => {
  const keys = new Set(SAMPLE_PIPELINES.map((p) => p.key));
  for (const title of governedSeedAppTitles()) {
    const key = pipelineKeyForAppTitle(title);
    assert.ok(key, `no key for "${title}"`);
    assert.ok(keys.has(key!), `key "${key}" for "${title}" is not a real pipeline`);
  }
});

test('title→name resolves to the exact SAMPLE_PIPELINES display name', () => {
  const nameByKey = new Map(SAMPLE_PIPELINES.map((p) => [p.key, p.name]));
  for (const title of governedSeedAppTitles()) {
    const key = pipelineKeyForAppTitle(title)!;
    assert.equal(pipelineNameForAppTitle(title), nameByKey.get(key));
  }
});

test('the six canonical BFSI app→pipeline bindings hold', () => {
  assert.equal(pipelineNameForAppTitle('Motor Claim FNOL Triage'), 'Motor-Claim FNOL');
  assert.equal(pipelineNameForAppTitle('Personal Loan Underwriting Assist'), 'Loan Underwriting');
  assert.equal(pipelineNameForAppTitle('KYC & Re-KYC Verification'), 'KYC Verification');
  assert.equal(pipelineNameForAppTitle('Reimbursement Approval'), 'Reimbursement Governance');
  assert.equal(pipelineNameForAppTitle('Fraud Screening'), 'Fraud Screening');
  assert.equal(pipelineNameForAppTitle('Cross-Sell Advisor'), 'Cross-Sell Advisor');
});

test('matching is case- and whitespace-insensitive', () => {
  assert.equal(pipelineKeyForAppTitle('  motor claim fnol triage  '), 'motor-claim-fnol');
  assert.equal(pipelineKeyForAppTitle('KYC & RE-KYC VERIFICATION'), 'kyc-verification');
});

test('an unknown app title has no governing pipeline', () => {
  assert.equal(pipelineKeyForAppTitle('Some Random App'), null);
  assert.equal(pipelineNameForAppTitle('Some Random App'), null);
});

test('resolvePipelineIdForApp maps title → live pipeline id via the name→id map', () => {
  const idByName = new Map([
    ['Motor-Claim FNOL', 'pl_seed_default_motor-claim-fnol'],
    ['KYC Verification', 'pl_seed_default_kyc-verification'],
  ]);
  assert.equal(
    resolvePipelineIdForApp('Motor Claim FNOL Triage', idByName),
    'pl_seed_default_motor-claim-fnol',
  );
  // case-insensitive on the live map too
  assert.equal(
    resolvePipelineIdForApp('KYC & Re-KYC Verification', new Map([['kyc verification', 'p1']])),
    'p1',
  );
});

test('resolvePipelineIdForApp returns null when the pipeline is not yet seeded', () => {
  assert.equal(resolvePipelineIdForApp('Fraud Screening', new Map()), null);
  // and null for an app that has no governing pipeline at all
  assert.equal(resolvePipelineIdForApp('Nope', new Map([['Fraud Screening', 'x']])), null);
});
