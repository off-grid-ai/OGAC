// Canonical attributed audit event (Phase 4.11). ONE shape every producer emits and every view
// reads: who (actor) did what (action) on what (resource), in which org/project, with what model /
// tokens / cost, and how it ended (outcome). Pure + zero-I/O so it is exhaustively unit-testable
// (no network, no DB, no auth chain) — the ship/persist adapters live in siem.ts / store.ts, the
// session read that produces an actor lives in the thin resolver at the bottom's caller.
//
// Contract (docs/ROADMAP.md § Phase 4.11):
//   { ts, actor:{type,id,label}, org, project?, action, resource?, model?,
//     tokens?:{prompt,completion,total}, costUsd?, outcome, runId?, ip? }

// ─── Types ──────────────────────────────────────────────────────────────────
export type ActorType = 'user' | 'machine';

export interface Actor {
  type: ActorType;
  id: string; // user email OR machine client-id
  label: string; // human-friendly display (name, or the id)
}

export type AuditOutcome = 'ok' | 'blocked' | 'redacted' | 'error';

// The canonical action taxonomy. Producers pass one of these; the type is a string union so a new
// producer can add a value in one place and every consumer's switch stays exhaustive.
export type AuditAction =
  // chat + runs
  | 'chat.send'
  | 'agent.run'
  | 'workflow.run'
  // governance config-change trail
  | 'policy.change'
  | 'abac.change'
  | 'guardrail.change'
  | 'masking.change'
  | 'routing.change'
  | 'secret.write'
  // pipeline release/rollback (M1 close-the-loop): a blocked/overridden publish + an auto-rollback
  | 'pipeline.publish'
  | 'pipeline.publish.override'
  | 'pipeline.autorollback'
  // pipeline lifecycle + ownership (M2): promotion gate, sign-off, deprecation, owner/team moves
  | 'pipeline.promote'
  | 'pipeline.withdraw'
  | 'pipeline.approve'
  | 'pipeline.reject'
  | 'pipeline.deprecate'
  | 'pipeline.revive'
  | 'pipeline.reassign'
  | 'pipeline.team'
  // team / BU tier (M2): team CRUD + membership
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'team.member.add'
  | 'team.member.remove'
  // app-run HITL review (feedback → golden capture)
  | 'app.run.review'
  // budget enforcement — a call denied for exceeding a spend limit (hard stop, outcome=blocked)
  | 'budget.deny'
  | 'access.role.change'
  | 'access.user.change'
  | 'flag.toggle'
  | 'connector.create'
  | 'connector.update'
  | 'connector.delete'
  | 'backup.run'
  // access events
  | 'access.machine.issue'
  | 'access.machine.rotate'
  | 'access.idp.create'
  | 'access.idp.delete'
  | 'access.federation.provision'
  // data actions
  | 'connector.sync'
  | 'retrieval.query'
  // gateway fleet control — privileged, state-changing node mutations
  | 'gateway.node.model'
  | 'gateway.node.restart'
  | 'gateway.node.enable'
  | 'gateway.node.disable'
  // device fleet control — remote node lifecycle (kill switch)
  | 'device.kill'
  // data-subject rights — GDPR/DSAR right-to-erasure
  | 'data.erasure'
  // tenancy + org-wide config
  | 'tenant.change'
  | 'org.settings.change'
  // fleet (MDM/osquery) control
  | 'fleet.livequery'
  | 'fleet.policy.change'
  // spine export to enterprise tooling (M6 good citizen): SIEM/catalog/observability exporters
  | 'exporter.create'
  | 'exporter.update'
  | 'exporter.delete'
  | 'exporter.test'
  | 'exporter.run';

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// The stored/shipped canonical event. `ts` is always an ISO string after normalization.
export interface AuditEvent {
  ts: string;
  actor: Actor;
  org: string;
  project?: string;
  action: string;
  resource?: string;
  model?: string;
  tokens?: TokenUsage;
  costUsd?: number;
  outcome: AuditOutcome;
  runId?: string;
  ip?: string;
}

// What a producer supplies. Everything the builder can default is optional; actor/org/action/outcome
// are the irreducible attribution the roadmap requires from every producer.
export interface AuditEventInput {
  ts?: string | Date;
  actor: Actor;
  org?: string;
  project?: string | null;
  action: string;
  resource?: string | null;
  model?: string | null;
  tokens?: Partial<TokenUsage> | null;
  costUsd?: number | null;
  outcome?: AuditOutcome | string | null;
  runId?: string | null;
  ip?: string | null;
}

// ─── Cost pricing (mirrors finops.ts rates; kept local so this module stays zero-import) ──────
// USD per 1K tokens. Local models are $0 — the on-device dividend must show as free.
const PRICE_PER_1K: Record<string, number> = {
  'gemma-local': 0,
  'whisper-local': 0,
  'cloud-claude': 0.009,
  'gpt-4o': 0.005,
};
const DEFAULT_CLOUD_PRICE = 0.002;

export function pricePer1k(model: string): number {
  if (model in PRICE_PER_1K) return PRICE_PER_1K[model];
  return model.includes('local') ? 0 : DEFAULT_CLOUD_PRICE;
}

// Cost of `totalTokens` on `model`, in USD, rounded to 4dp. Pure.
export function costUsdFor(model: string, totalTokens: number): number {
  const raw = (totalTokens / 1000) * pricePer1k(model);
  return Number(raw.toFixed(4));
}

