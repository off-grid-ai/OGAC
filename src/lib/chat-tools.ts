import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { tools } from '@/db/schema';

// Org connectors as chat tools — the console's `tools` registry (http | mcp) exposed to the model
// as OpenAI-style function tools, RBAC-scoped per role. Mutating tools are gated behind a human
// approval step in the chat UI before execution. Additive columns are created idempotently so this
// deploys with no migration step (matches the chat module's ensure* pattern).

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

let ensured = false;
async function ensureToolCols(): Promise<void> {
  if (ensured) return;
  await db.execute(sql`ALTER TABLE tools ADD COLUMN IF NOT EXISTS allowed_roles jsonb NOT NULL DEFAULT '[]';`);
  await db.execute(sql`ALTER TABLE tools ADD COLUMN IF NOT EXISTS mutating boolean NOT NULL DEFAULT false;`);
  await db.execute(sql`ALTER TABLE tools ADD COLUMN IF NOT EXISTS policy text NOT NULL DEFAULT 'approval';`);
  ensured = true;
}

// Per-connector action policy: 'allow' runs immediately, 'approval' routes through the human gate,
// 'blocked' refuses execution. 'approval' is the safe default (also applied to legacy mutating tools).
export type ToolPolicy = 'allow' | 'approval' | 'blocked';

export interface ChatTool {
  id: string;
  name: string;
  type: string; // 'http' | 'mcp'
  endpoint: string;
  description: string;
  mutating: boolean;
  policy: ToolPolicy;
}

// Enabled tools the given role may use (empty allowedRoles = everyone; admin sees all).
export async function listPermittedTools(role: string): Promise<ChatTool[]> {
  await ensureToolCols();
  const rows = await db.execute(sql`
    SELECT id, name, type, endpoint, description, enabled,
           COALESCE(allowed_roles, '[]'::jsonb) AS allowed_roles,
           COALESCE(mutating, false) AS mutating,
           COALESCE(policy, 'approval') AS policy
    FROM tools`);
  const list = (rows as unknown as { rows?: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
  return (list as Record<string, unknown>[])
    .filter((t) => t.enabled !== false)
    .filter((t) => {
      if (role === 'admin') return true;
      const roles = (t.allowed_roles as string[] | null) ?? [];
      return !roles.length || roles.includes(role);
    })
    .map((t) => ({
      id: String(t.id),
      name: String(t.name),
      type: String(t.type),
      endpoint: String(t.endpoint ?? ''),
      description: String(t.description ?? ''),
      mutating: Boolean(t.mutating),
      policy: (['allow', 'approval', 'blocked'].includes(String(t.policy))
        ? String(t.policy)
        : 'approval') as ToolPolicy,
    }));
}

// Sanitize a tool name into a valid OpenAI function name.
function fnName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'tool';
}

// OpenAI-style tool specs for the chat completion request. All take a single free-form `input`
// string; the tool's description carries the when/how so the model can decide.
export function toOpenAiTools(list: ChatTool[]) {
  return list.map((t) => ({
    type: 'function' as const,
    function: {
      name: fnName(t.name),
      description: t.description || `Invoke the ${t.name} connector.`,
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input/arguments for the tool (JSON or text).' },
        },
        required: ['input'],
      },
    },
  }),
  );
}

export function findToolByFnName(list: ChatTool[], name: string): ChatTool | undefined {
  return list.find((t) => fnName(t.name) === name);
}

// Execute a tool call. HTTP tools POST {input} to the endpoint; MCP tools call the endpoint's
// JSON-RPC tools/call. Returns a string result fed back to the model. Best-effort with a timeout.
// eslint-disable-next-line complexity
export async function executeTool(tool: ChatTool, input: string): Promise<string> {
  try {
    if (tool.type === 'mcp') {
      const r = await fetch(tool.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: tool.name, arguments: { input } },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) return `tool error: HTTP ${r.status}`;
      const j = await r.json().catch(() => null);
      const content = j?.result?.content;
      if (Array.isArray(content)) return content.map((c: { text?: string }) => c.text ?? '').join('\n');
      return JSON.stringify(j?.result ?? j ?? {}).slice(0, 4000);
    }
    // http
    const r = await fetch(tool.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return `tool error: HTTP ${r.status}`;
    const text = await r.text();
    return text.slice(0, 4000);
  } catch (e) {
    return `tool error: ${(e as Error).message}`;
  }
}

