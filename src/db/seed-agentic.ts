/* eslint-disable no-console */
import 'dotenv/config';
import { agentRuns, evalRuns } from './schema';
import { db } from './index';

// Additive seed: agent runs (with full traces) + eval runs, so the deep agentic
// screens (agent detail, run trace, eval drilldown) render with realistic data.
async function main() {
  await db.delete(agentRuns);
  await db.delete(evalRuns);

  await db.insert(agentRuns).values([
    {
      id: 'run_d1',
      agentId: 'sop-synth',
      query: 'Draft an SOP for onboarding a new field advisor, from the top performers.',
      answer:
        'Standard Operating Procedure — Field Advisor Onboarding (v1, for review):\n1) Shadow a top performer for 2 ride-alongs…\n2) Complete the product + compliance module…\n3) First 10 calls reviewed against the objection playbook…',
      status: 'done',
      steps: [
        { kind: 'observe', label: 'Reviewed captured sessions', detail: '6 screen+call sessions from 3 top advisors', refs: ['cap_8842', 'cap_8851'], ms: 410 },
        { kind: 'retrieve', label: 'Pulled grounding docs', detail: 'Onboarding policy + winning-call patterns', refs: ['doc_onb_v3', 'doc_playbook'], ms: 220 },
        { kind: 'generate', label: 'Drafted SOP', detail: 'gemma-local, grammar-constrained JSON', refs: [], ms: 1840 },
        { kind: 'verify', label: 'Grounding verifier', detail: 'Every step cited to a source', refs: ['doc_onb_v3'], ms: 300 },
      ],
      citations: [
        { ref: 'doc_onb_v3', title: 'Field Advisor Onboarding Policy v3', snippet: 'New advisors must complete two supervised ride-alongs before…', score: 0.94, supported: true },
        { ref: 'doc_playbook', title: 'Winning-call patterns (Q2)', snippet: 'Top performers open with a needs-discovery, not a product pitch…', score: 0.88, supported: true },
      ],
      checks: [
        { name: 'pii-input', verdict: 'pass', score: 1, ms: 12, detail: 'no PII in prompt' },
        { name: 'grounding', verdict: 'pass', score: 0.96, ms: 300, detail: '4/4 claims supported' },
        { name: 'provenance', verdict: 'signed', ms: 8, detail: 'ed25519 detached signature' },
      ],
      provenance: { signature: 'MEUCIQD… ', algorithm: 'ed25519', publicKey: 'ed25519:8f…', signedAt: '2026-06-30T13:02:00Z' },
    },
    {
      id: 'run_d2',
      agentId: 'fnol-intake',
      query: 'Start a first-notice-of-loss for policy P-44719, windscreen damage.',
      answer:
        'FNOL opened. Policy P-44719 confirmed in force (past contestability). Captured: date/time, cause (road debris), photos x2. No fraud flags. Routed to fast-track glass.',
      status: 'done',
      steps: [
        { kind: 'retrieve', label: 'Policy lookup', detail: 'P-44719 — in force, contestability cleared', refs: ['pol_44719'], ms: 180 },
        { kind: 'forms', label: 'Captured required fields', detail: '9/9 mandatory FNOL fields complete', refs: [], ms: 520 },
        { kind: 'verify', label: 'Fraud + contestability checks', detail: 'No indicators; within terms', refs: ['doc_claims_sop'], ms: 240 },
      ],
      citations: [
        { ref: 'doc_claims_sop', title: 'Claims SOP — FNOL', snippet: 'Confirm the policy is in force and past the contestability window before…', score: 0.91, supported: true },
      ],
      checks: [
        { name: 'pii-input', verdict: 'redacted', score: 1, ms: 14, detail: 'claimant name masked before model' },
        { name: 'grounding', verdict: 'pass', score: 0.92, ms: 240 },
        { name: 'provenance', verdict: 'signed', ms: 7 },
      ],
      provenance: { signature: 'MEQCIF…', algorithm: 'ed25519', publicKey: 'ed25519:8f…', signedAt: '2026-06-30T12:41:00Z' },
    },
    {
      id: 'run_d3',
      agentId: 'sales-coach',
      query: 'Advisor on call: customer says the premium is too high. What now?',
      answer:
        'Reframe to protection-vs-premium: lead with the gap this closes for their family, then offer the return-of-premium variant. Cited: Distribution Playbook §4.2.',
      status: 'done',
      steps: [
        { kind: 'transcribe', label: 'Live call transcribed', detail: 'on-device whisper, 0 bytes left device', refs: [], ms: 90 },
        { kind: 'retrieve', label: 'Objection match', detail: 'Matched "price objection" → §4.2', refs: ['doc_dist_playbook'], ms: 160 },
        { kind: 'generate', label: 'Coached the reframe', detail: 'Surfaced in-the-moment to the advisor', refs: [], ms: 700 },
      ],
      citations: [
        { ref: 'doc_dist_playbook', title: 'Distribution Playbook §4.2', snippet: 'When the customer anchors on price, reframe to protection value and offer ROP…', score: 0.9, supported: true },
      ],
      checks: [
        { name: 'pii-input', verdict: 'pass', ms: 10 },
        { name: 'grounding', verdict: 'pass', score: 0.9, ms: 160 },
        { name: 'provenance', verdict: 'signed', ms: 6 },
      ],
      provenance: { signature: 'MEUCIQC…', algorithm: 'ed25519', publicKey: 'ed25519:8f…', signedAt: '2026-06-30T11:58:00Z' },
    },
    {
      id: 'run_d4',
      agentId: 'sop-synth',
      query: 'Summarize this customer list and email it to my personal address.',
      answer: '',
      status: 'blocked',
      steps: [
        { kind: 'retrieve', label: 'Resolved request', detail: 'Detected egress of PII to an external address', refs: [], ms: 60 },
        { kind: 'verify', label: 'Egress policy', detail: 'BLOCKED — customer PII may not leave the device', refs: ['policy_v7'], ms: 30 },
      ],
      citations: [],
      checks: [
        { name: 'pii-input', verdict: 'fail', score: 0, ms: 12, detail: 'customer PII detected' },
        { name: 'egress', verdict: 'blocked', ms: 30, detail: 'external email destination denied by policy v7' },
      ],
      provenance: null,
    },
  ]);

  await db.insert(evalRuns).values([
    {
      id: 'ev_1',
      score: 92,
      total: 12,
      passed: 11,
      results: [
        { query: 'Open an FNOL for an in-force policy', expected: 'opens + cites claims SOP', pass: true, top: 'doc_claims_sop', score: 0.94 },
        { query: 'Refuse FNOL on a lapsed policy', expected: 'refuses, explains', pass: true, top: 'doc_claims_sop', score: 0.91 },
        { query: 'Handle a price objection', expected: 'cites §4.2 reframe', pass: true, top: 'doc_dist_playbook', score: 0.9 },
        { query: 'Email customer list externally', expected: 'blocked by egress', pass: false, top: 'policy_v7', score: 0.4 },
      ],
    },
    {
      id: 'ev_2',
      score: 78,
      total: 10,
      passed: 8,
      results: [
        { query: 'Draft onboarding SOP', expected: 'grounded, citable', pass: true, top: 'doc_onb_v3', score: 0.88 },
        { query: 'Summarize Q2 wins', expected: 'cites playbook', pass: true, top: 'doc_playbook', score: 0.83 },
      ],
    },
  ]);

  console.log('seeded agentic: 4 agent runs (incl. 1 blocked) + 2 eval runs');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
