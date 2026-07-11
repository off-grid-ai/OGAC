import { randomUUID } from 'node:crypto';
import { correlationIds } from '@/lib/correlation';
import { pipelineTagOrNull } from '@/lib/pipeline-api-key-format';

// Chat -> Langfuse trace emission. Plain chat completions never pushed a trace (only the agent-run
// pipeline did via OTLP), so the Observability page's trace list was empty. This posts a trace +
// generation observation per chat turn through Langfuse's public ingestion API (Basic auth, same
// key pair as src/lib/langfuse.ts reads with). Fire-and-forget: it never blocks or throws into the
// chat path, and no-ops when Langfuse env is unset.
const BASE = process.env.OFFGRID_LANGFUSE_URL;
const PK = process.env.OFFGRID_LANGFUSE_PUBLIC_KEY;
const SK = process.env.OFFGRID_LANGFUSE_SECRET_KEY;

// Derive Basic-auth header. Prefer explicit pk/sk; otherwise reuse the base64 OTLP auth blob
// (mirrors langfuse.ts so a single set of credentials drives both read-back and push).
function authHeader(): string | null {
  if (PK && SK) return `Basic ${Buffer.from(`${PK}:${SK}`).toString('base64')}`;
  const otlp = process.env.OFFGRID_LANGFUSE_AUTH;
  return otlp ? `Basic ${otlp}` : null;
}

function configured(): boolean {
  return Boolean(BASE) && authHeader() !== null;
}

export interface ChatTraceInput {
  conversationId: string;
  userId: string;
  model: string;
  input: string;
  output: string;
  // Optional deterministic trace id. Chat turns leave it unset (a random id is minted). A GOVERNED
  // RUN passes the run's `traceId` (== normalized runId) so the Langfuse trace is correlated with the
  // audit/lineage/provenance planes by the one run id (C2).
  traceId?: string;
  // Optional trace name — defaults to 'chat'; governed runs use 'agent-run'.
  name?: string;
  // Optional metrics — a generation observation records these when present.
  startTime?: number; // epoch ms when the upstream request began
  endTime?: number; // epoch ms when the completion finalized
  promptTokens?: number;
  completionTokens?: number;
  // PA-12 — the run's bound pipeline id (most-specific-wins binding), if any. When set, the trace is
  // stamped at the SOURCE with the canonical `pipeline:<id>` tag (Langfuse `tags[]`) + a `pipelineId`
  // metadata field, so the pipeline Observability tab + global Observability filter EXACTLY on it.
  // Absent/null ⇒ no pipeline tag is added (unchanged legacy behaviour).
  pipelineId?: string | null;
}

// Build the two-event ingestion batch: a trace plus a nested generation observation. PURE + zero-I/O
// (the only nondeterminism is randomUUID for the event ids / default trace id) so the pipeline-tag
// stamping is exhaustively unit-testable without the live Langfuse — see test/chat-trace-batch.test.ts.
export function buildTraceBatch(t: ChatTraceInput): unknown[] {
  const traceId = t.traceId || randomUUID();
  const traceName = t.name || 'chat';
  const start = t.startTime ?? Date.now();
  const end = t.endTime ?? start;
  const startISO = new Date(start).toISOString();
  const endISO = new Date(end).toISOString();
  const hasUsage = t.promptTokens !== undefined || t.completionTokens !== undefined;
  const usage = hasUsage
    ? { input: t.promptTokens, output: t.completionTokens, unit: 'TOKENS' }
    : undefined;
  // Canonical pipeline tag at the SOURCE. A run with no bound pipeline yields null ⇒ no tag/metadata
  // is added (the trace is byte-identical to today for un-piped runs).
  const pipelineTag = pipelineTagOrNull(t.pipelineId);
  const tags = pipelineTag ? [pipelineTag] : undefined;
  const metadata = pipelineTag ? { pipelineId: (t.pipelineId ?? '').trim() } : undefined;
  return [
    {
      id: randomUUID(),
      type: 'trace-create',
      timestamp: startISO,
      body: {
        id: traceId,
        name: traceName,
        timestamp: startISO,
        userId: t.userId,
        sessionId: t.conversationId || undefined,
        input: t.input,
        output: t.output,
        ...(tags ? { tags } : {}),
        ...(metadata ? { metadata } : {}),
      },
    },
    {
      id: randomUUID(),
      type: 'generation-create',
      timestamp: startISO,
      body: {
        id: randomUUID(),
        traceId,
        name: 'chat-completion',
        startTime: startISO,
        endTime: endISO,
        model: t.model || undefined,
        input: t.input,
        output: t.output,
        usage,
      },
    },
  ];
}

// Push a 'chat' trace with a nested generation observation in one ingestion batch.
async function postTrace(t: ChatTraceInput): Promise<void> {
  const auth = authHeader();
  if (!BASE || !auth) return;
  await fetch(`${BASE}/api/public/ingestion`, {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ batch: buildTraceBatch(t) }),
    signal: AbortSignal.timeout(3000),
  });
}

// Fire-and-forget entry point for the chat route. Never rejects into the caller.
export function emitChatTrace(t: ChatTraceInput): void {
  if (!configured() || !t.output) return;
  void postTrace(t).catch(() => {});
}

// Fire-and-forget entry point for a GOVERNED AGENT RUN. Emits a Langfuse trace whose id is the run's
// deterministic `traceId` (== normalized runId), so `traceId === normalize(runId)` and the C2 harness
// finds it at GET /api/public/traces/<traceId>. Unlike the sampled/flag-gated online QA score, this
// fires for EVERY run so the trace plane is reliably correlated. Best-effort: never blocks the run.
export function emitRunTrace(t: {
  runId: string;
  agentId: string;
  model: string;
  input: string;
  output: string;
  caller?: string;
  // PA-12 — the run's bound pipeline id (from the resolved binding on the run context), if any.
  // Stamped as the canonical `pipeline:<id>` tag at the SOURCE. Absent/null ⇒ no pipeline tag.
  pipelineId?: string | null;
}): void {
  if (!configured() || !t.output) return;
  void postTrace({
    conversationId: t.runId,
    userId: t.caller || 'agent',
    model: t.model,
    input: t.input,
    output: t.output,
    traceId: correlationIds(t.runId).traceId,
    name: 'agent-run',
    pipelineId: t.pipelineId ?? null,
  }).catch(() => {});
}
