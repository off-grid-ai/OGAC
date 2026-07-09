import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPosture,
  COMPLIANCE_ARTIFACTS,
  EMPTY_INPUTS,
  INDIA_BFSI_FRAMINGS,
  rollupFramings,
  summarisePosture,
  type PostureInputs,
} from '../src/lib/trust-center.ts';
import { buildTrustReport } from '../src/lib/trust-report.ts';

const ALL_ON: PostureInputs = Object.fromEntries(
  Object.keys(EMPTY_INPUTS).map((k) => [k, true]),
) as unknown as PostureInputs;

function report(inputs: PostureInputs) {
  const posture = buildPosture(inputs);
  const summary = summarisePosture(posture, '2026-01-01T00:00:00.000Z');
  const framings = rollupFramings(INDIA_BFSI_FRAMINGS, posture);
  return buildTrustReport({ summary, posture, framings, artifacts: COMPLIANCE_ARTIFACTS });
}

test('report has a stable filename and markdown title', () => {
  const r = report(ALL_ON);
  assert.equal(r.filename, 'offgrid-trust-summary.md');
  assert.match(r.body, /^# Off Grid AI — Trust & Security Summary/m);
});

test('report states the posture score and the honesty note', () => {
  const r = report(ALL_ON);
  assert.match(r.body, /Overall posture: 100%/);
  assert.match(r.body, /reported honestly/i);
});

test('report renders every posture pillar heading except the artifact pillar', () => {
  const r = report(ALL_ON);
  assert.match(r.body, /## Security posture/);
  assert.match(r.body, /## Data governance & residency/);
  assert.match(r.body, /## AI governance & model risk/);
  // the artifact pillar has no posture items, so it appears only as the checklist section
  assert.match(r.body, /## Compliance artifacts/);
});

test('report surfaces in-progress items verbatim when posture is incomplete', () => {
  const r = report(EMPTY_INPUTS);
  assert.match(r.body, /In progress/);
  // and never claims 100 when nothing is implemented
  assert.doesNotMatch(r.body, /Overall posture: 100%/);
});

test('report includes the India-BFSI regulators and maps controls', () => {
  const r = report(ALL_ON);
  assert.match(r.body, /Regulatory mapping — India BFSI/);
  assert.match(r.body, /Reserve Bank of India/);
  assert.match(r.body, /IRDAI/);
  assert.match(r.body, /Digital Personal Data Protection Act/);
  assert.match(r.body, /Mapped controls:/);
});

test('report lists every compliance artifact with an uppercased status', () => {
  const r = report(ALL_ON);
  for (const a of COMPLIANCE_ARTIFACTS) {
    assert.ok(r.body.includes(a.name), `${a.name} present`);
    assert.ok(r.body.includes(a.status.toUpperCase()), `${a.status} shown`);
  }
});

test('report omits the "Mapped controls" list for a framing with no controls', () => {
  const posture = buildPosture(EMPTY_INPUTS);
  const summary = summarisePosture(posture, 'x');
  const framings = rollupFramings(
    [{ id: 'empty', regulator: 'Reg', name: 'Empty framing', summary: 'none', controlIds: [] }],
    posture,
  );
  const r = buildTrustReport({ summary, posture, framings, artifacts: COMPLIANCE_ARTIFACTS });
  assert.match(r.body, /Empty framing/);
  // no "Mapped controls:" for a framing that maps to nothing (the length>0 guard)
  assert.doesNotMatch(r.body, /Mapped controls:/);
});

test('report with no posture items skips empty pillar headings but still renders sections', () => {
  const summary = summarisePosture([], 'x');
  const framings = rollupFramings(INDIA_BFSI_FRAMINGS, []);
  const r = buildTrustReport({ summary, posture: [], framings, artifacts: COMPLIANCE_ARTIFACTS });
  // no posture pillar heading (every pillar had 0 items -> the length===0 continue fires)
  assert.doesNotMatch(r.body, /## Security posture/);
  // but the regulatory + artifacts sections still render
  assert.match(r.body, /Regulatory mapping — India BFSI/);
  assert.match(r.body, /## Compliance artifacts/);
});

test('report copy names no banned OSS engine', () => {
  const banned = ['presidio', 'coraza', 'opensearch', 'openbao', 'keycloak', 'caddy'];
  const hay = report(ALL_ON).body.toLowerCase();
  for (const b of banned) assert.ok(!hay.includes(b), `report must not name "${b}"`);
});