// ─── Normalization ────────────────────────────────────────────────────────────
const OUTCOMES: readonly AuditOutcome[] = ['ok', 'blocked', 'redacted', 'error'];

function toIso(ts: string | Date | undefined): string {
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'string' && ts.trim()) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// Map an agent-run status (done | pending_review | denied | blocked | cancelled | error) onto the
// canonical audit outcome. Pure so it's testable and reused by the run producer.
export function outcomeFromStatus(status: string | null | undefined): AuditOutcome {
  switch ((status ?? '').toLowerCase()) {
    case 'ok':
    case 'done':
    case 'completed':
    case 'pending_review':
      return 'ok';
    case 'blocked':
    case 'denied':
    case 'cancelled':
      return 'blocked';
    case 'redacted':
      return 'redacted';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'ok';
  }
}

function normalizeOutcome(o: AuditOutcome | string | null | undefined): AuditOutcome {
  if (o && (OUTCOMES as readonly string[]).includes(o)) return o as AuditOutcome;
  return o ? outcomeFromStatus(o) : 'ok';
}

// Fold a partial token record into a full {prompt, completion, total}. If total is missing it is the
// sum of prompt + completion; if prompt/completion are missing but total is present they stay 0.
// Returns undefined when there is no token signal at all (so `tokens?` is genuinely optional).
export function normalizeTokens(t: Partial<TokenUsage> | null | undefined): TokenUsage | undefined {
  if (!t) return undefined;
  const prompt = Number.isFinite(t.prompt) ? Math.max(0, Math.trunc(t.prompt as number)) : 0;
  const completion = Number.isFinite(t.completion)
    ? Math.max(0, Math.trunc(t.completion as number))
    : 0;
  const total = Number.isFinite(t.total)
    ? Math.max(0, Math.trunc(t.total as number))
    : prompt + completion;
  if (prompt === 0 && completion === 0 && total === 0) return undefined;
  return { prompt, completion, total };
}

function trimOrUndef(s: string | null | undefined): string | undefined {
  const v = typeof s === 'string' ? s.trim() : '';
  return v ? v : undefined;
}

// Build a normalized, defaulted canonical AuditEvent from a producer's input. PURE — the single
// place defaults/coercion live, so every producer emits an identically-shaped, comparable event.
// - ts defaults to now (ISO)
// - org defaults to 'default'
// - outcome defaults to 'ok' (and maps run statuses)
// - tokens are folded to a full triple (or dropped if absent)
// - costUsd is DERIVED from model + total tokens when the caller didn't pass one and tokens exist
export function buildAuditEvent(input: AuditEventInput): AuditEvent {
  const model = trimOrUndef(input.model);
  const tokens = normalizeTokens(input.tokens);
  const explicitCost =
    input.costUsd != null && Number.isFinite(input.costUsd) ? Number(input.costUsd) : undefined;
  const derivedCost =
    explicitCost === undefined && model && tokens ? costUsdFor(model, tokens.total) : undefined;

  const event: AuditEvent = {
    ts: toIso(input.ts),
    actor: {
      type: input.actor.type,
      id: input.actor.id,
      label: input.actor.label || input.actor.id,
    },
    org: trimOrUndef(input.org) ?? 'default',
    action: input.action,
    outcome: normalizeOutcome(input.outcome),
  };

  const project = trimOrUndef(input.project);
  if (project) event.project = project;
  const resource = trimOrUndef(input.resource);
  if (resource) event.resource = resource;
  if (model) event.model = model;
  if (tokens) event.tokens = tokens;
  const cost = explicitCost ?? derivedCost;
  if (cost !== undefined) event.costUsd = cost;
  const runId = trimOrUndef(input.runId);
  if (runId) event.runId = runId;
  const ip = trimOrUndef(input.ip);
  if (ip) event.ip = ip;

  return event;
}

// ─── Actor resolution (pure mapping) ────────────────────────────────────────────
// The IMPURE session/token read is done by the caller (see resolveActor in tenancy — thin adapter);
// this pure mapping turns whatever identity fields it recovered into a canonical Actor. A machine is
// anything presenting a service-account / client-id; everything with a user email is a user.

export interface Principal {
  email?: string | null;
  name?: string | null;
  clientId?: string | null; // machine / service-account client id
  role?: string | null;
}

// Derive the canonical Actor from a recovered principal. Machine wins when there's a clientId and no
// human email (service accounts carry a clientId; humans carry an email). Falls back to an
// 'unknown' user rather than throwing, so a producer can always attribute *something*.
export function actorFrom(principal: Principal | null | undefined): Actor {
  const email = trimOrUndef(principal?.email);
  const clientId = trimOrUndef(principal?.clientId);
  const name = trimOrUndef(principal?.name);
  if (!email && clientId) {
    return { type: 'machine', id: clientId, label: name ?? clientId };
  }
  if (email) {
    return { type: 'user', id: email, label: name ?? email };
  }
  return { type: 'user', id: 'unknown', label: 'unknown' };
}

// A machine actor built directly from a client id (issuance/rotation producers that know the id).
export function machineActor(clientId: string, label?: string): Actor {
  const id = clientId.trim() || 'unknown';
  return { type: 'machine', id, label: (label ?? id) || id };
}
