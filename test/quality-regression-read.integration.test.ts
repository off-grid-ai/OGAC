import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// The shared read seam the API route and the drift page both go through. Exercised against a REAL
// Postgres and the REAL online_scores table (self-creating, same as in production) — no mocks — so
// this fails if the persistence, the tenant scoping, or the composition breaks.

const dbUp = await dbReachable();
const ORG = 'qr_read_probe_org';
const OTHER_ORG = 'qr_read_probe_other';
const SUBJ = 'agent_qr_read_probe';

after(async () => {
  if (!dbUp) return;
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`DELETE FROM online_scores WHERE org_id IN (${ORG}, ${OTHER_ORG})`);
});

test(
  'reads retained verdicts and reports a real decline, scoped to the tenant',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const { retainOnlineScore, toOnlineScore } = await import('@/lib/qa/online-scores');
    const { readQualityRegression } = await import('@/lib/qa/quality-regression');

    const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
    const put = async (i: number, quality: number, orgId = ORG, judged = true) =>
      retainOnlineScore(
        toOnlineScore({
          runId: `${orgId}_qr_${i}`,
          orgId,
          subjectId: SUBJ,
          quality,
          faithfulness: quality,
          judged,
          now: at(100 - i),
        }),
      );

    // Six good answers, then six bad ones — a genuine decline.
    for (let i = 0; i < 6; i++) assert.equal(await put(i, 0.9), true);
    for (let i = 6; i < 12; i++) assert.equal(await put(i, 0.4), true);
    // A different tenant's healthy runs must not leak into this verdict.
    for (let i = 0; i < 12; i++) await put(i, 0.95, OTHER_ORG);

    const view = await readQualityRegression(ORG, { recentSize: 6, minSamples: 5 });

    assert.equal(view.retained, 12);
    assert.equal(view.measured, true);
    assert.equal(view.regressed.length, 1);

    const [v] = view.regressed;
    assert.equal(v.subjectId, SUBJ);
    assert.equal(v.status, 'regressed');
    assert.equal(v.recentQuality, 0.4);
    assert.equal(v.baselineQuality, 0.9);
    assert.match(v.detail, /getting worse/);

    // The trend comes from the same single read, so both views agree on the underlying data.
    assert.equal(view.trend.length, 1);
    assert.equal(view.trend[0].judged, 12);
    assert.equal(view.trend[0].unjudged, 0);

    // The other tenant is judged on its own runs and is healthy.
    const other = await readQualityRegression(OTHER_ORG, { recentSize: 6, minSamples: 5 });
    assert.equal(other.retained, 12);
    assert.deepEqual(other.regressed, []);
    assert.equal(other.subjects[0].status, 'ok');
  },
);

test(
  'a tenant with nothing scored reads as unmeasured, not as healthy',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const { readQualityRegression } = await import('@/lib/qa/quality-regression');
    const view = await readQualityRegression('qr_read_probe_empty_org');

    assert.equal(view.retained, 0);
    assert.equal(view.measured, false); // the distinction that stops a false all-clear
    assert.deepEqual(view.subjects, []);
    assert.deepEqual(view.regressed, []);
    assert.deepEqual(view.trend, []);
  },
);
