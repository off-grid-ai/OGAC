// CHAT-RUN governance + durability glue (W1 + W2).
//
// The chat stream path (src/app/api/v1/chat/stream/route.ts) already enforced the pipeline
// data-allowlist + egress leash + routing (enforceDataAccess / enforceModelCall). What it SKIPPED,
// versus the agent path (agentrun.ts), was the guardrail floor on the MODEL path: the PII scan +
// injection screen on the inbound message, the output guardrail scan, and the trust-artifact
// fan-out (lineage + provenance). This module closes that gap and makes a chat turn a DURABLE run:
//
//   • PURE decisions (zero-I/O, unit-testable): the pre-check verdict → block/redact, the chat
//     data-class, the workflow-id derivation, the durable-enabled toggle. These mirror the pure
//     layers agentrun.ts leans on (checks/outcomeFromChecks + agent-run-durable).
//   • I/O helpers: runInboundGuardrails() (runChecks('pre') + getPii().scan, reusing the SAME
//     adapters the agent path uses — NOT reinvented), runOutboundGuardrails() (runChecks('post')),
//     and emitChatLineage() / signChatAnswer() (lineage + provenance, mirroring agentrun.ts 8a/7).
//
// SOLID: the run route stays a thin orchestrator — it calls these seams. The pure rules live here
// (and in checks.ts / pipeline-enforcement.ts); the I/O lives behind the adapter registry.

import { randomUUID } from 'node:crypto';
import { getLineage, getPii, getSigning } from '@/lib/adapters/registry';
import { type CheckResult, outcomeFromChecks, runChecks } from '@/lib/checks';
import { correlationIds } from '@/lib/correlation';
import { applyPiiEscalation, effectivePiiMasking } from '@/lib/pii-escalation';
import type { PipelineContract } from '@/lib/pipeline-enforcement';
import { enforceModelCall } from '@/lib/pipeline-enforcement';

// ─── durable identity (mirrors agent-run-durable.ts) ────────────────────────────────────────────

/** Task queue the chat-run worker + client agree on. Distinct from agent/app/inference queues. */
export const CHAT_TASK_QUEUE = 'offgrid-chat';

/**
 * Is the chat run dispatched to the durable Temporal runtime? True only when the operator opted in
 * (OFFGRID_QUEUE_ENABLED=1 — the fleet-wide async toggle — or the temporal runtime adapter). Any
 * other value keeps the inline path, the graceful default: a missing/failed Temporal never breaks
 * a chat turn. Same gate the agent/app runs use, so chat rides the exact same spine.
 */
export function chatDurableEnabled(env: Record<string, string | undefined> = {}): boolean {
  return env.OFFGRID_QUEUE_ENABLED === '1' || env.OFFGRID_ADAPTER_AGENTRUNTIME === 'temporal';
}

/** Mint a chat run id. Stable prefix so it's greppable across the four planes. */
export function newChatRunId(): string {
  return `chatrun_${randomUUID().slice(0, 8)}`;
}

/**
 * Derive the Temporal workflowId for a chat run. Embeds the runId (unique per submission) so it is
 * stable + idempotent — submitting the same runId twice reuses the same workflow. ASCII-safe for
 * Temporal's id constraints. Mirrors workflowIdFor / appWorkflowIdFor.
 */
