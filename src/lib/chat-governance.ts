import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { abacRules, apiKeys, auditEvents } from '@/db/schema';
import { actorFrom } from '@/lib/audit-event';
import { budgetEnforced } from '@/lib/budget-config';
import { checkBudget, costForTokens } from '@/lib/finops';
import { effectiveBaseRole } from '@/lib/module-access';
import { recordAudit } from '@/lib/store';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

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
  // Custom roles inherit their based_on role's ABAC rules. Match a deny rule targeting either the
  // custom role name itself or its resolved built-in base role. A base of 'admin' is never denied.
  const base = await effectiveBaseRole(role);
  if (base === 'admin') return false;
  const roleTargets = Array.from(new Set([role, base]));
  const rows = await db
    .select({ effect: abacRules.effect })
    .from(abacRules)
    .where(
      and(
        inArray(abacRules.role, roleTargets),
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

// Spend already billed to a key this month, in USD — priced with the SAME per-model finops rates as
// FinOps (not a flat blended rate). Tokens are grouped by model in Postgres and each bucket is priced
// via `costForTokens`, so local models correctly contribute $0 and only real cloud cost counts.
export async function spentThisMonth(keyId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT model, COALESCE(SUM(tokens), 0) AS tokens FROM audit_events
    WHERE key_id = ${keyId} AND ts >= date_trunc('month', now())
    GROUP BY model`);
  const list =
    (rows as unknown as { rows?: { model: string; tokens: string }[] }).rows ??
    (rows as unknown as { model: string; tokens: string }[]);
  let spent = 0;
  for (const r of list as { model: string; tokens: string }[]) {
    spent += costForTokens(r.model ?? 'unknown', Number(r.tokens ?? 0));
  }
  return spent;
}

// DEPRECATED: kept for back-compat, now delegates to the single `checkBudget` decision. Prices the
// key's real per-model spend this month and asks the pure gate whether the next call (cost supplied
// by the caller, default 0 = local) stays within budget. Returns true if within/allowed.
export async function withinBudget(
  keyId: string | null,
  budgetUsd: number | null,
  incomingCost = 0,
): Promise<boolean> {
  if (!keyId || budgetUsd === null) return true;
  const spent = await spentThisMonth(keyId);
  return checkBudget(spent, budgetUsd, incomingCost).allow;
}

// The GATE the spend paths call. Resolves the project's virtual key + budget, prices its spend so
// far, and returns the pure `checkBudget` decision for the incoming call's cost. `enforced` reflects
// the org enforce flag: when false the decision is advisory (the caller may warn but must not block).
export interface BudgetGate {
  keyId: string | null;
  ok: boolean; // allow the call? (true when unattributed, unlimited, $0 cost, within budget, or not enforced)
  enforced: boolean; // is hard enforcement on for this org?
  spent: number;
  limit: number | null;
  incomingCost: number;
  reason: string;
}

export async function projectBudget(
  projectId: string | null,
  incomingCost = 0,
  org: string = DEFAULT_ORG,
): Promise<BudgetGate> {
  const enforced = await budgetEnforced(org);
  const keyId = await projectKeyId(projectId);
  if (!keyId) {
    return { keyId: null, ok: true, enforced, spent: 0, limit: null, incomingCost, reason: 'no-key' };
  }
  const [k] = await db
    .select({ budgetUsd: apiKeys.budgetUsd })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId));
  const limit = k?.budgetUsd ?? null;
  const spent = limit === null ? 0 : await spentThisMonth(keyId);
  const decision = checkBudget(spent, limit, incomingCost);
  // When enforcement is OFF the gate never blocks — the decision is still returned so the caller can
  // warn/log, but `ok` is forced true so it "can't surprise the demo".
  return {
    keyId,
    ok: enforced ? decision.allow : true,
    enforced,
    spent: decision.spent,
    limit: decision.limit,
    incomingCost: decision.incomingCost,
    reason: decision.reason,
  };
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
  // Phase 4.11 attribution (optional so existing callers still compile). `userId` IS the actor email;
  // org/project scope the event; promptTokens/completionTokens split the estimate when known.
  org?: string;
  project?: string | null;
  promptTokens?: number;
  completionTokens?: number;
}): Promise<void> {
  // Legacy device-keyed audit row (kept: FinOps/Analytics/budget still read audit_events by key_id).
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
  // Canonical attributed audit (Phase 4.11): chat.send by this user, with model/tokens/cost. Cost is
  // derived from model + total tokens by the builder. Best-effort (recordAudit never throws).
  const tokens =
    input.promptTokens != null || input.completionTokens != null
      ? { prompt: input.promptTokens ?? 0, completion: input.completionTokens ?? 0, total: input.tokens }
      : { prompt: 0, completion: 0, total: input.tokens };
  recordAudit({
    actor: actorFrom({ email: input.userId }),
    org: input.org ?? DEFAULT_ORG,
    project: input.project ?? undefined,
    action: 'chat.send',
    model: input.model || 'unknown',
    tokens,
    outcome: input.outcome,
  });
}
