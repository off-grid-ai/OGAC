import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { abacRules, apiKeys, auditEvents } from '@/db/schema';

// Chat governance — write an audit row per chat completion (so Analytics/FinOps/Regulatory count
// chat usage), enforce which models/skills/connectors a role may use via abacRules, and attribute
// spend to a per-project virtual key/budget via the existing apiKeys/FinOps tables.

// ─── RBAC gating (reuses abacRules) ───────────────────────────────────────────
// A deny rule is a row: role=<role>, resource=<'chat.model'|'chat.skill'|'chat.tool'>,
// value=<id|name>, effect='deny'. Admins are never denied. Empty ruleset = allow all.
export type ChatResource = 'chat.model' | 'chat.skill' | 'chat.tool';

export async function isDenied(
  role: string,
  resource: ChatResource,
  value: string,
): Promise<boolean> {
  if (role === 'admin' || !value) return false;
  const rows = await db
    .select({ effect: abacRules.effect })
    .from(abacRules)
    .where(
      and(
        eq(abacRules.role, role),
        eq(abacRules.resource, resource),
        eq(abacRules.value, value),
        eq(abacRules.effect, 'deny'),
      ),
    );
  return rows.length > 0;
}

export async function filterAllowedTools<T extends { name: string }>(
  role: string,
  tools: T[],
): Promise<T[]> {
  if (role === 'admin') return tools;
  const out: T[] = [];
  for (const t of tools) {
    if (!(await isDenied(role, 'chat.tool', t.name))) out.push(t);
  }
  return out;
}

// ─── FinOps attribution: resolve a project's virtual key (subjectType='project') ──
export async function projectKeyId(projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const [k] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.subjectType, 'project'), eq(apiKeys.subject, projectId)));
  return k?.id ?? null;
}

// Budget check: sum tokens already billed to the key this month against its budget (blended local
// cost is $0, so this only bites for cloud models — mirrors FinOps' costOf). Returns true if within.
const RATE_PER_1K = 0.002; // blended cloud rate; local models are free upstream
export async function withinBudget(keyId: string | null, budgetUsd: number | null): Promise<boolean> {
  if (!keyId || budgetUsd === null) return true;
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(tokens), 0) AS tokens FROM audit_events
    WHERE key_id = ${keyId} AND ts >= date_trunc('month', now())`);
  const list = (rows as unknown as { rows?: { tokens: string }[] }).rows ?? (rows as unknown as { tokens: string }[]);
  const tokens = Number((list as { tokens: string }[])[0]?.tokens ?? 0);
  return (tokens / 1000) * RATE_PER_1K < budgetUsd;
}

export async function projectBudget(projectId: string | null): Promise<{ keyId: string | null; ok: boolean }> {
  const keyId = await projectKeyId(projectId);
  if (!keyId) return { keyId: null, ok: true };
  const [k] = await db.select({ budgetUsd: apiKeys.budgetUsd }).from(apiKeys).where(eq(apiKeys.id, keyId));
  return { keyId, ok: await withinBudget(keyId, k?.budgetUsd ?? null) };
}

// ─── Audit a chat completion ──────────────────────────────────────────────────
// Rough token estimate (~4 chars/token) since the gateway stream doesn't return usage counts.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function writeChatAudit(input: {
  userId: string;
  model: string;
  tokens: number;
  outcome: string;
  keyId?: string | null;
  tool?: string | null;
}): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      id: randomUUID(),
      deviceId: `chat:${input.userId}`,
      model: input.model || 'unknown',
      tokens: input.tokens,
      leftDevice: false, // on-prem gateway — nothing leaves the network
      tool: input.tool ?? null,
      outcome: input.outcome,
      latencyMs: 0,
      keyId: input.keyId ?? null,
    });
  } catch {
    /* audit is best-effort — never break the chat */
  }
}
