import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function doc(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8');
}

test('outcome capability records preserve source-wired versus live evidence', async () => {
  const [status, flagship, gaps] = await Promise.all([
    doc('docs/SERVICE_CAPABILITY_STATUS.md'),
    doc('docs/FLAGSHIP_CAPABILITY_CLOSURE.md'),
    doc('docs/GAPS_BACKLOG.md'),
  ]);

  assert.match(status, /Outcome Observation Plane code-wired delta/);
  assert.match(status, /No four-gate state is promoted by this source checkpoint/);
  assert.match(status, /enterprise-source-crm\/write-sync-webhooks.*stays `N\/P\/P\/P`/s);
  assert.match(
    flagship,
    /Receipt-correlated business results are code-wired and test-proven, not deployed/,
  );
  assert.match(gaps, /\[G-OUTCOME-LIVE\] CODE \+ WIRED; LIVE EVIDENCE PENDING/);
  assert.match(gaps, /\[G-OUTCOME-AUTOMATION\] OPEN/);
});

test('operator docs separate system completion from business success and explain retained history', async () => {
  const [builder, reports] = await Promise.all([
    doc('docs/user/app-builder.md'),
    doc('docs/user/app-reports.md'),
  ]);

  assert.match(builder, /Record what happened after an action/);
  assert.match(builder, /signed execution receipt proves what the\s+system\s+changed/);
  assert.match(builder, /Correct this record/);
  assert.match(builder, /original remains in the result history/);
  assert.match(builder, /Automatic CRM webhook\/import capture.*not yet available/s);
  assert.match(reports, /system run outcomes/);
  assert.match(reports, /do not yet aggregate the post-action business\s+results/);
});