export function chatWorkflowIdFor(conversationId: string, runId: string): string {
  const safeConv = (conversationId ?? '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64) || 'chat';
  return `chatrun-${safeConv}-${runId}`;
}

// ─── the durable chat-run record (what the workflow persists / reports) ─────────────────────────

/** Plain, JSON-serializable input handed to ChatRunWorkflow (carried across the Temporal boundary). */
export interface ChatRunWorkflowInput {
  runId: string;
  conversationId: string;
  userId: string;
  model: string;
  /** The inbound user message (already redacted upstream if the contract required masking). */
  query: string;
  /** The assistant output (empty on the input-blocked path). */
  answer: string;
  orgId?: string;
  project?: string | null;
  pipelineId?: string | null;
  /** The guardrail verdicts gathered on the model path (pre + post). */
  checks: CheckResult[];
  /** The citation refs the answer grounded on (for the lineage inputs). */
  refs: string[];
  /** Terminal status: 'done' | 'blocked' (input guardrail) | 'error'. */
  status: string;
}

/** What the chat-run workflow reports back. Mirrors AgentRunWorkflowResult. */
export interface ChatRunWorkflowResult {
  found: boolean;
  runId: string;
  status: string;
}

// ─── W2: the guardrail floor on the MODEL path (reuses checks.ts / getPii verbatim) ─────────────

export interface InboundGuardrailResult {
  /** The (possibly redacted) message text to send to the model. */
  text: string;
  /** The pre-phase check verdicts (pii + injection), to fold into the run record + audit. */
  checks: CheckResult[];
  /** true ⇒ an injection/blocked verdict — the run MUST refuse (matches the agent path). */
  blocked: boolean;
  /** true ⇒ PII was detected and the text was redacted before the model saw it. */
  redacted: boolean;
}

/**
 * Should the inbound message be redacted before the model sees it? The contract's guardrail overlay
 * (requirePiiMasking) is the authority — the SAME verdict the agent path resolves via enforceModelCall.
 * PURE. A null contract ⇒ false (legacy: chat never masked). This lets an operator's pipeline force
 * masking on the chat path exactly as it does on the agent/app path.
 */
export function chatRequiresMasking(contract: PipelineContract | null, dataClass: string): boolean {
  // The escalation decision = max(org floor, pipeline overlay), computed by the ONE pure authority
  // shared with agentrun / pipeline-execute / app-run. A null contract contributes nothing, so with
  // no pipeline the floor (false, here) stands — legacy chat never masked.
  return effectivePiiMasking(false, enforceModelCall(contract, dataClass));
}

/**
 * Run the inbound guardrail floor on the user message — the SAME runChecks('pre') + getPii().scan the
 * agent path runs, closing the audit gap. An injection/blocked verdict blocks the run (matches
 * runAgent). When the bound pipeline's contract requires PII masking, the detected PII is redacted
 * BEFORE the model sees it (getPii().scan returns the redacted text); otherwise the original text is
 * sent (the verdict is still recorded so the audit trail shows PII was present). orgId is threaded
 * explicitly so the deep PII config resolves without a request scope on the durable/worker path.
 */
export async function runInboundGuardrails(
  message: string,
  model: string,
  opts: { requireMasking: boolean; orgId?: string },
): Promise<InboundGuardrailResult> {
  const checks = await runChecks('pre', {
    phase: 'pre',
    input: message,
    model,
    orgId: opts.orgId,
  });
  const blocked = outcomeFromChecks(checks) === 'blocked';
  let text = message;
  let redacted = false;
  if (opts.requireMasking) {
    // The raw→redacted substitution is the SAME pure applyPiiEscalation() the agent/pipeline paths
    // use, so "the raw PAN/email never reaches the model when masking is escalated" is one rule.
    const scan = await getPii().scan(message, opts.orgId);
    const esc = applyPiiEscalation(message, true, scan);
    text = esc.text;
    redacted = esc.masked;
  }
  return { text, checks, blocked, redacted };
}

/**
 * PURE fail-CLOSED verdict for the inbound guardrail (SECURITY #236). The guardrail screen is a
 * SAFETY gate, so ANY failure to reach a verdict — the call threw, timed out, or otherwise returned
 * no result — MUST be treated as a BLOCK, never a pass. This is the ONE authority the chat route
 * consults so "a thrown/timed-out guardrail is a block, not a fall-through to the raw user input" is
 * a single, testable decision (mirrors the agent path's pre-guardrail refusal). `result` is the
 * InboundGuardrailResult when the screen completed, or null when it threw/timed out.
 */
export function inboundGuardrailBlocks(result: InboundGuardrailResult | null): boolean {
  // null ⇒ the guardrail failed to produce a verdict ⇒ fail closed (block). Otherwise honor its
  // explicit verdict (an injection/blocked screen is a block; a clean screen passes).
  return result === null || result.blocked === true;
}

/**
 * PURE fail-CLOSED verdict for the OUTBOUND guardrail (SECURITY #236). The output scan is a safety
 * gate on what LEAVES to the user, so a screen that threw/timed out (checks === null) MUST NOT be
 * treated as "clean" — it blocks. A completed scan blocks when any of its checks reached a blocked
 * outcome; a clean, completed scan passes. This lets the route refuse to release raw model output
 * whenever the guardrail could not clear it.
 */
export function outboundGuardrailBlocks(checks: CheckResult[] | null): boolean {
  if (checks === null) return true; // screen failed to run ⇒ fail closed
  return outcomeFromChecks(checks) === 'blocked';
}

/** Run the outbound guardrail scan on the answer (recorded, non-blocking — mirrors runAgent step 6). */
export async function runOutboundGuardrails(
  answer: string,
  model: string,
  orgId?: string,
): Promise<CheckResult[]> {
  return runChecks('post', { phase: 'post', output: answer, model, orgId });
}

// ─── W2: trust artifacts — lineage + provenance, mirroring agentrun.ts ──────────────────────────

export interface ChatProvenance {
  signature: string;
  algorithm: string;
  publicKey: string | null;
  signedAt: string;
}

/**
 * Sign the chat answer (ed25519/HMAC via the signing port) so it is tamper-evident and correlated by
 * the run id — the SAME provenanceRef binding agentrun.ts uses (step 7). The only I/O is the
 * in-process signing key; no network. Returns null on any signing failure so provenance is
 * best-effort and never breaks the chat turn.
 */
export function signChatAnswer(input: {
  runId: string;
  conversationId: string;
  query: string;
  answer: string;
  refs: string[];
}): ChatProvenance | null {
  try {
    const signing = getSigning();
    return {
      signature: signing.sign({
        runId: correlationIds(input.runId).provenanceRef,
        conversationId: input.conversationId,
        query: input.query,
        answer: input.answer,
        refs: input.refs,
      }),
      algorithm: signing.algorithm,
      publicKey: signing.publicKey(),
      signedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Emit the source→answer lineage edge for a completed chat run, mirroring agentrun.ts step 8a: the
 * SAME runId lands in the lineage plane, correlated by one key. Fire-and-forget / best-effort — a
 * plane being down never fails the run.
 */
export function emitChatLineage(input: {
  runId: string;
  conversationId: string;
  refs: string[];
}): void {
  const ids = correlationIds(input.runId);
  void getLineage()
    .emit({
      job: `chat:${input.conversationId || 'temporary'}`,
      run: ids.lineageRunId,
      status: 'COMPLETE',
      inputs: input.refs,
      outputs: [input.runId],
    })
    .catch(() => {});
}
