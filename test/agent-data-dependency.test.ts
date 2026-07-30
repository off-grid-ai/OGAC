import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  candidatePhrases,
  ensureAgentDataReads,
  insertionNote,
  type DependencyStep,
} from '../src/lib/agent-data-dependency.ts';
import type { DataDomain } from '../src/lib/data-domains.ts';

// ── B3.1 — an agent must not reason about data no step reads ───────────────────────────────────────
//
// LIVE FINDING (2026-07-30). Compiling "…read the claim, check that employee's remaining reimbursement
// quota, decide whether it is within quota…" produced:
//   s1 connector-query expense claims
//   s2 agent "Determine if the claim amount exceeds the employee's remaining reimbursement quota"
//   s3 human · s4 output
// The quota is never read. The spec validates, the app runs, and it answers from data it does not have —
// and `gaps` was EMPTY, so the author had no signal at all.

function domain(id: string, label: string): DataDomain {
  return { id, orgId: 'org_x', label, aliases: [], connectorId: 'con_x', resource: label } as DataDomain;
}
const QUOTA = domain('dom_quota', 'reimbursement quota');
const CLAIMS = domain('dom_claims', 'expense claims');

/** The caller's real resolution rule, stubbed over a small declared set. */
const resolve = (phrase: string): DataDomain | null => {
  const p = phrase.toLowerCase();
  if (p === 'reimbursement quota' || p === 'remaining reimbursement quota') return QUOTA;
  if (p === 'expense claims' || p === 'expense claim') return CLAIMS;
  return null;
};
const makeRead = (d: DataDomain, id: string): DependencyStep => ({
  id,
  kind: 'connector-query',
  label: `Read ${d.label}`,
  domain: d.id,
});

const DESC =
  "When an employee submits an expense claim, read the claim, check that employee's remaining " +
  'reimbursement quota, decide whether it is within quota, have a manager approve it.';

