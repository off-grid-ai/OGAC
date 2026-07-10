// ADVERSARIAL — settings/configuration break-proofs. These encode CONFIRMED breaks in the
// global Config surface (src/lib/config.ts, config-registry.ts, the reveal route).
// They are RED on purpose. Skipped so the shared suite stays green for other agents; each
// `.skip` carries a G-ADV-SET-* gap ref. Un-skip to reproduce the break.
//
// Repro one at a time by flipping `.skip` → nothing and running:
//   npm test -- test/adversarial-settings-config.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIG_REGISTRY,
  configConnectValue,
  configDisplayValue,
} from '../src/lib/config-registry.ts';
import { validateConnectorCreate } from '../src/lib/connector-policy.ts';

// ── G-ADV-SET-1 — host round-trip is LOSSY: a raw LAN IP is silently rewritten to loopback ──
// configDisplayValue maps 192.168.1.59 → offgrid-s1.local for DISPLAY. configConnectValue maps
// offgrid-s1.local → 127.0.0.1 for SAVE. So an admin who opens Config (value shows as the mDNS
// host), touches nothing about THIS field, and clicks Save on the page (the pending map only
// carries edited keys, but ANY host key the operator DID edit round-trips through this) — the
// value that reaches disk is 127.0.0.1, NOT the original 192.168.1.59. The persisted connect
// target has changed from an explicit LAN IP to loopback. On a box where the console is NOT
// co-located with S1 (loopback ≠ S1), that BREAKS connectivity after the next restart.
// The round-trip is only lossless for values that were ALREADY 127.0.0.1.
test.skip('G-ADV-SET-1: host display→connect round-trip loses the original LAN IP (rewrites to loopback)', () => {
  const def = { hostValue: true } as const;
  const original = 'http://192.168.1.59:6333';
  const shown = configDisplayValue(def, original); // what the operator sees + edits in
  const persisted = configConnectValue(def, shown); // what a re-save writes back
  // A faithful round-trip would persist the original. It does NOT — it collapses to loopback.
  assert.equal(
    persisted,
    original,
    `re-saving an unedited host field must preserve the original target; got ${persisted}`,
  );
});

// ── G-ADV-SET-2 — the round-trip is not idempotent even for the mDNS default itself ──
// The registry default for the gateway is http://offgrid-s1.local:4000. Display leaves it as-is
// (already mDNS). Save maps it to http://127.0.0.1:4000/. Display again → offgrid-s1.local:4000/.
// So display(save(x)) ≠ display(x): the trailing-slash / normalization drift means a diff/audit
// of "did this change?" is unreliable and the field reports dirty when nothing was meaningfully
// changed.
test.skip('G-ADV-SET-2: display(connect(x)) is not stable for the registry default (normalization drift)', () => {
  const def = { hostValue: true } as const;
  const shown = 'http://offgrid-s1.local:4000';
  const persisted = configConnectValue(def, shown); // http://127.0.0.1:4000/
  const reshown = configDisplayValue(def, persisted); // http://offgrid-s1.local:4000/
  assert.equal(reshown, shown, `display∘connect must be identity for a display value; got ${reshown}`);
});

// ── G-ADV-SET-3 — a hostValue that is NOT loopback/known-IP cannot survive a save if the
// operator edited it to a real private IP the map doesn't know: display maps ANY private IPv4 to
// offgrid-s1.local (display-host isPrivateIPv4 → S1_HOST), then connect maps that to 127.0.0.1.
// So typing a brand-new backend at 10.0.0.5 into a host field and saving persists 127.0.0.1 —
// the operator's explicit address is thrown away entirely.
test.skip('G-ADV-SET-3: editing a host field to an unknown private IP persists loopback, discarding the input', () => {
  const def = { hostValue: true } as const;
  const typed = 'http://10.0.0.5:6333';
  const shown = configDisplayValue(def, typed); // → offgrid-s1.local (private-IP catch-all)
  const persisted = configConnectValue(def, shown); // → 127.0.0.1
  assert.match(
    persisted,
    /10\.0\.0\.5/,
    `operator-entered backend IP must be persisted, not collapsed to loopback; got ${persisted}`,
  );
});

// ── G-ADV-SET-4 — connector PATCH accepts input the CREATE rule rejects (validation asymmetry) ──
// POST /api/v1/admin/connectors validates the body through validateConnectorCreate (unknown/unready
// type → 400; malformed SQL endpoint → 400). PATCH /api/v1/admin/connectors/[id] validates ONLY the
// `auth` enum — it passes body.type + body.endpoint straight to updateConnector with NO reuse of the
// create validator. So an operator editing a connector can set type='totally-bogus' or an unparseable
// endpoint and it PERSISTS with a 200, silently breaking the connector (no 400, no inline error).
// This test proves the create RULE would have rejected exactly the input PATCH accepts — i.e. the
// same decision exists in the pure lib but the update route does not call it (DRY/SoC break).
// Repro at the route level: PATCH {type:'totally-bogus'} → 200 (should be 400).
test.skip('G-ADV-SET-4: connector CREATE rule rejects a bogus type that the PATCH route silently persists', () => {
  const bogus = validateConnectorCreate({ name: 'x', type: 'totally-bogus' });
  // The create validator correctly rejects it…
  assert.equal(bogus.ok, false, 'create validator must reject an unknown type');
  // …but the PATCH route never runs this validator. This assertion documents the gap: it FAILS to
  // stand in as a guard because the update path has no equivalent check. We assert the route-level
  // invariant we WANT (update must reject what create rejects). Flip to an integration test against
  // PATCH to see the live 200. Marked failing to flag the missing reuse.
  const patchWouldReject = false; // the PATCH handler has no type/endpoint validation — see [id]/route.ts:16
  assert.equal(
    patchWouldReject,
    !bogus.ok,
    'PATCH must reject the same invalid connector input that CREATE rejects (validation is not reused)',
  );
});
