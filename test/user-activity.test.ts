import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildActivityPage,
  filterActivity,
  kindFromAction,
  mergeActivity,
  normalizeAgentRunRows,
  normalizeAuditRows,
  normalizeChatRows,
  normalizeVerdict,
  rollupActivity,
  type RawUserActivity,
} from '../src/lib/user-activity.ts';

// PURE unit tests for the admin user-activity aggregator — no DB, no network, real functions only.
// They pin merge/normalize/filter/paginate/rollup: the "see exactly what a user did" story built
// from in-memory audit + chat + agent-run + app-run rows.

function raw(over: Partial<RawUserActivity> = {}): RawUserActivity {
  return { audit: [], chat: [], agentRuns: [], appRuns: [], ...over };
}

test('normalizeVerdict folds producer outcomes onto canonical verdicts', () => {
  assert.equal(normalizeVerdict('ok'), 'allowed');
  assert.equal(normalizeVerdict('done'), 'allowed');
  assert.equal(normalizeVerdict('blocked'), 'blocked');
  assert.equal(normalizeVerdict('cancelled'), 'denied');
  assert.equal(normalizeVerdict('redacted'), 'redacted');
  assert.equal(normalizeVerdict('failed'), 'error');
  assert.equal(normalizeVerdict(''), 'unknown');
  assert.equal(normalizeVerdict(undefined), 'unknown');
});

test('kindFromAction buckets canonical actions', () => {
  assert.equal(kindFromAction('chat.run'), 'chat');
  assert.equal(kindFromAction('agent.run'), 'agent-run');
  assert.equal(kindFromAction('workflow.run'), 'app-run');
  assert.equal(kindFromAction('retrieval.query'), 'query');
  assert.equal(kindFromAction('policy.change'), 'governance');
  assert.equal(kindFromAction('access.user.change'), 'governance');
  assert.equal(kindFromAction('secret.write'), 'governance');
  assert.equal(kindFromAction('something.else'), 'action');
});

