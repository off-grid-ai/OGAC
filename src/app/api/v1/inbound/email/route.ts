import { NextResponse } from 'next/server';
import { getApp } from '@/lib/apps-store';
import { newAppRunId } from '@/lib/app-run';
import { submitAppRun } from '@/lib/adapters/apprun';
import { dispatchAgentRun } from '@/lib/agent-run-dispatch';
import { resolveConsumerPipeline } from '@/lib/chat-pipeline-policy';
import { resolveContract } from '@/lib/pipeline-contract';
import { getCustomAgent, recordAudit } from '@/lib/store';
import { machineActor } from '@/lib/audit-event';
import { getWebhookTriggerByToken, markWebhookFired } from '@/lib/webhook-triggers';
import { enforceAppAccess } from '@/lib/app-access';
import { callerFromMachine } from '@/lib/app-access-caller';
import { inboundConfigFromEnv, normalizeInboundEmail, type RawInboundEmail } from '@/lib/inbound-email';

export const dynamic = 'force-dynamic';

// ─── PUBLIC inbound-email ingress — forward-to-address → governed run ──────────────────────────────
//
// POST /api/v1/inbound/email — the customer's email provider (Resend inbound-parse, SES, or a plain
// forwarding rule pointed at a parse service) POSTs the parsed email here. The bound consumer is
// resolved from the RECIPIENT address (`<token>@inbound.<host>`) — the token IS a webhook trigger's
// token, so this is a SECOND ingress shape over the SAME trigger seam (READ-only lookup). The fired
// run executes under the trigger's org through submitAppRun / dispatchAgentRun, so contract +
// guardrails + PII + egress leash + audit all apply identically to every other run.
//
// AUTH: the token embedded in the recipient address is the routing key. Because inbound email is not
// signed by the sender, the per-app ACCESS policy still gates the machine caller (least-privilege),
// and per-IP rate limiting is inherited from src/middleware.ts (/api/*). Set the inbound-parse target
// at the provider to this URL (documented in the console UI + docs).
//
// Responses: 202 {runId} accepted · 404 unknown token / disabled / missing target · 400 bad body or
// no matching recipient · 503 inbound not configured (no OFFGRID_INBOUND_EMAIL_DOMAIN).
export async function POST(req: Request) {
  const cfg = inboundConfigFromEnv();
  if (!cfg.ok) return NextResponse.json({ error: cfg.reason }, { status: 503 });

  let raw: RawInboundEmail;
  try {
    raw = (await req.json()) as RawInboundEmail;
  } catch {
    return NextResponse.json({ error: 'body must be JSON (an inbound-parse payload)' }, { status: 400 });
  }

  const { token, input, attachments } = normalizeInboundEmail(raw, cfg.domain!);
  if (!token) {
    return NextResponse.json(
      { error: `no recipient matched @${cfg.domain} — set the inbound-parse target to <token>@${cfg.domain}` },
      { status: 400 },
    );
  }

  const trigger = await getWebhookTriggerByToken(token).catch(() => null);
  if (!trigger || !trigger.enabled) {
    return NextResponse.json({ error: 'unknown or disabled inbound address' }, { status: 404 });
  }

  const orgId = trigger.orgId;
  const actor = machineActor(`inbound-email:${trigger.id}`, trigger.label || 'Inbound email');
  const runId = newAppRunId();
  const mcaller = callerFromMachine(actor, orgId);

  if (trigger.targetKind === 'app') {
    const app = await getApp(trigger.targetId, orgId);
    if (!app) return NextResponse.json({ error: 'target app not found' }, { status: 404 });
    const access = await enforceAppAccess({
      appId: trigger.targetId,
      orgId,
      ownerId: app.ownerId,
      caller: mcaller,
      action: 'trigger',
      requestAttrs: input,
    });
    if (!access.allow) {
      recordAudit({
        actor,
        org: orgId,
        action: 'access.denied',
        resource: `inbound-email:${trigger.id} app:${trigger.targetId} trigger`,
        outcome: 'blocked',
      });
      return NextResponse.json({ error: 'access denied', reason: access.reason }, { status: 403 });
    }
    const pipelineId = resolveConsumerPipeline(app.pipelineId, null);
    const contract = await resolveContract(pipelineId, orgId);
    const handle = await submitAppRun(app, input, { orgId, actor: actor.id, runId, contract });
    await markWebhookFired(token);
    recordAudit({
      actor,
      org: orgId,
      action: 'trigger.fired',
      resource: `inbound-email:${trigger.id} app:${trigger.targetId} (${attachments.length} attachments)`,
      runId: handle.runId,
      outcome: handle.status === 'error' ? 'error' : 'ok',
    });
    return NextResponse.json(
      { object: 'inbound_email_fire', runId: handle.runId, mode: handle.mode, target: 'app' },
      { status: 202 },
    );
  }

  // agent target
  const agent = await getCustomAgent(trigger.targetId, orgId).catch(() => null);
  if (!agent) return NextResponse.json({ error: 'target agent not found' }, { status: 404 });
  const agentAccess = await enforceAppAccess({
    appId: trigger.targetId,
    orgId,
    ownerId: '',
    caller: mcaller,
    action: 'trigger',
    requestAttrs: input,
  });
  if (!agentAccess.allow) {
    recordAudit({
      actor,
      org: orgId,
      action: 'access.denied',
      resource: `inbound-email:${trigger.id} agent:${trigger.targetId} trigger`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: 'access denied', reason: agentAccess.reason }, { status: 403 });
  }
  const query = typeof input.input === 'string' && input.input.trim() ? input.input : String(input.subject ?? '');
  const dispatch = await dispatchAgentRun({
    agentId: trigger.targetId,
    query,
    orgId,
    actor,
    caller: 'webhook',
  });
  await markWebhookFired(token);
  recordAudit({
    actor,
    org: orgId,
    action: 'trigger.fired',
    resource: `inbound-email:${trigger.id} agent:${trigger.targetId}`,
    runId: dispatch.runId,
    outcome: dispatch.run?.status === 'error' ? 'error' : 'ok',
  });
  return NextResponse.json(
    { object: 'inbound_email_fire', runId: dispatch.runId, mode: dispatch.mode, target: 'agent' },
    { status: 202 },
  );
}
