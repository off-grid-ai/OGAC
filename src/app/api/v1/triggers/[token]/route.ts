import { NextResponse } from 'next/server';
import { submitAppRun } from '@/lib/adapters/apprun';
import { dispatchAgentRun } from '@/lib/agent-run-dispatch';
import { callerFromMachine } from '@/lib/app-access-caller';
import { newAppRunId } from '@/lib/app-run';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { getApp } from '@/lib/apps-store';
import { machineActor } from '@/lib/audit-event';
import { pipelineBindingHttpFailure } from '@/lib/pipeline-binding-http';
import { getCustomAgent, recordAudit } from '@/lib/store';
import { buildTriggerInput } from '@/lib/trigger-dispatch';
import { verifyWebhook } from '@/lib/webhook-trigger-policy';
import {
  claimWebhookNonce,
  getWebhookTriggerByToken,
  markWebhookFired,
  resolveWebhookSecret,
} from '@/lib/webhook-triggers';

export const dynamic = 'force-dynamic';

// ─── PUBLIC webhook ingress — the universal inbound trigger primitive ─────────────────────────────
//
// POST /api/v1/triggers/[token]  — an external system (or Cloudflare Email Routing, or an integrator)
// POSTs here to fire a GOVERNED run of the app/agent the token is bound to. This is deliberately the
// ONLY unauthenticated-by-session route in the tree; its auth is an HMAC signature over the body:
//   X-Offgrid-Signature: sha256=<hex(HMAC_SHA256(secret, `${ts}.${rawBody}`))>
//   X-Offgrid-Timestamp: <unix seconds|ms>   (bound into the MAC; ±5min window)
// The signing secret is per-trigger, vaulted in OpenBao (only a ref in the row). Replays are rejected
// by a nonce claim on the signature. The fired run executes UNDER THE TRIGGER'S org (a governance
// boundary — the token can only ever start the tenant + target it was minted for) through the SAME
// submitAppRun / dispatchAgentRun path as every other run, so contract + guardrails + PII + egress
// leash + audit all apply identically. Per-IP rate limiting is inherited from src/middleware.ts (/api/*).
//
// Responses: 202 {runId} accepted · 401 bad/absent/expired signature or replay · 404 unknown/disabled
// token or missing target · 400 unparseable body. Never leaks whether a token exists via timing — a
// missing token and a bad signature both return a flat 401/404 with no target detail.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rawBody = await req.text().catch(() => '');

  const trigger = await getWebhookTriggerByToken(token).catch(() => null);
  if (!trigger?.enabled) {
    return NextResponse.json({ error: 'unknown or disabled trigger' }, { status: 404 });
  }

  // Verify the signature (pure decision) against the vaulted per-trigger secret.
  const secret = await resolveWebhookSecret(token).catch(() => null);
  const verdict = verifyWebhook({
    rawBody,
    signature: req.headers.get('x-offgrid-signature'),
    timestamp: req.headers.get('x-offgrid-timestamp'),
    secret,
    nowMs: Date.now(),
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: verdict.code });

  // Replay defence — the accepted signature is single-use within the window.
  const fresh = await claimWebhookNonce(verdict.sig).catch(() => true);
  if (!fresh) return NextResponse.json({ error: 'replayed request' }, { status: 409 });

  // Parse the body (JSON if it is; else pass the raw text through) → normalize to the app-run input.
  let parsed: unknown = rawBody;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsed = { input: rawBody };
  }
  const input = buildTriggerInput('webhook', parsed);

  const orgId = trigger.orgId;
  const actor = machineActor(`webhook:${trigger.id}`, trigger.label || 'Webhook trigger');
  const runId = newAppRunId();

  // Per-app ACCESS CONTROL for the machine ingress: a webhook is a `machine`-role caller taking the
  // `trigger` action. Least-privilege — a token can fire the consumer only if its policy explicitly
  // admits the `machine` role (or `*`) for `trigger` (or the target is owner-less/admin-scoped and
  // the machine is not an owner/admin ⇒ denied). Denied → 403 + reason, audited access.denied.
  const mcaller = callerFromMachine(actor, orgId);

  if (trigger.targetKind === 'app') {
    const app = await getApp(trigger.targetId, orgId);
    if (!app) return NextResponse.json({ error: 'target app not found' }, { status: 404 });
    const access = await enforceAppAccessWithSharing({
      appId: trigger.targetId,
      orgId,
      ownerId: app.ownerId,
      caller: mcaller,
      action: 'trigger',
      requestAttrs: (input as Record<string, unknown>) ?? {},
    });
    if (!access.allow) {
      recordAudit({
        actor,
        org: orgId,
        action: 'access.denied',
        resource: `webhook:${trigger.id} app:${trigger.targetId} trigger`,
        outcome: 'blocked',
      });
      return NextResponse.json({ error: 'access denied', reason: access.reason }, { status: 403 });
    }
    let handle: Awaited<ReturnType<typeof submitAppRun>>;
    try {
      handle = await submitAppRun(app, input, { orgId, actor: actor.id, runId });
    } catch (error) {
      const failure = pipelineBindingHttpFailure(error);
      if (!failure) throw error;
      recordAudit({
        actor,
        org: orgId,
        action: 'trigger.denied',
        resource: `webhook:${trigger.id} app:${trigger.targetId} pipeline-binding:${failure.body.code}`,
        outcome: 'blocked',
      });
      return NextResponse.json(failure.body, { status: failure.status });
    }
    await markWebhookFired(token);
    recordAudit({
      actor,
      org: orgId,
      action: 'trigger.fired',
      resource: `webhook:${trigger.id} app:${trigger.targetId}`,
      runId: handle.runId,
      outcome: handle.status === 'error' ? 'error' : 'ok',
    });
    return NextResponse.json(
      { object: 'trigger_fire', runId: handle.runId, mode: handle.mode, target: 'app' },
      { status: 202 },
    );
  }

  // agent target
  const agent = await getCustomAgent(trigger.targetId, orgId).catch(() => null);
  if (!agent) return NextResponse.json({ error: 'target agent not found' }, { status: 404 });
  const agentAccess = await enforceAppAccessWithSharing({
    appId: trigger.targetId,
    orgId,
    ownerId: '',
    caller: mcaller,
    action: 'trigger',
    requestAttrs: (input as Record<string, unknown>) ?? {},
  });
  if (!agentAccess.allow) {
    recordAudit({
      actor,
      org: orgId,
      action: 'access.denied',
      resource: `webhook:${trigger.id} agent:${trigger.targetId} trigger`,
      outcome: 'blocked',
    });
    return NextResponse.json(
      { error: 'access denied', reason: agentAccess.reason },
      { status: 403 },
    );
  }
  const query = typeof input.input === 'string' && input.input.trim() ? input.input : rawBody;
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
    resource: `webhook:${trigger.id} agent:${trigger.targetId}`,
    runId: dispatch.runId,
    outcome: dispatch.run?.status === 'error' ? 'error' : 'ok',
  });
  return NextResponse.json(
    { object: 'trigger_fire', runId: dispatch.runId, mode: dispatch.mode, target: 'agent' },
    { status: 202 },
  );
}
