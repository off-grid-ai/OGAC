import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// The alerting loop against a REAL Postgres and the REAL tables (online_scores + the self-creating
// quality_alert_state) — no mocks of our own code. The point is to prove the MEMORY works end to end:
// a genuine regression alerts once, and then stops alerting while it persists.

const dbUp = await dbReachable();
const ORG = 'qa_alert_probe_org';
const SUBJ = 'app:qa_alert_probe';

after(async () => {
  if (!dbUp) return;
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`DELETE FROM online_scores WHERE org_id = ${ORG}`);
  await db.execute(sql`DELETE FROM quality_alert_state WHERE org_id = ${ORG}`);
  delete process.env.OFFGRID_QUALITY_ALERT_WEBHOOK;
});

test(
  'a real regression alerts exactly once, then stays quiet while it persists',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    const { retainOnlineScore, toOnlineScore } = await import('@/lib/qa/online-scores');
    const { listAlertState, saveAlertState } = await import('@/lib/qa/quality-alert-store');
    const { planQualityAlerts } = await import('@/lib/qa/quality-alert-plan');
    const { readQualityRegression } = await import('@/lib/qa/quality-regression');

    const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
    const put = (i: number, quality: number) =>
      retainOnlineScore(
        toOnlineScore({
          runId: `${ORG}_alert_${i}`,
          orgId: ORG,
          subjectId: SUBJ,
          quality,
          faithfulness: quality,
          judged: true,
          now: at(200 - i),
        }),
      );

    // 20 good answers, then 10 poor ones — a genuine decline under the default window.
    for (let i = 0; i < 20; i++) assert.equal(await put(i, 0.9), true);
    for (let i = 20; i < 30; i++) assert.equal(await put(i, 0.35), true);

    const view = await readQualityRegression(ORG);
    const subject = view.subjects.filter((s) => s.subjectId === SUBJ);
    assert.equal(subject[0]?.status, 'regressed', 'the probe data must actually regress');

    // FIRST evaluation: nothing remembered yet, so this is news.
    const first = planQualityAlerts(await listAlertState(ORG), subject);
    assert.equal(first.alerts.length, 1);
    assert.equal(first.alerts[0].kind, 'regressed');
    assert.equal(await saveAlertState(ORG, first.next), true);

    // The memory really persisted (this is what stops the re-alerting).
    const remembered = await listAlertState(ORG);
    assert.deepEqual(
      remembered.map((s) => [s.subjectId, s.status]),
      [[SUBJ, 'regressed']],
    );

    // SECOND evaluation over the same still-bad data: silence.
    const second = planQualityAlerts(remembered, subject);
    assert.deepEqual(second.alerts, [], 'a persisting regression must not alert again');

    // Quality comes back: that IS news again, and the memory clears.
    for (let i = 30; i < 45; i++) assert.equal(await put(i, 0.93), true);
    const recoveredView = await readQualityRegression(ORG);
    const recoveredSubject = recoveredView.subjects.filter((s) => s.subjectId === SUBJ);
    assert.equal(recoveredSubject[0]?.status, 'ok');

    const third = planQualityAlerts(await listAlertState(ORG), recoveredSubject);
    assert.equal(third.alerts.length, 1);
    assert.equal(third.alerts[0].kind, 'recovered');
    assert.equal(await saveAlertState(ORG, third.next), true);
    assert.equal((await listAlertState(ORG))[0].status, 'clear');
  },
);

test(
  'the sweep does no work and delivers nothing when no destination is configured',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    delete process.env.OFFGRID_QUALITY_ALERT_WEBHOOK;
    const { runQualityAlertSweep } = await import('@/lib/qa/quality-alert-run');
    const res = await runQualityAlertSweep(ORG, SUBJ);

    // Unconfigured must be inert, not a silent pretend-success.
    assert.equal(res.configured, false);
    assert.equal(res.delivered, 0);
    assert.deepEqual(res.alerts, []);
  },
);

test(
  'end to end: a real regression is delivered to a real destination, once',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async () => {
    // A real HTTP receiver — the whole chain runs for real: read verdicts, plan, sign, POST, persist
    // the memory, and stay quiet on the next pass. No mocks of our own code anywhere in this path.
    const { createServer } = await import('node:http');
    const { createHmac } = await import('node:crypto');
    const received: { body: string; signature: string; event: string }[] = [];

    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({
          body,
          signature: String(req.headers['x-offgrid-signature'] ?? ''),
          event: String(req.headers['x-offgrid-event'] ?? ''),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const SECRET = 'sweep-probe-secret';
    process.env.OFFGRID_QUALITY_ALERT_WEBHOOK = `http://127.0.0.1:${port}/quality`;
    process.env.OFFGRID_WEBHOOK_SECRET = SECRET;

    try {
      const { db } = await import('@/db');
      const { sql } = await import('drizzle-orm');
      // Start from a clean memory so this test owns the transition it is asserting.
      await db.execute(sql`DELETE FROM quality_alert_state WHERE org_id = ${ORG}`);

      const { retainOnlineScore, toOnlineScore } = await import('@/lib/qa/online-scores');
      const { runQualityAlertSweep } = await import('@/lib/qa/quality-alert-run');

      // Re-establish a decline on top of whatever the earlier test left (it ended recovered).
      const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
      for (let i = 100; i < 115; i++) {
        await retainOnlineScore(
          toOnlineScore({
            runId: `${ORG}_deliver_${i}`,
            orgId: ORG,
            subjectId: SUBJ,
            quality: 0.2,
            faithfulness: 0.2,
            judged: true,
            now: at(115 - i),
          }),
        );
      }

      const first = await runQualityAlertSweep(ORG, SUBJ);
      assert.equal(first.configured, true);
      assert.equal(first.delivered, 1, 'the alert reached the destination');
      assert.equal(first.alerts[0].kind, 'regressed');
      assert.equal(received.length, 1);

      // Signed over exactly the transmitted bytes, and readable by a receiver.
      const got = received[0];
      assert.equal(got.event, 'offgrid.quality_regression');
      assert.equal(got.signature, createHmac('sha256', SECRET).update(got.body).digest('hex'));
      const payload = JSON.parse(got.body);
      assert.equal(payload.subjectId, SUBJ);
      assert.equal(payload.orgId, ORG);
      assert.match(payload.subject, /Answer quality is slipping/);

      // SECOND sweep over the same still-bad data: the memory must keep it silent.
      const second = await runQualityAlertSweep(ORG, SUBJ);
      assert.deepEqual(second.alerts, [], 'no repeat alert while the regression persists');
      assert.equal(second.delivered, 0);
      assert.equal(received.length, 1, 'the destination was not called a second time');
    } finally {
      delete process.env.OFFGRID_QUALITY_ALERT_WEBHOOK;
      delete process.env.OFFGRID_WEBHOOK_SECRET;
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
