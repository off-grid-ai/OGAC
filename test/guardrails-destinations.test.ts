import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUARDRAILS_DESTINATIONS,
  guardrailsDestination,
  legacyGuardrailsDestination,
} from '../src/lib/guardrails-destinations.ts';

test('guardrails destinations are stable, unique child routes', () => {
  assert.deepEqual(
    GUARDRAILS_DESTINATIONS.map((destination) => destination.id),
    ['overview', 'protections', 'masking', 'recognizers', 'thresholds', 'test'],
  );
  assert.equal(new Set(GUARDRAILS_DESTINATIONS.map((destination) => destination.route)).size, 6);
  assert.equal(guardrailsDestination('recognizers')?.route, '/governance/guardrails/recognizers');
  assert.equal(guardrailsDestination('unknown'), undefined);
});

test('legacy guardrails query links keep their owning destination', () => {
  assert.equal(legacyGuardrailsDestination(new URLSearchParams()).id, 'overview');
  assert.equal(legacyGuardrailsDestination(new URLSearchParams('q=hello')).id, 'test');
  assert.equal(legacyGuardrailsDestination(new URLSearchParams('panel=new-mask')).id, 'masking');
  assert.equal(legacyGuardrailsDestination(new URLSearchParams('cat_q=phone')).id, 'protections');
});