describe('B3.1 — ensureAgentDataReads', () => {
  test('inserts the missing read before the agent that reasons about it', () => {
    const steps: DependencyStep[] = [
      { id: 's1', kind: 'connector-query', label: 'Read Expense Claim', domain: CLAIMS.id },
      {
        id: 's2',
        kind: 'agent',
        label: 'Check Against Reimbursement Quota',
        inlineAgent: {
          systemPrompt: "Determine if the claim amount exceeds the employee's remaining reimbursement quota.",
        },
      },
      { id: 's3', kind: 'human', label: 'Manager Approval' },
    ];
    const { steps: out, inserted } = ensureAgentDataReads(steps, DESC, resolve, makeRead);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].domainId, QUOTA.id);
    // The read must land BEFORE the agent — a read afterwards does the agent no good at all.
    const readAt = out.findIndex((s) => s.domain === QUOTA.id);
    const agentAt = out.findIndex((s) => s.id === 's2');
    assert.ok(readAt >= 0 && readAt < agentAt, JSON.stringify(out.map((s) => s.id)));
  });

  test('does nothing when the data is already read earlier', () => {
    const steps: DependencyStep[] = [
      { id: 's1', kind: 'connector-query', label: 'Read quota', domain: QUOTA.id },
      { id: 's2', kind: 'agent', label: 'Check reimbursement quota', inlineAgent: { systemPrompt: 'compare' } },
    ];
    const { inserted } = ensureAgentDataReads(steps, DESC, resolve, makeRead);
    assert.deepEqual(inserted, []);
  });

  test('a read AFTER the agent still counts as missing', () => {
    // Order is the whole point: fetching the quota after the decision cannot inform the decision.
    const steps: DependencyStep[] = [
      { id: 's1', kind: 'agent', label: 'Check reimbursement quota', inlineAgent: { systemPrompt: 'x' } },
      { id: 's2', kind: 'connector-query', label: 'Read quota', domain: QUOTA.id },
    ];
    const { inserted } = ensureAgentDataReads(steps, DESC, resolve, makeRead);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].domainId, QUOTA.id);
  });

  // ── The false positive my own first version introduced, pinned. ──
  test('does not add a BROADER sibling domain when a specific one is already read', () => {
    // Live: an expense-claim app reads "expense claims"; the agent prompt says "if the claim amount
    // exceeds…". "the claim amount" fuzzily resolves to the org's separate INSURANCE "claims" table, so
    // the pass added a read of insurance claims to an expense-claim app — reintroducing exactly the
    // mis-binding phrase-qualifier.ts exists to prevent.
    const INSURANCE = domain('dom_insurance_claims', 'claims');
    const resolveBoth = (phrase: string): DataDomain | null => {
      const p = phrase.toLowerCase();
      if (p.includes('reimbursement quota')) return QUOTA;
      if (p.includes('expense claim')) return CLAIMS;
      if (p.includes('claim')) return INSURANCE; // the fuzzy sibling
      return null;
    };
    const steps: DependencyStep[] = [
      { id: 's1', kind: 'connector-query', label: 'Read expense claims', domain: CLAIMS.id },
      {
        id: 's2',
        kind: 'agent',
        label: 'Check Against Reimbursement Quota',
        inlineAgent: { systemPrompt: "Determine if the claim amount exceeds the employee's remaining reimbursement quota." },
      },
    ];
    const { inserted } = ensureAgentDataReads(steps, DESC, resolveBoth, makeRead);
    assert.deepEqual(
      inserted.map((i) => i.domainId),
      [QUOTA.id],
      'must add the quota and NOT the insurance claims table',
    );
  });

  test('never invents a source for a phrase that resolves to nothing', () => {
    const steps: DependencyStep[] = [
      { id: 's1', kind: 'agent', label: 'Consult the astrology almanac', inlineAgent: { systemPrompt: 'divine it' } },
    ];
    const { steps: out, inserted } = ensureAgentDataReads(steps, DESC, resolve, makeRead);
    assert.deepEqual(inserted, []);
    assert.equal(out.length, 1);
  });

  test('inserts each domain once even when the prompt names it repeatedly', () => {
    const steps: DependencyStep[] = [
      {
        id: 's1',
        kind: 'agent',
        label: 'Reimbursement quota check',
        inlineAgent: { systemPrompt: 'compare against the reimbursement quota and the reimbursement quota again' },
      },
    ];
    const { inserted } = ensureAgentDataReads(steps, DESC, resolve, makeRead);
    assert.equal(inserted.length, 1);
  });

  test('leaves non-agent steps untouched and preserves order', () => {
    const steps: DependencyStep[] = [
      { id: 's1', kind: 'guardrail', label: 'Safety' },
      { id: 's2', kind: 'human', label: 'Approve' },
      { id: 's3', kind: 'output', label: 'Send' },
    ];
    const { steps: out, inserted } = ensureAgentDataReads(steps, DESC, resolve, makeRead);
    assert.deepEqual(inserted, []);
    assert.deepEqual(out.map((s) => s.id), ['s1', 's2', 's3']);
  });
});

describe('B3.1 — candidatePhrases', () => {
  test('yields multi-word windows, not single words', () => {
    const p = candidatePhrases({ id: 'x', kind: 'agent', label: 'Check Reimbursement Quota' });
    assert.ok(p.includes('reimbursement quota'));
    // A single word is too weak to bind — "claim" alone is exactly the mis-binding this guards against.
    assert.ok(!p.includes('quota'));
  });

  test('draws from the prompt as well as the label', () => {
    const p = candidatePhrases({
      id: 'x',
      kind: 'agent',
      label: 'Decide',
      inlineAgent: { systemPrompt: 'compare with the reimbursement quota' },
    });
    assert.ok(p.includes('reimbursement quota'));
  });

  test('tolerates a step with neither label nor prompt', () => {
    assert.deepEqual(candidatePhrases({ id: 'x', kind: 'agent' }), []);
  });
});

describe('B3.1 — insertionNote', () => {
  test('names the domain and the step, so the change is never silent', () => {
    const note = insertionNote('reimbursement quota', 'Check Against Reimbursement Quota');
    assert.match(note, /reimbursement quota/);
    assert.match(note, /Check Against Reimbursement Quota/);
  });
});
