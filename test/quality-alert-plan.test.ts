import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alertSubjectLine,
  planQualityAlerts,
  type QualityAlertState,
} from '../src/lib/qa/quality-alert-plan.ts';
import type { RegressionVerdict } from '../src/lib/qa/quality-regression.ts';
import {
  alertDestination,
  buildQualityAlertPayload,
  QUALITY_ALERT_EVENT,
  sendQualityAlert,
} from '../src/lib/qa/quality-alert-dispatch.ts';

const NOW = '2026-07-27T10:00:00.000Z';

const verdict = (
  subjectId: string,
  status: RegressionVerdict['status'],
  over: Partial<RegressionVerdict> = {},
): RegressionVerdict => ({
  subjectId,
  status,
  recentCount: 10,
  baselineCount: 20,
  recentQuality: status === 'regressed' ? 0.4 : 0.9,
  baselineQuality: 0.9,
  recentFaithfulness: 0.9,
  baselineFaithfulness: 0.9,
  dimensions: status === 'regressed' ? ['quality'] : [],
  detail: status === 'regressed' ? 'Answers are getting worse: quality fell from 0.9 to 0.4' : 'Holding steady',
  ...over,
});

const state = (subjectId: string, status: QualityAlertState['status']): QualityAlertState => ({
  subjectId,
  status,
  since: '2026-07-01T00:00:00.000Z',
});

// ─── the alert is news, once ──────────────────────────────────────────────────────────────────────

test('entering a regression tells someone, with the plain-language reason', () => {
  const { alerts, next } = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'regressed');
  assert.equal(alerts[0].subjectId, 'app:kyc');
  assert.match(alerts[0].detail, /getting worse/);
  assert.equal(alerts[0].at, NOW);
  assert.deepEqual(next, [{ subjectId: 'app:kyc', status: 'regressed', since: NOW }]);
});

test('staying regressed says nothing more — the alert is a transition, not a state', () => {
  // This is the anti-fatigue rule: re-firing every evaluation teaches people to filter the alert,
  // and then the one that matters gets filtered too.
  const { alerts, next } = planQualityAlerts(
    [state('app:kyc', 'regressed')],
    [verdict('app:kyc', 'regressed')],
    NOW,
  );
  assert.deepEqual(alerts, []);
  assert.equal(next[0].status, 'regressed');
  assert.equal(next[0].since, '2026-07-01T00:00:00.000Z'); // the original onset is preserved
});

test('recovering tells someone too — whoever got the bad news is owed the good', () => {
  const { alerts, next } = planQualityAlerts(
    [state('app:kyc', 'regressed')],
    [verdict('app:kyc', 'ok')],
    NOW,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'recovered');
  assert.match(alerts[0].detail, /recovered/);
  assert.deepEqual(next, [{ subjectId: 'app:kyc', status: 'clear', since: NOW }]);
});

test('a subject that was always fine is never mentioned', () => {
  assert.deepEqual(planQualityAlerts([], [verdict('app:kyc', 'ok')], NOW).alerts, []);
  assert.deepEqual(
    planQualityAlerts([state('app:kyc', 'clear')], [verdict('app:kyc', 'ok')], NOW).alerts,
    [],
  );
});

test('a regression can be reported again after a genuine recovery', () => {
  const first = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW);
  const recovered = planQualityAlerts(first.next, [verdict('app:kyc', 'ok')], NOW);
  const again = planQualityAlerts(recovered.next, [verdict('app:kyc', 'regressed')], NOW);

  assert.deepEqual([first.alerts[0].kind, recovered.alerts[0].kind, again.alerts[0].kind], [
    'regressed',
    'recovered',
    'regressed',
  ]);
});

// ─── going quiet is not recovery (the rule that keeps alerting alive) ─────────────────────────────

test('losing data does NOT read as recovery', () => {
  // The judge goes down, or traffic stops. Emitting an all-clear here is an all-clear nobody earned.
  const { alerts, next } = planQualityAlerts(
    [state('app:kyc', 'regressed')],
    [verdict('app:kyc', 'insufficient-data')],
    NOW,
  );
  assert.deepEqual(alerts, []);
  assert.equal(next[0].status, 'regressed', 'the regression must still be remembered');
});

test('data returning after a quiet spell does not re-alert an already-reported regression', () => {
  // The flapping this prevents: quiet → false all-clear → "regressed" again the moment data returns.
  const reported = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW);
  const quiet = planQualityAlerts(reported.next, [verdict('app:kyc', 'insufficient-data')], NOW);
  const back = planQualityAlerts(quiet.next, [verdict('app:kyc', 'regressed')], NOW);

  assert.deepEqual(quiet.alerts, []);
  assert.deepEqual(back.alerts, [], 'the operator was already told; do not tell them twice');
});

