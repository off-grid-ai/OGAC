import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCitations,
  buildCopilotPrompt,
  type CopilotContext,
} from '../src/lib/copilot-context.ts';
import { buildChatBody, factsFallback } from '../src/lib/copilot-gateway.ts';
import { gatherWith, deriveAnomalies } from '../src/lib/copilot-gather.ts';
import type { AuditRow } from '../src/lib/audit-log-view.ts';
import type { FinOps } from '../src/lib/finops.ts';

// PURE tests for the copilot context/prompt builder (M5). We DON'T mock the gateway in a way that
// hides behaviour — instead we test the prompt/context builder + the request shaper directly, and
// exercise the gather orchestration with fake readers.

function auditRow(over: Partial<AuditRow>): AuditRow {
  return {
    id: 'e1',
    ts: '2026-07-04T10:00:00Z',
    actorType: 'user',
    actor: 'alice',
    action: 'chat.send',
    project: 'support',
    resource: '',
    model: 'gemma-local',
    tokens: 100,
    costUsd: 0,
    outcome: 'ok',
    runId: '',
    ip: '',
    ...over,
  };
}

const finops: FinOps = {
  totals: { requests: 100, tokens: 5000, costUsd: 12.5, localShare: 60 },
  byModel: [{ label: 'cloud-claude', requests: 40, tokens: 3000, costUsd: 12.5 }],
  bySubject: [],
  byKey: [],
  daily: [
    { day: '2026-07-01', costUsd: 1 },
    { day: '2026-07-02', costUsd: 1.2 },
    { day: '2026-07-03', costUsd: 1.1 },
    { day: '2026-07-04', costUsd: 9.2 },
  ],
};

test('no data → hasData false and an honest no-data prompt', () => {
  const prompt = buildCopilotPrompt({ question: 'why is cost up?' });
  assert.equal(prompt.hasData, false);
  assert.equal(prompt.citations.length, 0);
  assert.match(prompt.user, /no facts available/i);
});

test('citations are numbered 1..n and only from present sources', () => {
  const ctx: CopilotContext = {
    question: 'what failed?',
    audit: {
      configured: true,
      rows: [auditRow({ outcome: 'error', runId: 'r1', action: 'agent.run' })],
    },
    finops,
  };
  const cites = buildCitations(ctx);
  assert.ok(cites.length >= 2);
  cites.forEach((c, i) => assert.equal(c.n, i + 1));
  // Drift/evals absent → no drift/evals citations.
  assert.ok(!cites.some((c) => c.source === 'drift'));
  assert.ok(!cites.some((c) => c.source === 'evals'));
  // The failing audit row is cited.
  assert.ok(cites.some((c) => c.source === 'audit' && /error/.test(c.text)));
});

test('failing audit events are prioritised before ok events', () => {
  const rows = [
    auditRow({ id: 'ok1', outcome: 'ok' }),
    auditRow({ id: 'err1', outcome: 'error', action: 'agent.run' }),
  ];
  const cites = buildCitations({ question: 'q', audit: { configured: true, rows } });
  const auditCites = cites.filter((c) => c.source === 'audit');
  assert.match(auditCites[0].text, /error/, 'the error is cited first');
});

test('prompt embeds numbered facts and instructs citation', () => {
  const prompt = buildCopilotPrompt({ question: 'why cost up', finops });
  assert.ok(prompt.hasData);
  assert.match(prompt.user, /\[1\]/);
  assert.match(prompt.system, /cite them inline as \[n\]/i);
  assert.match(prompt.system, /NEVER invent/);
});

test('buildChatBody shapes an OpenAI-compatible body with system+user', () => {
  const prompt = buildCopilotPrompt({ question: 'q', finops });
  const body = buildChatBody(prompt) as {
    messages: { role: string; content: string }[];
    stream: boolean;
    temperature: number;
  };
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.stream, false);
  assert.ok(body.temperature <= 0.2, 'low temperature for grounded answers');
});

test('factsFallback lists real facts, and says none when empty', () => {
  const prompt = buildCopilotPrompt({ question: 'q', finops });
  const withFacts = factsFallback(prompt.citations);
  assert.match(withFacts, /\[1\]/);
  const none = factsFallback([]);
  assert.match(none, /no platform records/i);
});

test('gatherWith orchestrates injected readers into a context', async () => {
  const ctx = await gatherWith('why cost up', {
    audit: async () => ({ configured: true, rows: [auditRow({})] }),
    finops: async () => finops,
    drift: async () => null,
    evals: async () => null,
  });
  assert.equal(ctx.question, 'why cost up');
  assert.equal(ctx.audit?.rows.length, 1);
  assert.ok(ctx.finops);
  assert.equal(ctx.drift, null);
  // The finops daily series has a spike on 07-04 → derived anomaly.
  assert.ok((ctx.anomalies?.length ?? 0) >= 1, 'anomaly derived from the cost spike');
});

test('deriveAnomalies flags the cost spike, none on a flat series', () => {
  assert.ok(deriveAnomalies(finops).length >= 1);
  const flat: FinOps = {
    ...finops,
    daily: [
      { day: 'a', costUsd: 1 },
      { day: 'b', costUsd: 1 },
      { day: 'c', costUsd: 1 },
      { day: 'd', costUsd: 1 },
      { day: 'e', costUsd: 1 },
    ],
  };
  assert.equal(deriveAnomalies(flat).length, 0);
});
