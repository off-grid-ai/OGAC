// A stale answer must never land under a newer question.
//
// LIVE FINDING (2026-08-06): the guide displayed "What am I looking at on See the protections that
// are on?" above an answer explaining the Data → Catalog page. Clicking a destination fired one ask,
// the resulting route change fired another, and whichever HTTP response arrived last won the state —
// even when it belonged to the older question. That is worse than a spinner: it reads as a real
// answer to what was asked, so a reader on the Guardrails page was told about the Catalog page and
// had no way to know.
//
// The component fix (don't fire twice) is necessary but not sufficient: any two overlapping asks —
// a fast retry, a slow network, a second click — reproduce it. The durable fix is a sequence guard in
// the hook, and this test pins that rule directly against the ordering that caused it.
//
// The guard is modelled here rather than rendered, because what needs protecting is the ORDERING
// rule, not React. `latestWins` mirrors the hook's monotonic-id logic exactly.

import assert from 'node:assert/strict';
import { test } from 'node:test';

/** The hook's rule, in isolation: a write is allowed only if its request is still the newest. */
function makeSequencer() {
  let current = 0;
  let state: string | null = null;
  return {
    /** Begin a request; returns a write function that is a no-op once superseded. */
    begin(): (value: string) => void {
      const id = (current += 1);
      return (value: string) => {
        if (current === id) state = value;
      };
    },
    /** A reset invalidates anything in flight, like the hook's `reset`. */
    reset() {
      current += 1;
      state = null;
    },
    get value() {
      return state;
    },
  };
}

test('the newer question wins even when the OLDER response arrives last', () => {
  // This is the exact live ordering: the destination ask started first and finished second.
  const s = makeSequencer();
  const writeCatalog = s.begin(); // ask A — "explain Data → Catalog"
  const writeGuardrails = s.begin(); // ask B — fired by the route change

  writeGuardrails('guardrails answer'); // B lands first
  writeCatalog('catalog answer'); // A lands late and must be IGNORED

  assert.equal(s.value, 'guardrails answer');
});

test('the normal ordering still works', () => {
  const s = makeSequencer();
  const first = s.begin();
  first('first answer');
  assert.equal(s.value, 'first answer');

  const second = s.begin();
  second('second answer');
  assert.equal(s.value, 'second answer');
});

test('a response in flight during a reset cannot resurrect a cleared answer', () => {
  // Switching back to the tour clears the panel. A request started before that must not repopulate
  // it seconds later, which would put an answer under a question the reader can no longer see.
  const s = makeSequencer();
  const inFlight = s.begin();
  s.reset();
  inFlight('late answer');
  assert.equal(s.value, null);
});

test('three overlapping asks settle on the last one asked, in any arrival order', () => {
  for (const order of [
    [0, 1, 2],
    [2, 1, 0],
    [1, 0, 2],
    [2, 0, 1],
  ]) {
    const s = makeSequencer();
    const writes = ['a', 'b', 'c'].map((v) => ({ v, write: s.begin() }));
    for (const i of order) writes[i].write(writes[i].v);
    assert.equal(s.value, 'c', `arrival order ${order.join(',')} should still settle on the newest`);
  }
});