test('an unknown subject with no data is not remembered as anything', () => {
  const { alerts, next } = planQualityAlerts([], [verdict('app:new', 'insufficient-data')], NOW);
  assert.deepEqual(alerts, []);
  assert.deepEqual(next, []);
});

// ─── many subjects at once ────────────────────────────────────────────────────────────────────────

test('subjects are judged independently and the returned state is stable', () => {
  const { alerts, next } = planQualityAlerts(
    [state('app:b', 'regressed'), state('app:c', 'regressed')],
    [
      verdict('app:a', 'regressed'),
      verdict('app:b', 'ok'),
      verdict('app:c', 'regressed'),
      verdict('app:d', 'ok'),
    ],
    NOW,
  );

  assert.deepEqual(
    alerts.map((a) => [a.subjectId, a.kind]),
    [
      ['app:a', 'regressed'],
      ['app:b', 'recovered'],
    ],
  );
  assert.deepEqual(next.map((s) => s.subjectId), ['app:a', 'app:b', 'app:c', 'app:d']);
});

test('the subject line names the thing and the direction', () => {
  const [regressed] = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW).alerts;
  const [recovered] = planQualityAlerts(
    [state('app:kyc', 'regressed')],
    [verdict('app:kyc', 'ok')],
    NOW,
  ).alerts;

  assert.equal(alertSubjectLine(regressed), 'Answer quality is slipping: app:kyc');
  assert.equal(alertSubjectLine(recovered), 'Answer quality recovered: app:kyc');
});

// ─── delivery ─────────────────────────────────────────────────────────────────────────────────────

test('only an explicit http(s) destination counts as configured', () => {
  assert.equal(alertDestination({} as NodeJS.ProcessEnv), null);
  assert.equal(alertDestination({ OFFGRID_QUALITY_ALERT_WEBHOOK: '  ' } as NodeJS.ProcessEnv), null);
  assert.equal(
    alertDestination({ OFFGRID_QUALITY_ALERT_WEBHOOK: 'file:///etc/passwd' } as NodeJS.ProcessEnv),
    null,
  );
  assert.equal(
    alertDestination({ OFFGRID_QUALITY_ALERT_WEBHOOK: 'https://hooks.example.com/q' } as NodeJS.ProcessEnv),
    'https://hooks.example.com/q',
  );
});

test('the payload carries the whole story and is deterministic for a fixed time', () => {
  const [alert] = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW).alerts;
  const payload = buildQualityAlertPayload(alert, 'org_bharat', NOW);

  assert.equal(payload.event, QUALITY_ALERT_EVENT);
  assert.equal(payload.orgId, 'org_bharat');
  assert.equal(payload.kind, 'regressed');
  assert.equal(payload.subject, 'Answer quality is slipping: app:kyc');
  assert.equal(payload.recentQuality, 0.4);
  assert.equal(payload.baselineQuality, 0.9);
  assert.deepEqual(payload.dimensions, ['quality']);
  assert.deepEqual(buildQualityAlertPayload(alert, 'org_bharat', NOW), payload);
});

test('an unconfigured destination reports not-configured, never a fake success', () => {
  return (async () => {
    const [alert] = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW).alerts;
    const res = await sendQualityAlert(alert, 'default', null, () => new Date(NOW), {} as NodeJS.ProcessEnv);

    assert.equal(res.ok, false);
    assert.equal(res.configured, false);
    assert.match(res.reason, /not configured/);
  })();
});

test('a delivered alert is signed over exactly the bytes that were sent', async () => {
  const [alert] = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW).alerts;
  let seen: { url: string; body: string; signature: string } | null = null;

  const res = await sendQualityAlert(
    alert,
    'org_bharat',
    null,
    () => new Date(NOW),
    {
      OFFGRID_QUALITY_ALERT_WEBHOOK: 'https://hooks.example.com/q',
      OFFGRID_WEBHOOK_SECRET: 'test-secret',
    } as NodeJS.ProcessEnv,
    (async (url: string, init: RequestInit) => {
      seen = {
        url: String(url),
        body: String(init.body),
        signature: String((init.headers as Record<string, string>)['x-offgrid-signature']),
      };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch,
  );

  assert.equal(res.ok, true);
  assert.equal(res.configured, true);
  assert.equal(res.status, 200);
  assert.ok(seen, 'the destination was called');

  const sent = seen as unknown as { url: string; body: string; signature: string };
  assert.equal(sent.url, 'https://hooks.example.com/q');
  // The signature must be over the bytes actually transmitted, not a re-serialization.
  const { createHmac } = await import('node:crypto');
  assert.equal(sent.signature, createHmac('sha256', 'test-secret').update(sent.body).digest('hex'));
  assert.equal(res.signature, sent.signature);
  assert.equal(JSON.parse(sent.body).subjectId, 'app:kyc');
});

test('a destination that rejects or is unreachable is reported honestly', async () => {
  const [alert] = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW).alerts;
  const env = {
    OFFGRID_QUALITY_ALERT_WEBHOOK: 'https://hooks.example.com/q',
    OFFGRID_WEBHOOK_SECRET: 'test-secret',
  } as NodeJS.ProcessEnv;

  const rejected = await sendQualityAlert(alert, 'default', null, () => new Date(NOW), env, (async () =>
    new Response('nope', { status: 500 })) as unknown as typeof fetch);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.configured, true);
  assert.match(rejected.reason, /returned 500/);

  const down = await sendQualityAlert(alert, 'default', null, () => new Date(NOW), env, (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch);
  assert.equal(down.ok, false);
  assert.equal(down.configured, true);
  assert.match(down.reason, /unreachable/);
});

