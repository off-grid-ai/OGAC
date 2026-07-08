// Server-only I/O seam for the admin user-activity surface. Reads a single user's raw activity from
// every source that attributes to them — the canonical audit ledger (`audit_events_v2`, the spine),
// their chat turns (`chat_messages` joined to `chat_conversations.user_id`), their governed agent
// runs (`agent_runs`, correlated via the audit `run_id`) and their app/workflow runs (`app_runs`,
// same correlation) — and hands the loose rows to the PURE aggregator (user-activity.ts).
//
// BEST-EFFORT PER SOURCE: each read is independently try/caught so one source being down (a missing
// table, an OpenSearch outage) skips that source and never 500s the whole surface. The aggregator
// then merges whatever came back.
//
// This file NEVER aggregates — no filtering/sorting/rollup here; that is the pure module's job.
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import type {
  RawAgentRunRow,
  RawAppRunRow,
  RawAuditRow,
  RawChatRow,
  RawUserActivity,
} from '@/lib/user-activity';

// The identity of the user whose activity we're reading. Attribution keys off the EMAIL (actor_id in
// the audit ledger is the user's email; chat_conversations.user_id is the email too). The Keycloak
// user id is only the URL handle — the route resolves the email before calling here.
export interface ActivitySubject {
  email: string; // the actor id / user id used for attribution
  aliases?: string[]; // any additional ids that map to the same person (e.g. username)
  org?: string;
}

// How far back / how many rows to pull per source before the pure layer filters + paginates. Capped
// so a chatty user can't blow the request. The pure layer applies the real date-range filter.
const ROW_LIMIT = 5000;

function ids(subject: ActivitySubject): string[] {
  const all = [subject.email, ...(subject.aliases ?? [])]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
  return [...new Set(all)];
}

function rowsOf(res: unknown): Record<string, unknown>[] {
  const list =
    (res as { rows?: Record<string, unknown>[] })?.rows ?? (res as Record<string, unknown>[]);
  return Array.isArray(list) ? list : [];
}

function str(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

function iso(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString();
  return v == null ? undefined : String(v);
}

// ── Audit spine — the attributed ledger for this user (who-did-what + verdict) ────────────────────
async function readAudit(idList: string[], org: string): Promise<RawAuditRow[]> {
  if (idList.length === 0) return [];
  try {
    const res = await db.execute(sql`
      SELECT ts, actor_id, actor_label, org, project, action, resource, model,
             total_tokens, cost_usd, outcome, run_id
      FROM audit_events_v2
      WHERE org = ${org}
        AND actor_id = ANY(${idList})
      ORDER BY ts DESC
      LIMIT ${ROW_LIMIT}`);
    return rowsOf(res).map((r) => ({
      ts: iso(r.ts),
      actorId: str(r.actor_id),
      actorLabel: str(r.actor_label),
      org: str(r.org),
      project: str(r.project) ?? null,
      action: str(r.action),
      resource: str(r.resource) ?? null,
      model: str(r.model) ?? null,
      totalTokens: r.total_tokens == null ? null : Number(r.total_tokens),
      costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
      outcome: str(r.outcome),
      runId: str(r.run_id) ?? null,
    }));
  } catch {
    return [];
  }
}

// ── Chat turns — the REAL prompt text the user typed, per conversation ────────────────────────────
async function readChat(idList: string[]): Promise<RawChatRow[]> {
  if (idList.length === 0) return [];
  try {
    const res = await db.execute(sql`
      SELECT m.id AS message_id, m.conversation_id, m.role, m.content, m.created_at,
             c.title AS conversation_title, c.model
      FROM chat_messages m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE c.user_id = ANY(${idList})
        AND m.role = 'user'
        AND m.active = true
      ORDER BY m.created_at DESC
      LIMIT ${ROW_LIMIT}`);
    return rowsOf(res).map((r) => ({
      messageId: str(r.message_id),
      conversationId: str(r.conversation_id),
      conversationTitle: str(r.conversation_title) ?? null,
      role: str(r.role),
      content: str(r.content) ?? null,
      model: str(r.model) ?? null,
      ts: iso(r.created_at),
    }));
  } catch {
    return [];
  }
}

// ── Agent runs — query/answer/checks; attributed to the user via the audit run_id correlation ─────
// agent_runs has no actor column, so we pull only the runs whose id appears as a run_id on THIS
// user's audit events (the audit spine is what attributes a run to a person). Content (the query +
// guardrail checks) is then joined on for those ids.
async function readAgentRuns(auditRunIds: string[]): Promise<RawAgentRunRow[]> {
  if (auditRunIds.length === 0) return [];
  try {
    const res = await db.execute(sql`
      SELECT id, agent_id, query, answer, status, checks, started_at
      FROM agent_runs
      WHERE id = ANY(${auditRunIds})
      ORDER BY started_at DESC
      LIMIT ${ROW_LIMIT}`);
    return rowsOf(res).map((r) => ({
      id: str(r.id),
      agentId: str(r.agent_id) ?? null,
      query: str(r.query) ?? null,
      answer: str(r.answer) ?? null,
      status: str(r.status),
      model: null,
      checks: Array.isArray(r.checks)
        ? (r.checks as { name?: string; verdict?: string; detail?: string }[])
        : null,
      ts: iso(r.started_at),
    }));
  } catch {
    return [];
  }
}

// ── App/workflow runs — trigger input + outcome; attributed via the audit run_id correlation ──────
async function readAppRuns(auditRunIds: string[]): Promise<RawAppRunRow[]> {
  if (auditRunIds.length === 0) return [];
  try {
    const res = await db.execute(sql`
      SELECT id, app_id, status, input, outcome, started_at
      FROM app_runs
      WHERE id = ANY(${auditRunIds})
      ORDER BY started_at DESC
      LIMIT ${ROW_LIMIT}`);
    return rowsOf(res).map((r) => ({
      id: str(r.id),
      appId: str(r.app_id) ?? null,
      status: str(r.status),
      input:
        r.input && typeof r.input === 'object' ? (r.input as Record<string, unknown>) : null,
      outcome: str(r.outcome) ?? null,
      ts: iso(r.started_at),
    }));
  } catch {
    return [];
  }
}

// Read the whole raw activity set for a user, best-effort per source. The audit ledger comes first;
// its run_ids drive the agent/app content joins so we only pull runs actually attributed to the user.
export async function readUserActivity(subject: ActivitySubject): Promise<RawUserActivity> {
  const org = (subject.org ?? DEFAULT_ORG).trim() || DEFAULT_ORG;
  const idList = ids(subject);

  const [audit, chat] = await Promise.all([readAudit(idList, org), readChat(idList)]);

  // The audit run_ids are the correlation keys that attribute a run to this user.
  const runIds = [...new Set(audit.map((a) => (a.runId ?? '').trim()).filter((s) => s.length > 0))];
  const [agentRuns, appRuns] = await Promise.all([readAgentRuns(runIds), readAppRuns(runIds)]);

  return { audit, chat, agentRuns, appRuns };
}
