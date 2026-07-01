import { randomUUID } from 'crypto';

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
  // Optional metrics — a generation observation records these when present.
  startTime?: number; // epoch ms when the upstream request began
  endTime?: number; // epoch ms when the completion finalized
  promptTokens?: number;
  completionTokens?: number;
}

// Build the two-event ingestion batch: a 'chat' trace plus a nested generation observation.
function buildBatch(t: ChatTraceInput): unknown[] {
  const traceId = randomUUID();
  const start = t.startTime ?? Date.now();
  const end = t.endTime ?? start;
  const startISO = new Date(start).toISOString();
  const endISO = new Date(end).toISOString();
  const hasUsage = t.promptTokens !== undefined || t.completionTokens !== undefined;
  const usage = hasUsage
    ? { input: t.promptTokens, output: t.completionTokens, unit: 'TOKENS' }
    : undefined;
  return [
    {
      id: randomUUID(),
      type: 'trace-create',
      timestamp: startISO,
      body: {
        id: traceId,
        name: 'chat',
        timestamp: startISO,
        userId: t.userId,
        sessionId: t.conversationId || undefined,
        input: t.input,
        output: t.output,
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
    body: JSON.stringify({ batch: buildBatch(t) }),
    signal: AbortSignal.timeout(3000),
  });
}

// Fire-and-forget entry point for the chat route. Never rejects into the caller.
export function emitChatTrace(t: ChatTraceInput): void {
  if (!configured() || !t.output) return;
  void postTrace(t).catch(() => {});
}
