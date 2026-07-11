import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReportDoc } from '../src/lib/reports/model.ts';
import { validateReportDoc } from '../src/lib/reports/validate.ts';

// A COMPLETE, correct document — the baseline every adversarial case mutates to break one rule.
function completeDoc(): ReportDoc {
  return {
    filenameBase: 'offgrid-regulator-irdai',
    meta: {
      title: 'Regulator Response Pack',
      subtitle: 'IRDAI',
      tenantName: 'Suraksha Life Insurance',
      framework: 'IRDAI',
      period: { from: '2026-06-01', to: '2026-06-30' },
      recipient: { role: 'regulator', name: 'IRDAI' },
      classification: 'Confidential',
      generatedAt: '2026-07-12T09:00:00.000Z',
      provenance: { manifestId: 'mf_1', sha256: 'abc123', signer: 'offgrid-signing-key' },
    },
    sections: [
      {
        heading: 'Framework coverage',
        blocks: [
          { type: 'keyValues', rows: [{ label: 'Overall posture', value: '63%' }] },
          {
            type: 'table',
            columns: ['Control', 'Status', 'Evidence'],
            rows: [['PII masking', 'PASS', 'Presidio recognizers active']],
            declaredCount: 1,
          },
          { type: 'statusList', items: [{ label: 'Audit trail', status: 'pass' }] },
          { type: 'signature', name: 'A. Rao', title: 'Chief Compliance Officer' },
        ],
      },
    ],
  };
}

test('validateReportDoc: a complete, correct document passes with zero issues', () => {
  const r = validateReportDoc(completeDoc());
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.issues.length, 0);
});

test('validateReportDoc: missing tenant / recipient / period are flagged (incomplete metadata)', () => {
  const d = completeDoc();
  d.meta.tenantName = '';
  d.meta.recipient = { role: 'regulator', name: '' };
  d.meta.period = { from: '2026-06-30', to: '2026-06-01' }; // reversed
  const r = validateReportDoc(d);
  assert.equal(r.ok, false);
  const paths = r.issues.map((i) => i.path);
  assert.ok(paths.includes('meta.tenantName'));
  assert.ok(paths.includes('meta.recipient'));
  assert.ok(paths.includes('meta.period'));
});

test('validateReportDoc: a table whose declared count does not reconcile is a defect', () => {
  const d = completeDoc();
  const tbl = d.sections[0].blocks[1];
  if (tbl.type === 'table') tbl.declaredCount = 5; // claims 5, has 1
  const r = validateReportDoc(d);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /does not reconcile/.test(i.message)));
});

test('validateReportDoc: placeholder / empty cells never pass', () => {
  const d = completeDoc();
  d.sections[0].blocks.push({
    type: 'table',
    columns: ['Dataset', 'Classification'],
    rows: [['—', 'TODO']],
  });
  const r = validateReportDoc(d);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /entirely-empty\/placeholder row/.test(i.message)));
});

test('validateReportDoc: a row with the wrong cell count is caught (table integrity)', () => {
  const d = completeDoc();
  const tbl = d.sections[0].blocks[1];
  if (tbl.type === 'table') tbl.rows = [['only-one-cell']];
  const r = validateReportDoc(d);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /expected 3/.test(i.message)));
});

test('validateReportDoc: an empty section (no blocks) is incomplete', () => {
  const d = completeDoc();
  d.sections.push({ heading: 'Appendix', blocks: [] });
  const r = validateReportDoc(d);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /no content blocks/.test(i.message)));
});

test('validateReportDoc: an unknown control status is rejected', () => {
  const d = completeDoc();
  const sl = d.sections[0].blocks[2];
  // @ts-expect-error — deliberately inject a bad status to prove the guard
  if (sl.type === 'statusList') sl.items[0].status = 'maybe';
  const r = validateReportDoc(d);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /unknown status/.test(i.message)));
});