// ─── which destination wins (G-QUALITY-ALERT-DESTINATION) ─────────────────────────────────────────

test('a console destination beats the server env var', async () => {
  const { resolveDestination } = await import('../src/lib/qa/quality-alert-dispatch.ts');
  const env = { OFFGRID_QUALITY_ALERT_WEBHOOK: 'https://env.example.com/q' } as NodeJS.ProcessEnv;

  assert.deepEqual(resolveDestination({ url: 'https://console.example.com/q', enabled: true }, env), {
    url: 'https://console.example.com/q',
    source: 'console',
    paused: false,
  });
});

test('the env var still works for fleets configured before the console setting existed', async () => {
  const { resolveDestination } = await import('../src/lib/qa/quality-alert-dispatch.ts');
  const env = { OFFGRID_QUALITY_ALERT_WEBHOOK: 'https://env.example.com/q' } as NodeJS.ProcessEnv;

  assert.deepEqual(resolveDestination(null, env), {
    url: 'https://env.example.com/q',
    source: 'env',
    paused: false,
  });
});

test('pausing in the console silences alerts even when the env var is set', async () => {
  // Otherwise "pause" would appear to do nothing on a box that still has the env var configured —
  // the operator would believe alerts were off while they kept being delivered.
  const { resolveDestination } = await import('../src/lib/qa/quality-alert-dispatch.ts');
  const env = { OFFGRID_QUALITY_ALERT_WEBHOOK: 'https://env.example.com/q' } as NodeJS.ProcessEnv;

  assert.deepEqual(resolveDestination({ url: 'https://console.example.com/q', enabled: false }, env), {
    url: null,
    source: 'console',
    paused: true,
  });
});

test('nothing configured anywhere is reported as none, not as a silent success', async () => {
  const { resolveDestination } = await import('../src/lib/qa/quality-alert-dispatch.ts');
  assert.deepEqual(resolveDestination(null, {} as NodeJS.ProcessEnv), {
    url: null,
    source: 'none',
    paused: false,
  });
});

test('a stored destination that is not http(s) falls back rather than being trusted', async () => {
  // A bad row (hand-edited, or written before validation) must never become an egress target.
  const { resolveDestination } = await import('../src/lib/qa/quality-alert-dispatch.ts');
  const env = { OFFGRID_QUALITY_ALERT_WEBHOOK: 'https://env.example.com/q' } as NodeJS.ProcessEnv;

  assert.deepEqual(resolveDestination({ url: 'file:///etc/passwd', enabled: true }, env), {
    url: 'https://env.example.com/q',
    source: 'env',
    paused: false,
  });
});

test('one rule decides what a valid destination is, everywhere', async () => {
  const { validAlertUrl } = await import('../src/lib/qa/quality-alert-dispatch.ts');
  assert.equal(validAlertUrl('https://hooks.example.com/q'), 'https://hooks.example.com/q');
  assert.equal(validAlertUrl('  http://127.0.0.1:9000/x  '), 'http://127.0.0.1:9000/x');
  assert.equal(validAlertUrl('ftp://example.com'), null);
  assert.equal(validAlertUrl('javascript:alert(1)'), null);
  assert.equal(validAlertUrl(''), null);
  assert.equal(validAlertUrl(null), null);
  assert.equal(validAlertUrl(42), null);
});

test('an explicit destination overrides the env when sending', async () => {
  const { sendQualityAlert } = await import('../src/lib/qa/quality-alert-dispatch.ts');
  const [alert] = planQualityAlerts([], [verdict('app:kyc', 'regressed')], NOW).alerts;
  let calledUrl = '';

  await sendQualityAlert(
    alert,
    'default',
    'https://console.example.com/q',
    () => new Date(NOW),
    {
      OFFGRID_QUALITY_ALERT_WEBHOOK: 'https://env.example.com/q',
      OFFGRID_WEBHOOK_SECRET: 's',
    } as NodeJS.ProcessEnv,
    (async (url: string) => {
      calledUrl = String(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch,
  );

  assert.equal(calledUrl, 'https://console.example.com/q');
});