// Ask the gateway (non-streaming) for a tool-call decision given the assembled messages + tools.
// Returns the assistant message (may contain tool_calls) or null on failure.
export async function requestToolDecision(
  messages: unknown[],
  openAiTools: unknown[],
  model: string,
): Promise<{ content?: string; tool_calls?: ToolCall[] } | null> {
  const payload: Record<string, unknown> = {
    messages,
    tools: openAiTools,
    tool_choice: 'auto',
    max_tokens: 1024,
    temperature: 0.7,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (model) payload.model = model;
  const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.choices?.[0]?.message ?? null;
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

function parseInput(argsJson: string): string {
  try {
    const o = JSON.parse(argsJson);
    return typeof o?.input === 'string' ? o.input : JSON.stringify(o);
  } catch {
    return argsJson;
  }
}

export interface ToolResolution {
  // extra messages to append before the final streamed answer (assistant tool_calls + tool results)
  messages: { role: string; content: string; tool_call_id?: string; tool_calls?: ToolCall[] }[];
  // a pending mutating call needing human approval (client re-submits with approvals)
  pending?: { fn: string; toolName: string; input: string }[];
  // tool activity to surface in the UI transcript
  activity: { tool: string; input: string; output?: string; status: string; ref?: string }[];
}

// Run the tool-decision pass and execute permitted tools. Mutating tools are executed only when the
// caller supplied an approval for them; otherwise they are returned as `pending` for UI approval.
// eslint-disable-next-line complexity
export async function resolveTools(
  role: string,
  baseMessages: unknown[],
  model: string,
  approvals: string[],
): Promise<ToolResolution | null> {
  const permitted = await listPermittedTools(role);
  if (!permitted.length) return null;
  const decision = await requestToolDecision(baseMessages, toOpenAiTools(permitted), model);
  const calls = decision?.tool_calls;
  if (!calls?.length) return null;

  const out: ToolResolution = {
    messages: [{ role: 'assistant', content: decision?.content ?? '', tool_calls: calls }],
    activity: [],
    pending: [],
  };
  for (const call of calls) {
    const tool = findToolByFnName(permitted, call.function.name);
    if (!tool) continue;
    const input = parseInput(call.function.arguments);
    // Blocked → refuse: never execute, feed a refusal back so the model answers without the tool.
    if (tool.policy === 'blocked') {
      const msg = `blocked by policy: the ${tool.name} connector is not permitted to run`;
      out.messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
      out.activity.push({ tool: tool.name, input, output: msg, status: 'blocked' });
      continue;
    }
    // Needs approval — either explicit 'approval' policy or a legacy mutating tool. Gate unless the
    // caller already supplied an approval for this call. 'allow' runs immediately.
    const needsApproval = tool.policy === 'approval' || (tool.policy !== 'allow' && tool.mutating);
    if (needsApproval && !approvals.includes(call.function.name)) {
      out.pending!.push({ fn: call.function.name, toolName: tool.name, input });
      out.activity.push({ tool: tool.name, input, status: 'awaiting-approval' });
      continue;
    }
    const output = await executeTool(tool, input);
    out.messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    out.activity.push({
      tool: tool.name,
      input,
      output,
      status: 'executed',
      // Citation surface: name + endpoint ref so the stream route can attach source citations.
      ref: tool.endpoint || tool.name,
    });
  }
  if (out.pending!.length) return { ...out, messages: [] };
  return out;
}
