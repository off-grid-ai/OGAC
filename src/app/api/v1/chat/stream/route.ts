import { auth } from '@/auth';
import { actorFrom } from '@/lib/audit-event';
import {
  addMessage,
  branchUserMessage,
  deriveTitle,
  getConversation,
  getCustomInstructions,
  getSkill,
  listMessages,
  memoryBlock,
  memoryFactsByIds,
  prepareRegenerate,
  projectAccess,
  projectMemoryBlock,
  projectSystemPrompt,
  renameConversation,
} from '@/lib/chat';
import { attachmentBlock } from '@/lib/chat-attach';
import { citationInstruction, sourceNames } from '@/lib/chat-citations';
import {
  estimateTokens,
  isDenied,
  projectBudget,
  writeChatAudit,
} from '@/lib/chat-governance';
import { extractMemory } from '@/lib/chat-memory';
import { parseRefsPayload, referencedMemoryBlock } from '@/lib/chat-mentions';
import {
  chatRequiresMasking,
  inboundGuardrailBlocks,
  newChatRunId,
  outboundGuardrailBlocks,
  runInboundGuardrails,
  runOutboundGuardrails,
  signChatAnswer,
  type ChatRunWorkflowInput,
} from '@/lib/chat-run';
import { dispatchChatRun } from '@/lib/chat-run-dispatch';
import { resolveTools } from '@/lib/chat-tools';
import { emitChatTrace } from '@/lib/chat-trace';
import type { CheckResult } from '@/lib/checks';
import { forwardToCloud } from '@/lib/cloud-client';
import { egressAuditEvent, egressBlockedAuditEvent } from '@/lib/cloud-egress-audit';
import { resolveCloudPlan } from '@/lib/cloud-route-plan';
import { correlationIds } from '@/lib/correlation';
import { costForTokens } from '@/lib/finops';
import { retrieve as retrieveOrgKnowledge } from '@/lib/org-knowledge';
import { auditEnforcement } from '@/lib/pipeline-contract';
import { enforceDataAccess, enforceModelCall } from '@/lib/pipeline-enforcement';
import { resolveChatBinding } from '@/lib/pipeline-run-glue';
import { type Citation, retrieve } from '@/lib/rag';
import { getOrgSystemPrompt, recordAudit } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
const enc = new TextEncoder();

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

