import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKIP_MESSAGE, dbReachable } from './support/db-available.mjs';

// REAL end-to-end proof of the terminal artifact. Drives the ACTUAL export pipeline —
// renderReportWithProvenance → the REAL builders → the REAL @/db-backed store (compliance,
// governance, policy, datasets, devices, routing) → the REAL branded react-pdf renderer — then
// extracts the produced PDF's text with pdfjs-dist and asserts the tenant name, the framework, and a
// KNOWN SEEDED metric appear in the actual bytes.
//
// NOTHING WE OWN IS MOCKED. The store, builders, validate, provenance signing and the renderer all
// run for real against Postgres. (The only substitutable things are the unrunnable external
// containers — ClickHouse/langfuse/gateway — behind their adapter seams; this test's report families
// don't reach them, so nothing is faked here at all.) Gated by db-available like the other
// *.integration.test.ts suites: runs for real when `cd deploy && make data` is up, skips green otherwise.

const dbUp = await dbReachable();

async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs TRANSFERS (detaches) the ArrayBuffer it is handed — pass a COPY so the caller's `bytes`
  // stay intact for the later provenance re-hash.
  const pdf = await pdfjs.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  return { text, pages: pdf.numPages };
}

test(
  'REAL regulator PDF from the real store carries tenant, framework, and a seeded governance metric',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { renderReportWithProvenance, tenantNameFor } = await import('@/lib/reports/build');
    const { validateReportDoc } = await import('@/lib/reports/validate');
    const { createGovernance } = await import('@/lib/store');
    const { verifyManifest } = await import('@/lib/provenance');
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');

    // Seed a UNIQUELY-named governance item into the default org — our KNOWN metric to find in the PDF.
    const marker = `Integration Board AI Policy ${Date.now()}`;
    const seeded = await createGovernance({
      kind: 'policy',
      title: marker,
      owner: 'Integration CCO',
      status: 'active',
      detail: 'Seeded by report-pdf.integration.test',
      reviewedAt: '2026-07-01',
    });
    t.after(async () => {
      await db.execute(sql`DELETE FROM governance_items WHERE id = ${seeded.id}`);
    });

    const now = '2026-07-12T09:00:00.000Z';
    const built = await renderReportWithProvenance('irdai', undefined, now);
    assert.ok(built, 'builder produced a report for the irdai regulator family');

    // The document is complete + correct before we ever look at bytes.
    const verdict = validateReportDoc(built.doc);
    assert.equal(verdict.ok, true, JSON.stringify(verdict.issues));

    // Terminal artifact: a real PDF whose extracted text carries the real data.
    assert.equal(Buffer.from(built.bytes.slice(0, 5)).toString(), '%PDF-');
    const { text, pages } = await extractPdfText(built.bytes);
    assert.ok(pages >= 1, 'at least one page');

    const tenantName = await tenantNameFor(undefined);
    assert.ok(text.includes(tenantName), `tenant name "${tenantName}" present in PDF`);
    assert.ok(text.includes('DPDP'), 'framework present in PDF');
    assert.ok(/IRDAI/.test(text), 'regulator recipient present in PDF');
    assert.ok(text.includes(marker), 'seeded governance item present in PDF (real store → PDF)');
    assert.ok(/\d/.test(text), 'at least one numeric metric present');

    // No placeholder tells leaked into the real artifact.
    for (const forbidden of ['undefined', 'NaN', '[object Object]', 'TODO']) {
      assert.ok(!text.includes(forbidden), `forbidden marker "${forbidden}" absent`);
    }

    // The signed manifest verifies against the produced bytes (end-to-end provenance).
    const { sha256 } = await import('@/lib/provenance');
    const v = verifyManifest(built.manifest, sha256(built.bytes));
    assert.equal(v.hashMatches, true, 'manifest sha256 matches the produced bytes');
  },
);

test(
  'REAL compliance evidence pack from the real store is a valid, complete PDF',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const { renderReportWithProvenance } = await import('@/lib/reports/build');
    const { validateReportDoc } = await import('@/lib/reports/validate');

    const built = await renderReportWithProvenance('compliance', undefined, '2026-07-12T09:00:00.000Z');
    assert.ok(built);
    assert.equal(validateReportDoc(built.doc).ok, true);
    const { text } = await extractPdfText(built.bytes);
    // Posture is rendered as a real percentage (a digit followed by %), never a blank/placeholder.
    assert.ok(/\d+%/.test(text), 'a real percentage metric present');
    assert.ok(!text.includes('undefined') && !text.includes('NaN'));
  },
);