test('normalizeChatRows keeps only the user prompts (not assistant replies) with content', () => {
  const items = normalizeChatRows([
    {
      messageId: 'm1',
      conversationId: 'c1',
      conversationTitle: 'Q2 tax review',
      role: 'user',
      content: '  What is the GST rate for   NBFCs?  ',
      ts: '2026-07-01T10:00:00Z',
    },
    { messageId: 'm2', conversationId: 'c1', role: 'assistant', content: 'It is 18%.', ts: '2026-07-01T10:00:05Z' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'chat');
  assert.equal(items[0].content, 'What is the GST rate for NBFCs?'); // whitespace collapsed
  assert.equal(items[0].summary, 'Chat: Q2 tax review');
  assert.equal(items[0].verdict, 'allowed');
});

test('normalizeAgentRunRows derives a blocked verdict from guardrail checks', () => {
  const items = normalizeAgentRunRows([
    {
      id: 'run_1',
      agentId: 'invoice-triage',
      query: 'Process this PAN ABCDE1234F',
      status: 'done',
      checks: [{ name: 'pii', verdict: 'block' }],
      ts: '2026-07-02T09:00:00Z',
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].verdict, 'blocked'); // checks override a 'done' status
  assert.equal(items[0].runId, 'run_1');
  assert.equal(items[0].content, 'Process this PAN ABCDE1234F');
});

test('mergeActivity joins an audit event to its content row by runId (no doubling)', () => {
  const merged = mergeActivity(
    raw({
      audit: [
        {
          ts: '2026-07-02T09:00:00Z',
          actorId: 'mac@wednesday.is',
          action: 'agent.run',
          outcome: 'blocked',
          model: 'gemma-local',
          totalTokens: 1200,
          costUsd: 0.0,
          runId: 'run_1',
        },
      ],
      agentRuns: [
        { id: 'run_1', agentId: 'invoice-triage', query: 'the real prompt text', status: 'done', ts: '2026-07-02T09:00:00Z' },
      ],
    }),
  );
  // One merged item, not two.
  assert.equal(merged.length, 1);
  const it = merged[0];
  assert.equal(it.content, 'the real prompt text'); // content from the run row
  assert.equal(it.verdict, 'blocked'); // verdict from the audit event
  assert.equal(it.tokens, 1200); // tokens/cost from the audit event
  assert.equal(it.model, 'gemma-local');
});

test('mergeActivity keeps standalone audit + standalone content items and sorts newest-first', () => {
  const merged = mergeActivity(
    raw({
      audit: [
        { ts: '2026-07-01T08:00:00Z', actorId: 'u', action: 'policy.change', outcome: 'ok', resource: 'policy:default' },
      ],
      chat: [
        { messageId: 'm1', conversationId: 'c1', role: 'user', content: 'hello', ts: '2026-07-03T08:00:00Z' },
      ],
    }),
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].kind, 'chat'); // newest first
  assert.equal(merged[1].kind, 'governance');
});

test('filterActivity narrows by kind, verdict, free text and date range', () => {
  const merged = mergeActivity(
    raw({
      chat: [
        { messageId: 'm1', conversationId: 'c1', role: 'user', content: 'reconcile ledger', ts: '2026-07-01T00:00:00Z' },
        { messageId: 'm2', conversationId: 'c2', role: 'user', content: 'draft an email', ts: '2026-07-05T00:00:00Z' },
      ],
      audit: [
        { ts: '2026-07-03T00:00:00Z', actorId: 'u', action: 'retrieval.query', outcome: 'ok', resource: 'collection:tax' },
      ],
    }),
  );
  assert.equal(filterActivity(merged, { kind: 'chat' }).length, 2);
  assert.equal(filterActivity(merged, { kind: 'query' }).length, 1);
  assert.equal(filterActivity(merged, { q: 'ledger' }).length, 1);
  assert.equal(filterActivity(merged, { from: '2026-07-04T00:00:00Z' }).length, 1); // only m2
  assert.equal(filterActivity(merged, { to: '2026-07-02T00:00:00Z' }).length, 1); // only m1
});

test('rollupActivity counts by kind, enforcement, tokens and distinct models', () => {
  const r = rollupActivity(
    mergeActivity(
      raw({
        audit: [
          { ts: '2026-07-01T00:00:00Z', actorId: 'u', action: 'chat.run', outcome: 'blocked', model: 'gemma-local', totalTokens: 10, runId: 'r1' },
          { ts: '2026-07-02T00:00:00Z', actorId: 'u', action: 'retrieval.query', outcome: 'redacted', model: 'cloud-claude', totalTokens: 5 },
          { ts: '2026-07-03T00:00:00Z', actorId: 'u', action: 'policy.change', outcome: 'ok' },
        ],
      }),
    ),
  );
  assert.equal(r.total, 3);
  assert.equal(r.byKind.chat, 1);
  assert.equal(r.byKind.query, 1);
  assert.equal(r.byKind.governance, 1);
  assert.equal(r.blocked, 1);
  assert.equal(r.redacted, 1);
  assert.equal(r.tokens, 15);
  assert.deepEqual(r.models, ['cloud-claude', 'gemma-local']);
  assert.equal(r.firstTs, '2026-07-01T00:00:00.000Z');
  assert.equal(r.lastTs, '2026-07-03T00:00:00.000Z');
});

test('buildActivityPage paginates the filtered, merged, newest-first stream', () => {
  const chat = Array.from({ length: 5 }, (_, i) => ({
    messageId: `m${i}`,
    conversationId: 'c',
    role: 'user',
    content: `msg ${i}`,
    ts: `2026-07-0${i + 1}T00:00:00Z`,
  }));
  const page1 = buildActivityPage(raw({ chat }), { page: 1, size: 2 });
  assert.equal(page1.total, 5);
  assert.equal(page1.items.length, 2);
  assert.equal(page1.items[0].content, 'msg 4'); // newest first
  assert.equal(page1.rollup.total, 5); // rollup is over the whole filtered set, not the page

  const page3 = buildActivityPage(raw({ chat }), { page: 3, size: 2 });
  assert.equal(page3.items.length, 1); // remainder
  assert.equal(page3.items[0].content, 'msg 0');
});

test('normalizeAuditRows drops rows without a valid timestamp', () => {
  const items = normalizeAuditRows([
    { ts: 'not-a-date', actorId: 'u', action: 'chat.run', outcome: 'ok' },
    { ts: '2026-07-01T00:00:00Z', actorId: 'u', action: 'chat.run', outcome: 'ok' },
  ]);
  assert.equal(items.length, 1);
});

test('buildActivityPage over empty input yields an honest empty rollup', () => {
  const page = buildActivityPage(raw());
  assert.equal(page.total, 0);
  assert.equal(page.items.length, 0);
  assert.equal(page.rollup.total, 0);
  assert.equal(page.rollup.firstTs, null);
});
