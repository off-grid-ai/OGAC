import { getSkill } from '@/lib/chat';

// Assistant Actions — a minimal executor that turns an assistant's OpenAPI schema (stored as text
// on the skill) into callable tools. It parses operations into tool descriptors the chat layer can
// advertise to the model, and executes a chosen operation as an outbound HTTP call. Kept
// self-contained (no changes to the shared tool router) so it registers per-assistant actions.

export interface ActionTool {
  name: string; // operationId (fallback: METHOD_path)
  method: string;
  path: string; // path template, e.g. /users/{id}
  baseUrl: string;
  summary: string;
  parameters: { name: string; in: string; required: boolean }[];
}

interface OpenApiParam {
  name?: string;
  in?: string;
  required?: boolean;
}
interface OpenApiOp {
  operationId?: string;
  summary?: string;
  parameters?: OpenApiParam[];
}
interface OpenApiDoc {
  servers?: { url?: string }[];
  paths?: Record<string, Record<string, OpenApiOp>>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Parse an OpenAPI schema (JSON only; YAML is rejected gracefully) into a flat list of tools.
// eslint-disable-next-line complexity
export function parseActions(schemaText: string): ActionTool[] {
  const text = (schemaText ?? '').trim();
  if (!text) return [];
  let doc: OpenApiDoc;
  try {
    doc = JSON.parse(text) as OpenApiDoc;
  } catch {
    return []; // non-JSON (e.g. YAML) — nothing to register
  }
  const baseUrl = doc.servers?.[0]?.url ?? '';
  const tools: ActionTool[] = [];
  for (const [path, ops] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = ops[method];
      if (!op) continue;
      tools.push({
        name: op.operationId || `${method.toUpperCase()}_${path.replace(/[^a-z0-9]+/gi, '_')}`,
        method: method.toUpperCase(),
        path,
        baseUrl,
        summary: op.summary ?? '',
        parameters: (op.parameters ?? [])
          .filter((p) => p.name)
          .map((p) => ({ name: p.name!, in: p.in ?? 'query', required: Boolean(p.required) })),
      });
    }
  }
  return tools;
}

// The callable tools an assistant exposes (empty when it has no Actions schema).
export async function skillActionTools(skillId: string): Promise<ActionTool[]> {
  const skill = await getSkill(skillId);
  if (!skill || !skill.capabilities?.tools) return [];
  return parseActions(skill.actionsSchema ?? '');
}

// Execute one action against its endpoint. Path/query params are substituted from `args`; a JSON
// body is sent for non-GET operations. Returns the parsed response (or text) plus HTTP status.
// eslint-disable-next-line complexity
export async function executeAction(
  tool: ActionTool,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  let path = tool.path;
  const query = new URLSearchParams();
  for (const p of tool.parameters) {
    const v = args[p.name];
    if (v === undefined || v === null) continue;
    if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
    else if (p.in === 'query') query.set(p.name, String(v));
  }
  const qs = query.toString();
  const url = `${tool.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  const init: RequestInit = { method: tool.method };
  if (tool.method !== 'GET' && args.body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(args.body);
  }
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const raw = await r.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    /* keep as text */
  }
  return { status: r.status, body };
}
