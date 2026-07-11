// ─── Runs monitor reader — SERVER-ONLY thin I/O that feeds the pure runs-monitor aggregator ───────
//
// The console's three run planes each have their OWN authoritative, always-present durable record:
//   • App runs   → `app_runs`      (via app-runs-view-reader.listAppRunsView)
//   • Agent runs → `agent_runs`    (via agentrun.listAgentRuns)
//   • Chat runs  → `audit_events_v2` where action='chat.run' (recordChatRunGovernance writes these,
//                  correlated by run_id — the queryable authoritative record for a chat turn)
//
// This module ONLY reads those rows and normalizes them through the PURE mappers in runs-monitor.ts
// (fromAppRun/fromAgentRun/fromChatRun). No status logic, no formatting lives here — that is all in
// the pure layer, unit-tested. Every source read is best-effort: one plane being empty/unavailable
// yields [] for that kind, never a 500, so the unified view degrades gracefully.
//
// (Temporal workflow state could enrich a live row, but the DB records are authoritative and always
// present — we read them as the source of truth and never depend on Temporal being reachable.)

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { listAgentRuns } from '@/lib/agentrun';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { listApps } from '@/lib/apps-store';
import { isAutotestActor, isDemoTenantOrg } from '@/lib/demo-test-artifacts';
import {
  type AgentRunSource,
  type AppRunSource,
  type ChatRunSource,
  type RunRow,
  mergeRuns,
} from '@/lib/runs-monitor';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Per-plane read cap. The pure layer paginates the merged result; we bound each source read so a
// huge single plane can't starve the others out of the newest window.
const PER_PLANE = 500;

// ─── App runs → AppRunSource[] (title-enriched, actor from trigger payload) ───────────────────────
async function readAppRuns(orgId: string): Promise<AppRunSource[]> {
  try {
    const [runs, apps] = await Promise.all([
      listAppRunsView(undefined, orgId, PER_PLANE),
      listApps(orgId).catch(() => []),
    ]);
    const titleById = new Map(apps.map((a) => [a.id, a.title]));
    // On demo tenants `listApps` has already dropped `[autotest]` apps, so a run whose app is no
    // longer visible is a QA artifact — exclude it (and any autotest-actor run) so Reports/Review
    // never surface autotest rows. Non-demo tenants keep every run (behaviour-preserving).
    const hideOnDemo = isDemoTenantOrg(orgId);
    return runs
      .filter((r) => {
        if (!hideOnDemo) return true;
        if (!titleById.has(r.appId)) return false;
        return !isAutotestActor(appRunActor(r.input));
      })
      .map((r) => ({
        id: r.id,
        appId: r.appId,
        status: r.status,
        steps: r.steps.map((s) => ({ status: s.status })),
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        title: titleById.get(r.appId) ?? null,
        actor: appRunActor(r.input),
      }));
  } catch {
    return [];
  }
}

/** Best-effort actor for an app run — the input's owner/actor field if present, else system. */
function isoOrNull(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : null;
}

function appRunActor(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  for (const k of ['actor', 'user', 'userId', 'requestedBy', 'owner', 'email']) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// ─── Agent runs → AgentRunSource[] ────────────────────────────────────────────────────────────────
async function readAgentRuns(orgId: string): Promise<AgentRunSource[]> {
  try {
    const runs = await listAgentRuns(PER_PLANE, orgId);
    return runs.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      status: r.status,
      startedAt: r.startedAt,
      // Agent runs record no explicit finish; leave null so the pure layer reports duration unknown.
      finishedAt: null,
      actor: '',
    }));
  } catch {
    return [];
  }
}

// ─── Chat runs → ChatRunSource[] (from the canonical attributed audit ledger) ─────────────────────
// recordChatRunGovernance writes one audit_events_v2 row per chat turn: action='chat.run',
// run_id=<chatrun id>, outcome=ok|blocked|redacted, resource='conversation:<id>', actor_label=user.
// That row IS the authoritative, org-scoped, queryable chat-run record. Rows without a run_id are
// legacy/other events and filtered out.
async function readChatRuns(orgId: string): Promise<ChatRunSource[]> {
  try {
    const res = await db.execute(sql`
      SELECT run_id, resource, outcome, ts, actor_label, actor_id, model
      FROM audit_events_v2
      WHERE org = ${orgId}
        AND action = 'chat.run'
        AND run_id IS NOT NULL
      ORDER BY ts DESC
      LIMIT ${PER_PLANE}`);
    const list =
      (res as unknown as { rows?: Record<string, unknown>[] }).rows ??
      (res as unknown as Record<string, unknown>[]);
    return (list as Record<string, unknown>[]).map((r) => ({
      runId: String(r.run_id),
      conversation: conversationLabel(r.resource),
      outcome: r.outcome == null ? '' : String(r.outcome),
      ts: isoOrNull(r.ts),
      actor:
        (r.actor_label == null ? '' : String(r.actor_label)) ||
        (r.actor_id == null ? '' : String(r.actor_id)),
      model: r.model == null ? null : String(r.model),
    }));
  } catch {
    return [];
  }
}

/** 'conversation:<id>' → a short 'Chat <id>' label; other/absent resource → null. */
function conversationLabel(resource: unknown): string | null {
  if (typeof resource !== 'string' || !resource) return null;
  const m = /^conversation:(.+)$/.exec(resource);
  if (!m) return null;
  const id = m[1];
  return `Chat ${id.length > 12 ? `${id.slice(0, 12)}…` : id}`;
}

// ─── listAllRuns — the unified, normalized, newest-first RunRow[] for the org (pre-filter/paginate) ─
export async function listAllRuns(orgId: string = DEFAULT_ORG): Promise<RunRow[]> {
  const [app, agent, chat] = await Promise.all([
    readAppRuns(orgId),
    readAgentRuns(orgId),
    readChatRuns(orgId),
  ]);
  return mergeRuns({ app, agent, chat });
}

// ─── getRunByKey — resolve one run by its `${kind}:${id}` key for the generic detail view ─────────
// Reused by the Operations run-detail page for agent/chat runs (app runs deep-link to their own
// per-app page). Returns the normalized row plus its raw source payload for the detail renderer.
export async function getRunByKey(
  key: string,
  orgId: string = DEFAULT_ORG,
): Promise<RunRow | null> {
  const all = await listAllRuns(orgId);
  return all.find((r) => r.key === key) ?? null;
}
