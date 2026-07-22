import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function doc(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8');
}

test('outcome capability records retain exact live evidence without inflating the CRM denominator', async () => {
  const [status, flagship, gaps] = await Promise.all([
    doc('docs/SERVICE_CAPABILITY_STATUS.md'),
    doc('docs/FLAGSHIP_CAPABILITY_CLOSURE.md'),
    doc('docs/GAPS_BACKLOG.md'),
  ]);

  assert.match(status, /Outcome Observation Plane live-verified delta/);
  assert.match(status, /f5338085e2ae86e0018a645187cbe02791aeab26/);
  assert.match(status, /aout_f0092c463fcb4a289afd/);
  assert.match(status, /aout_b87f8c14147a4f3399f6/);
  assert.match(status, /aout_a0311b31bdf14dc79eaa/);
  assert.match(status, /aout_c65fa282e33045be948b/);
  assert.match(status, /all four snapshots matched byte-for-byte/);
  assert.match(status, /no duplicate source keys/);
  assert.match(status, /enterprise-source-crm\/write-sync-webhooks.*stays `N\/P\/P\/P`/s);
  assert.match(
    flagship,
    /f5338085e2ae86e0018a645187cbe02791aeab26.*accepted, converted, corrected, withdrawn, replay/s,
  );
  assert.match(gaps, /\[G-OUTCOME-LIVE\] RESOLVED \+ LIVE/);
  assert.match(gaps, /replayed:true/);
  assert.match(gaps, /cross-tenant\s+detail failed closed with 404/s);
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
  assert.match(builder, /INR 10,000 baseline and INR 25,000 result/);
  assert.match(builder, /Automatic CRM webhook\/import capture.*not yet available/s);
  assert.match(reports, /system run outcomes/);
  assert.match(reports, /do not yet aggregate the post-action business\s+results/);
  assert.match(reports, /does not yet roll that evidence up across a portfolio/);
});