// Streaming chat — assembles the conversation (project system prompt + history + new turn),
// forwards to the gateway with streaming, relays deltas as SSE, and persists the final answer.
// Message shape + params mirror Off Grid AI Desktop's llm.chatStream (enable_thinking:false).
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return new Response('unauthorized', { status: 401 });
  // Resolve the caller's org ONCE — org-knowledge grounding must only ever search this tenant's
  // collections, never another org's.
  const orgId = await currentOrgId();

  const {
    conversationId,
    content = '',
    model = '',
    images = [],
    regenerate = false,
    // Edit & branch: re-run from an edited prior user message, forking a new branch.
    editMessageId = null,
    approvals = [],
    orgKnowledge = false,
    // Tools menu: extended thinking toggle. Off by default (desktop parity, saves prefill).
    thinking = false,
    // Incognito / temporary chat: no DB writes, no memory. The client owns the transcript and
    // sends prior turns inline via `history`; nothing here is persisted.
    temporary = false,
    history = [],
    // Slash skill invoked inline for this turn only — its system prompt is applied for the turn.
    skillId: turnSkillId = null,
    // Ad-hoc file attachments already extracted to text by /api/v1/chat/attach — injected as a
    // system context block for this turn only (not persisted, not embedded).
    attachments = [],
    // @-mention references for THIS turn only: explicit memory ids to inject as context + KB scopes
    // (project / project+doc) to ground retrieval on. Parsed/validated by the pure helper.
    refs = null,
    // Data classification for model routing. Chat defaults to `public` (eligible for cloud IF a rule
    // + the org egress switch permit it); a caller tagging `pii`/`confidential` makes the request
    // ineligible for cloud via the routing rules (data_class=pii → local). Egress is default-OFF.
    dataClass = 'public',
  } = await req.json().catch(() => ({}));
  const mentionRefs = parseRefsPayload(refs);
  // Temporary conversations have no persisted row; synthesize a light stand-in so the rest of the
  // pipeline (system prompt, budget, tools) works unchanged. projectId/skillId stay null.
  const loadPersistedConvo = async () =>
    conversationId ? await getConversation(userId, orgId, conversationId) : null;
  const convo = temporary ? { id: '', userId, projectId: null, skillId: null } : await loadPersistedConvo();
  if (!convo) return new Response('conversation not found', { status: 404 });

  // PA-16b — resolve the bound-pipeline CONTRACT this chat run enforces (data allowlist + egress
  // leash + policy/guardrail overlay). Most-specific-wins via resolveChatPipeline: the project's own
  // binding → the org default (allowlist-gated). Null (nothing bound / unresolvable) ⇒ legacy
  // behaviour — the chat behaves EXACTLY as before (additive-only). Enforcement is layered on top of
  // the existing chat governance (RBAC / budget / routing), never replacing it. Best-effort resolve:
  // a DB hiccup degrades to a null contract (legacy), never breaks the chat.
  const pipelineBinding = await resolveChatBinding(convo.projectId ?? null, orgId).catch(() => ({
    pipelineId: null,
    contract: null,
  }));
  const pipelineContract = pipelineBinding.contract;
  // A governed refusal helper: emit an SSE error + done and close (200 so the browser reads the body).
  // Defined here (not later) so the inbound guardrail gate below can refuse before the model call.
  const deny = (msg: string) =>
    new Response(`data: ${JSON.stringify({ error: msg })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
    });
  // One canonical chat-run id, minted here and carried through the guardrail floor, the durable
  // dispatch (workflow id seed), the trace, provenance + lineage — so this turn's governed run is
  // correlated across all planes by the ONE key (mirrors dispatchAgentRun's runId).
  const chatRunId = newChatRunId();
  const enforceCtx = {
    orgId,
    actor: userId,
    runId: chatRunId,
    contract: pipelineContract,
  };

  // ── W2: the GUARDRAIL FLOOR on the model path (PII + injection) — the audit gap vs the agent path.
  // Chat already enforced the data-allowlist + egress leash below, but SKIPPED the runChecks('pre') +
  // getPii().scan the agent path runs. Close it here, using the bound pipeline's contract:
  //   • injection/blocked verdict → REFUSE the run (matches runAgent's pre-guardrail block);
  //   • PII detected + the contract requires masking → REDACT before the model sees it.
  // Chat's data-class is the caller-tagged `dataClass` (default 'public'); the contract's guardrail
  // overlay (requirePiiMasking) decides masking. A null contract ⇒ no masking (legacy chat behaviour).
  const chatDataClass = String(dataClass || 'public');
  const requireMasking = chatRequiresMasking(pipelineContract, chatDataClass);
  const inbound = await runInboundGuardrails(String(content), String(model || ''), {
    requireMasking,
    orgId,
  }).catch(() => null);
  const preChecks = inbound?.checks ?? [];
  // FAIL CLOSED (SECURITY #236): a thrown/timed-out inbound guardrail (inbound === null) is a BLOCK,
  // never a fall-through to sending the raw user input to the model. The pure authority decides.
  if (inboundGuardrailBlocks(inbound)) {
    // Injection/blocked OR a failed screen (inbound === null) — a hard refusal, audited (blocked).
    const reason =
      inbound === null
        ? 'inbound guardrail failed to screen (fail-closed block)'
        : 'inbound guardrail blocked (injection)';
    auditEnforcement(
      enforceCtx,
      'pipeline.guardrail.block',
      `conversation:${convo.id || 'temporary'}`,
      'blocked',
      reason,
    );
    recordAudit({
      actor: actorFrom({ email: userId }),
      org: DEFAULT_ORG,
      project: convo.projectId ?? undefined,
      action: 'chat.run',
      resource: convo.id ? `conversation:${convo.id}` : undefined,
      model: (model as string) || undefined,
      outcome: 'blocked',
      runId: chatRunId,
    });
    return deny(
      inbound === null
        ? 'request blocked by input guardrail: screening unavailable'
        : 'request blocked by input guardrail: prompt injection detected',
    );
  }
  // The model-facing copy of the user turn: redacted when the contract required masking + PII hit,
  // else the original text. The user's OWN typed message is still persisted verbatim (below) — the
  // redaction protects what the MODEL sees, mirroring the agent path's guardrail floor.
  const modelContent = inbound?.text ?? String(content);
  if (inbound?.redacted) {
    auditEnforcement(
      enforceCtx,
      'pipeline.guardrail.redact',
      `conversation:${convo.id || 'temporary'}`,
      'redacted',
      'inbound PII redacted before model (contract requiresPiiMasking)',
    );
  }

  // Edit & branch: fork a new user turn from an edited prior message (persisted, becomes active).
  // The new user message is the parent of the assistant answer we're about to generate.
  let assistantParentId: string | null = null;
  if (!temporary && editMessageId && content.trim()) {
    assistantParentId = await branchUserMessage(convo.id, String(editMessageId), String(content));
    if (!assistantParentId) return new Response('message not found', { status: 404 });
  } else if (!temporary && regenerate) {
    // Regenerate: branch a fresh answer under the same user turn (old answer kept as a sibling).
    assistantParentId = await prepareRegenerate(convo.id);
  }

  // Temporary chats carry their own history from the client (never touch the DB).
  const clientHistory = Array.isArray(history) ? history : [];
  const prior: { role: string; content: string }[] = temporary
    ? clientHistory.map((h: { role: string; content: string }) => ({
        role: h.role,
        content: h.content,
      }))
    : (await listMessages(convo.id)).map((m) => ({ role: m.role, content: m.content }));
  // First user turn → title the conversation from it (like the desktop does).
  if (!temporary && !regenerate && !editMessageId && prior.length === 0 && content.trim()) {
    await renameConversation(userId, convo.id, deriveTitle(content));
  }

  // Build the OpenAI-style message array: custom instructions → project prompt → knowledge →
  // history → new user turn (+ images).
  const messages: {
    role: string;
    content: string | ContentPart[];
    tool_call_id?: string;
    tool_calls?: unknown;
  }[] = [];
  // Org-wide instructions: an admin-set system prompt injected into EVERY chat as the
  // highest-precedence system block, BEFORE per-user custom instructions. Best-effort.
  try {
    const orgPrompt = await getOrgSystemPrompt(orgId);
    if (orgPrompt.trim()) messages.push({ role: 'system', content: orgPrompt });
  } catch {
    /* org settings optional — chat still answers without them */
  }
  const ci = await getCustomInstructions(userId);
  if (ci.trim()) messages.push({ role: 'system', content: ci });
  const mem = await memoryBlock(userId, orgId);
  if (mem) messages.push({ role: 'system', content: mem });
  // @-mentioned memories: the user explicitly referenced specific stored facts for this turn — pull
  // them (scoped to the caller so you can only reference your own) and inject as a dedicated block,
  // additive to the whole-memory block above. Best-effort; degrades to no block when none resolve.
  if (mentionRefs?.memoryIds.length) {
    try {
      const facts = await memoryFactsByIds(userId, orgId, mentionRefs.memoryIds);
      const block = referencedMemoryBlock(facts);
      if (block) messages.push({ role: 'system', content: block });
    } catch {
      /* referenced memory optional — chat still answers without it */
    }
  }
  const sys = await projectSystemPrompt(convo.projectId ?? null);
  if (sys) messages.push({ role: 'system', content: sys });
  // Per-project memory: inject facts scoped to this conversation's project (additive to user memory).
  const projMem = await projectMemoryBlock(convo.projectId ?? null);
  if (projMem) messages.push({ role: 'system', content: projMem });
  // Attached files (ad-hoc chat): inject the extracted text as a system context block for this turn.
  if (Array.isArray(attachments) && attachments.length) {
    const block = attachmentBlock(
      attachments
        .filter((a: unknown) => a && typeof (a as { text?: unknown }).text === 'string')
        .map((a: { name?: string; text: string }) => ({
          name: String(a.name ?? 'file'),
          text: a.text,
          truncated: false,
        })),
    );
    if (block) messages.push({ role: 'system', content: block });
  }
  // Org skill bound to this conversation: inject its instructions, default its model, and use its
  // knowledge project for RAG when the conversation has none of its own.
  let skillModel = '';
  let ragProjectId = convo.projectId ?? null;
  // A slash-invoked skill applies for this turn only; a conversation-bound skill applies for the
  // whole thread. Turn skill takes precedence when both are present.
  const activeSkillId = turnSkillId ?? convo.skillId;
  if (activeSkillId) {
    const skill = await getSkill(orgId, activeSkillId);
    if (skill?.enabled) {
      if (skill.systemPrompt.trim()) messages.push({ role: 'system', content: skill.systemPrompt });
      skillModel = skill.model ?? '';
      if (!ragProjectId && skill.projectId) ragProjectId = skill.projectId;
    }
  }
  // Project chats retrieve from the knowledgebase and cite (desktop RAG behavior).
  let citations: Citation[] = [];
  // PA-16b — the HARD data-allowlist ceiling before a knowledge read (mirrors the app-run/agent
  // path). enforceDataAccess with a null contract is permissive (legacy). When a bound pipeline's
  // allowlist doesn't cover the requested knowledge domain the read is SKIPPED (not blocking the
  // whole chat) + audited, so the model never sees ungoverned data. Data keys: the project id for a
  // project KB, 'org-knowledge' for the org-wide KB.
  if (ragProjectId) {
    const v = enforceDataAccess(pipelineContract, ragProjectId);
    if (!v.allow) {
      auditEnforcement(enforceCtx, 'pipeline.data.deny', `data:${ragProjectId}`, 'blocked', v.reason);
    } else {
      try {
        const r = await retrieve(ragProjectId, String(content), 6, { orgId });
        if (r.context) {
          messages.push({ role: 'system', content: r.context });
          citations = r.citations;
        }
      } catch {
        /* knowledgebase optional — chat still answers without it */
      }
    }
  }
  // Org-wide knowledge base ("Ask Your Org"): when the client opts in, retrieve permission-aware
  // chunks scoped to the session role and inject them as a system block + citations, mirroring the
  // project RAG branch above. Retrieval only ever returns collections the role may access.
  if (orgKnowledge) {
    const v = enforceDataAccess(pipelineContract, 'org-knowledge');
    if (!v.allow) {
      auditEnforcement(enforceCtx, 'pipeline.data.deny', 'data:org-knowledge', 'blocked', v.reason);
    } else {
      try {
        const r = await retrieveOrgKnowledge(
          String(content),
          session?.user?.role ?? 'viewer',
          6,
          orgId,
        );
        if (r.context) {
          messages.push({ role: 'system', content: r.context });
          citations = citations.concat(
            r.citations.map((c) => ({ name: c.name, position: c.position, score: c.score })),
          );
        }
      } catch {
        /* org knowledge optional — chat still answers without it */
      }
    }
  }
  // @-mentioned knowledge: the user referenced one or more KBs (whole project) or specific KB docs
  // for this turn. Ground retrieval on each scope and fold the hits into `citations` — the SAME
  // Citation shape the project/org RAG branches use, so inline [n] chips + the Sources footer keep
  // working (phase-1 consistency). Access is enforced: retrieval only runs for a project the caller
  // owns / is a member of / is admin over (projectAccess); others are silently skipped. De-dupe the
  // project we already retrieved above (ragProjectId) to avoid double-injecting the same KB.
  if (mentionRefs?.kb.length) {
    const alreadyRetrieved = new Set<string>(ragProjectId ? [`${ragProjectId}::`] : []);
    for (const scope of mentionRefs.kb) {
      const key = `${scope.projectId}::${scope.docId ?? ''}`;
      if (alreadyRetrieved.has(key)) continue;
      alreadyRetrieved.add(key);
      try {
        // Access gate — you can only reference a project you can read.
        if (!(await projectAccess(userId, scope.projectId, session?.user?.role ?? 'viewer'))) continue;
        const r = await retrieve(scope.projectId, String(content), 6, {
          docId: scope.docId,
          orgId,
        });
        if (r.context) {
          messages.push({ role: 'system', content: r.context });
          citations = citations.concat(r.citations);
        }
      } catch {
        /* referenced KB optional — chat still answers without it */
      }
    }
  }
  // Inline-citation numbering: tell the model to cite with bracketed numbers ([1], [2] …) keyed to
  // the retrieved sources, in the SAME order buildSources()/the transcript footer number them (via
  // shared sourceNames). MUST run after ALL citations are gathered (org + project + @-KB) so the
  // numbering covers referenced KBs too. No sources → no instruction (no-op).
  if (citations.length) {
    const instruction = citationInstruction(sourceNames(citations));
    if (instruction) messages.push({ role: 'system', content: instruction });
  }
  // Cap history to the most recent turns so we don't overflow the model context (and, on this
  // hardware, don't pay for prefill of a huge transcript every turn). OpenWebUI-style trim.
  const MAX_HISTORY = 24;
  for (const m of prior.slice(-MAX_HISTORY)) {
    if (m.role === 'system') continue;
    messages.push({ role: m.role, content: m.content });
  }
  // On regenerate/edit the driving user turn is already in `prior` (edit persisted it as the new
  // branch); only add + persist a brand-new turn otherwise.
  if (!regenerate && !editMessageId) {
    // The MODEL sees the guardrail-governed copy (redacted when the contract required masking); the
    // user's OWN typed message is persisted verbatim below (the redaction protects what leaves to the
    // model, matching the agent path's guardrail floor).
    const userContent: ContentPart[] = [{ type: 'text', text: modelContent }];
    for (const url of Array.isArray(images) ? images : []) {
      if (typeof url === 'string' && url.startsWith('data:')) {
        userContent.push({ type: 'image_url', image_url: { url } });
      }
    }
    messages.push({ role: 'user', content: userContent.length > 1 ? userContent : modelContent });
    if (!temporary) {
      await addMessage({
        conversationId: convo.id,
        role: 'user',
        content: String(content),
        images: userContent.length > 1 ? images : null,
      });
    }
  }

  const effectiveModel = model || skillModel;
  const role = session?.user?.role ?? 'viewer';

  // Governance: RBAC gate the model + skill (abacRules deny), and enforce the project's budget.
  if (effectiveModel && (await isDenied(role, 'chat.model', effectiveModel))) {
    return deny(`model ${effectiveModel} is not permitted for your role`);
  }
  if (activeSkillId && (await isDenied(role, 'chat.skill', activeSkillId))) {
    return deny('this skill is not permitted for your role');
  }
  // Budget GATE — a hard stop, not just an alert. Price the cost this call WOULD incur (prompt
  // estimate + the reply headroom, at this model's finops rate) and ask the pure `checkBudget` gate
  // via projectBudget. Local ($0) models never exceed, so on-prem chat is never blocked; only real
  // cloud egress can be denied. On DENY → 402 (Payment Required) to the client + a budget.deny audit
  // event (outcome=blocked). Enforcement is togglable per org (default ON) — projectBudget honors it.
  const promptChars = messages.reduce(
    (n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length),
    0,
  );
  const estCallTokens = estimateTokens(String(promptChars ? promptChars : content)) + 2048; // + max_tokens reply
  const incomingCost = costForTokens(effectiveModel || 'unknown', estCallTokens);
  // Thread the run's org so the per-org enforce state is honored (chat runs under DEFAULT_ORG, the
  // same org used for this path's audit events above/below — keep them in lockstep).
  const budget = await projectBudget(ragProjectId, incomingCost, DEFAULT_ORG);
  if (!budget.ok) {
    // Record the denial in the audit ledger (canonical event: action=budget.deny, outcome=blocked)
    // so "we can prove spend limits are enforced" holds — the block is attributable + auditable.
    const projectResource = ragProjectId ? `project:${ragProjectId}` : undefined;
    recordAudit({
      actor: actorFrom({ email: userId }),
      org: DEFAULT_ORG,
      project: ragProjectId ?? undefined,
      action: 'budget.deny',
      resource: budget.keyId ? `key:${budget.keyId}` : projectResource,
      model: effectiveModel || undefined,
      costUsd: incomingCost,
      outcome: 'blocked',
    });
    return new Response(
      JSON.stringify({
        error: 'budget_exceeded',
        message: `Project budget exceeded — this call would cost ~$${incomingCost.toFixed(4)} and the monthly budget of $${budget.limit} is already at $${budget.spent.toFixed(4)}. Contact an admin to raise it.`,
        spent: budget.spent,
        limit: budget.limit,
        incomingCost,
      }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );
  }

  // Org connectors (tool-calling): let the model decide whether to call a permitted tool. Mutating
  // tools require human approval — if any is pending, stop and ask the UI to approve before running.
  try {
    const resolved = await resolveTools(role, messages, effectiveModel, approvals, {
      conversationId: convo.id,
      userEmail: userId,
    });
    if (resolved?.pending?.length) {
      const body = `data: ${JSON.stringify({ approvalRequest: resolved.pending })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }
    if (resolved?.messages?.length) {
      for (const m of resolved.messages) messages.push(m as (typeof messages)[number]);
    }
    // Inline citations: when a connector actually returned data, attach it as a source citation
    // (same shape as project-RAG citations: name + position + score) so the answer cites its tools.
    for (const a of resolved?.activity ?? []) {
      if (a.status !== 'executed') continue;
      citations.push({ name: a.ref || a.tool, position: citations.length + 1, score: 1 });
    }
  } catch {
    /* tool layer optional — chat still answers without it */
  }

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: 2048,
    temperature: 0.7,
    stream: true,
    chat_template_kwargs: { enable_thinking: Boolean(thinking) },
  };
  if (effectiveModel) payload.model = effectiveModel;

  // ── Model routing: local | cloud | block ──────────────────────────────────────────────────────
  // Resolve where this turn runs. The PURE decideRouting()/planCloudRoute() own the rules; egress is
  // default-OFF, and a `data_class=pii` (or any rule that maps to local/block) can NEVER reach cloud.
  // A cloud plan with no configured provider degrades honestly to local (never a fabricated cloud
  // answer). All egress is audited.
  const egressCtx = {
    actor: actorFrom({ email: userId }),
    org: DEFAULT_ORG,
    project: convo.projectId ?? null,
  };
  let plan = await resolveCloudPlan({
    data_class: String(dataClass || 'public'),
    task: 'chat',
    model: effectiveModel || '',
  }).catch(() => null);

  // PA-16b — the bound-pipeline egress leash, ADDITIVE on top of the chat's own routing plan. The
  // pipeline can only be MORE restrictive: a 'block' verdict is a hard stop (deny + audit); a
  // 'local' verdict (forceLocal) demotes a cloud plan to on-prem so the pipeline's ceiling can never
  // be widened by chat routing. Null contract ⇒ the noPipeline verdict is permissive (legacy).
  const modelVerdict = enforceModelCall(pipelineContract, String(dataClass || 'public'));
  if (!modelVerdict.allow) {
    auditEnforcement(enforceCtx, 'pipeline.egress.block', `model:${effectiveModel || 'default'}`, 'blocked', modelVerdict.reason);
    return deny(`request blocked by pipeline egress leash: ${modelVerdict.reason}`);
  }
  if (modelVerdict.forceLocal && plan?.kind === 'cloud') {
    auditEnforcement(enforceCtx, 'pipeline.egress.local', `model:${effectiveModel || 'default'}`, 'redacted', modelVerdict.reason);
    // Demote the cloud plan to on-prem (leash to local) — the pipeline can only tighten, never widen.
    plan = {
      kind: 'local',
      selection: null,
      cloudUnavailable: false,
      model: null,
      reason: `pipeline egress leash → local: ${modelVerdict.reason}`,
    };
  }

  // A blocked route is a hard stop — nothing runs, and the block is audited (leash proof).
  if (plan?.kind === 'block') {
    recordAudit(egressBlockedAuditEvent(egressCtx, plan));
    return deny(`request blocked by routing policy: ${plan.reason}`);
  }
  // Cloud unavailable → we fell back to local; record it so the honest degradation is provable.
  if (plan?.kind === 'local' && plan.cloudUnavailable) {
    recordAudit(egressBlockedAuditEvent(egressCtx, plan));
  }

  // Observability: mark when the upstream request begins so the Langfuse generation observation
  // records real latency once the completion finalizes.
  const traceStart = Date.now();
  // When routing resolves to a wired cloud provider, forward the OpenAI-compatible request there and
  // relay its stream; otherwise (local, or cloud-unavailable fallback) hit the on-prem gateway. Egress
  // to cloud is audited after the stream finalizes (below), attributing the provider model + tokens.
  const routedToCloud = plan?.kind === 'cloud' && plan.selection != null;
  const upstream = routedToCloud
    ? (await forwardToCloud(plan!.selection!, payload, { timeoutMs: 290000 })).response
    : await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        // x-offgrid-user attributes gateway spend to the real signed-in user (captured into the
        // gateway's OpenSearch log as `caller`) rather than the console's user-agent.
        headers: gatewayHeaders({ 'content-type': 'application/json', 'x-offgrid-user': userId }),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(290000),
      }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    // A failed CLOUD call must NOT silently fabricate a local answer — surface the truth + audit it.
    if (routedToCloud && plan) {
      recordAudit(
        egressAuditEvent(egressCtx, plan, { promptTokens: 0, completionTokens: 0 }, 'error'),
      );
    }
    const upstreamLabel = routedToCloud ? 'cloud provider' : 'gateway';
    const detail = upstream ? `${upstreamLabel} ${upstream.status}` : `${upstreamLabel} unreachable`;
    return new Response(`data: ${JSON.stringify({ error: detail })}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  const stream = new ReadableStream({
    // eslint-disable-next-line complexity
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      let reasoning = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const delta = JSON.parse(data)?.choices?.[0]?.delta;
              if (delta?.reasoning_content) {
                reasoning += delta.reasoning_content;
                send({ reasoning: delta.reasoning_content });
              }
              if (delta?.content) {
                full += delta.content;
                send({ content: delta.content });
              }
            } catch {
              /* partial JSON across chunks — ignore, next read completes it */
            }
          }
        }
      } catch (e) {
        send({ error: (e as Error).message });
      }
      // Persist the assistant answer, then tell the client we're done. Temporary chats skip all
      // persistence — the transcript lives only in the client for the session.
      if (!temporary) {
        try {
          await addMessage({
            conversationId: convo.id,
            role: 'assistant',
            content: full,
            reasoning: reasoning || null,
            citations: citations.length ? citations : null,
            // On regenerate/edit, attach under the driving user turn so the old answer stays as a
            // sibling branch; otherwise default to the active leaf (the just-added user turn).
            ...(assistantParentId ? { parentId: assistantParentId } : {}),
          });
        } catch {
          /* best-effort persistence */
        }
      }
      // Egress audit: when this turn actually left the box to a cloud provider, record a
      // `gateway.egress` event with the provider model + real token usage so FinOps prices the cloud
      // spend and the Regulatory ledger proves what left. Local turns skip this (nothing egressed).
      if (routedToCloud && plan) {
        recordAudit(
          egressAuditEvent(
            egressCtx,
            plan,
            {
              promptTokens: estimateTokens(String(content)),
              completionTokens: estimateTokens(full),
            },
            full ? 'ok' : 'error',
          ),
        );
      }
      // Governance: audit this completion so Analytics/FinOps/Regulatory count chat usage, billed
      // to the project's virtual key when one exists.
      void writeChatAudit({
        userId,
        model: effectiveModel,
        tokens: estimateTokens(String(content)) + estimateTokens(full),
        promptTokens: estimateTokens(String(content)),
        completionTokens: estimateTokens(full),
        outcome: full ? 'ok' : 'error',
        keyId: budget.keyId,
        project: convo.projectId ?? null,
      });
      // Cross-conversation memory: distill durable facts from this turn (fire-and-forget).
      // Temporary chats are never added to memory.
      if (!temporary && full && String(content).trim()) {
        void extractMemory(userId, orgId, String(content), full, effectiveModel);
      }
      // Observability: push a Langfuse trace for this chat turn so the Observability page has real
      // data (plain chat previously emitted none). Fire-and-forget; skips temporary/incognito chats.
      // On regenerate/edit `content` may be empty, so fall back to the driving user turn.
      if (!temporary) {
        const traceInput = String(content).trim()
          ? String(content)
          : ([...prior].reverse().find((m) => m.role === 'user')?.content ?? '');
        emitChatTrace({
          conversationId: convo.id,
          userId,
          model: effectiveModel,
          input: traceInput,
          output: full,
          startTime: traceStart,
          endTime: Date.now(),
          promptTokens: estimateTokens(traceInput),
          completionTokens: estimateTokens(full),
          // Correlate the trace with the run's other planes (audit / lineage / provenance) by the one
          // chat-run id — the SAME pattern the agent run uses (traceId == normalize(runId)).
          traceId: correlationIds(chatRunId).traceId,
          // PA-12 — stamp the bound pipeline (resolved above) at the trace SOURCE so the pipeline
          // Observability tab + global Observability filter exactly. Null when nothing is bound.
          pipelineId: pipelineBinding.pipelineId,
        });
      }

      // ── W2: OUTBOUND guardrail scan on the answer. FAIL CLOSED (SECURITY #236): a screen that
      // threw/timed out yields null (NOT an empty "clean" list) so outboundGuardrailBlocks() treats
      // it as a block, and a completed screen with a blocked verdict also blocks. When blocked, tell
      // the client to withhold/redact the raw output rather than trust an un-cleared answer.
      const postChecks: CheckResult[] | null = full
        ? await runOutboundGuardrails(
            full,
            effectiveModel,
            orgId,
            String(content).trim()
              ? String(content)
              : ([...prior].reverse().find((m) => m.role === 'user')?.content ?? ''),
          ).catch(() => null)
        : [];
      const outboundBlocked = full ? outboundGuardrailBlocks(postChecks) : false;
      if (outboundBlocked) {
        send({ guardrail: { phase: 'post', blocked: true } });
        auditEnforcement(
          enforceCtx,
          'pipeline.guardrail.block',
          `conversation:${convo.id || 'temporary'}`,
          'blocked',
          postChecks === null
            ? 'outbound guardrail failed to screen (fail-closed block)'
            : 'outbound guardrail blocked model output',
        );
      }

      // ── W2: PROVENANCE — sign the answer, bound to the run id (tamper-evident, offline-verifiable).
      const refs = citations.map((c) => c.name);
      const provenance = full
        ? signChatAnswer({
            runId: chatRunId,
            conversationId: convo.id,
            query: String(content),
            answer: full,
            refs,
          })
        : null;

      // ── W1: DURABLE RUN — record the governed chat run via the Temporal spine (gated by
      // OFFGRID_QUEUE_ENABLED), inline fallback when the queue is off / Temporal is unreachable. The
      // token stream above already reached the client; this records the run (guardrail verdicts +
      // lineage + attributed audit) durably + replayably, and hands back the workflow/run id.
      const completionStatus = full ? 'done' : 'error';
      const runInput: ChatRunWorkflowInput = {
        runId: chatRunId,
        conversationId: convo.id,
        userId,
        model: effectiveModel,
        query: String(content),
        answer: full,
        orgId,
        project: convo.projectId ?? null,
        pipelineId: pipelineBinding.pipelineId,
        // A null postChecks means the outbound screen failed (fail-closed above) — record none rather
        // than fabricate a clean verdict; the 'blocked' status below is the durable signal.
        checks: [...preChecks, ...(postChecks ?? [])],
        refs,
        status: outboundBlocked ? 'blocked' : completionStatus,
      };
      const dispatch = await dispatchChatRun(runInput).catch(() => null);

      // Surface the durable identity + trust artifacts to the client so the UI can show the run id,
      // its provenance signature, and whether it was recorded durably.
      send({
        run: {
          runId: chatRunId,
          mode: dispatch?.mode ?? 'inline',
          workflowId: dispatch?.workflowId ?? null,
          status: dispatch?.status ?? runInput.status,
          checks: runInput.checks,
          provenance,
        },
      });
      if (citations.length) send({ citations });
      send({ done: true });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
