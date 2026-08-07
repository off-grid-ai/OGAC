// Every case here comes from the live Apps page, whose anchors the guide turns into its CTA row.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionLabel, isOfferableAction, normalizeLinkText } from '@/lib/screen-actions';

test('a boundary lost between two elements is restored', () => {
  // <span>Runs on:</span><span>Policy Underwriting</span> reads as one string with no space. The
  // space was only ever implied by the layout, and reading the text is what loses the layout.
  assert.equal(normalizeLinkText('Runs on:Policy Underwriting'), 'Runs on: Policy Underwriting');
  assert.equal(normalizeLinkText('Runs on: Cross-Sell Advisor'), 'Runs on: Cross-Sell Advisor');
});

test('a colon that is not a lost boundary is left alone', () => {
  assert.equal(normalizeLinkText('Scheduled 09:30'), 'Scheduled 09:30');
  assert.equal(normalizeLinkText('Step 5: 2 of 3'), 'Step 5: 2 of 3');
});

test('a generic label borrows the heading it sat under', () => {
  // "Open" is meaningless once it is out of its card, and a list page has one on every card.
  assert.equal(actionLabel('Open', 'Policy Underwriting Assist'), 'Open · Policy Underwriting Assist');
  assert.equal(actionLabel('view', 'Death-Claim Assessment'), 'view · Death-Claim Assessment');
});

test('a label that already says something keeps its own words', () => {
  // Prefixing these too would give "Start from a template · Apps", which reads worse than either.
  assert.equal(actionLabel('Start from a template', 'Apps'), 'Start from a template');
  assert.equal(actionLabel('2 waiting for a decision', 'Apps'), '2 waiting for a decision');
});

test('a generic label with no heading to borrow is still offered', () => {
  // Weak, but a real action. Dropping it would silently remove a way forward.
  assert.equal(actionLabel('Open', undefined), 'Open');
  assert.equal(actionLabel('Open', ''), 'Open');
});

test('a long label is cut rather than allowed to become a paragraph', () => {
  const out = actionLabel('Open', 'A very long application name that goes on and on and on and on');
  assert.ok(out.length <= 60, out);
  assert.ok(out.endsWith('…'));
});

test('nothing in, nothing out — never the string "undefined"', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(actionLabel(v), '');
});

test('only internal routes are offered', () => {
  // An external link is not somewhere this surface should be steering anyone.
  assert.equal(isOfferableAction('/solutions/apps/app_c38d2c5e', 'Open'), true);
  assert.equal(isOfferableAction('https://example.com', 'Docs'), false);
  assert.equal(isOfferableAction('//evil.example.com', 'Open'), false);
  assert.equal(isOfferableAction('mailto:a@b.c', 'Email'), false);
});

test('an empty or essay-length link is not a call to action', () => {
  assert.equal(isOfferableAction('/x', ''), false, 'nothing to press');
  assert.equal(isOfferableAction('/x', 'a'.repeat(60)), false, 'not a call to action');
});
