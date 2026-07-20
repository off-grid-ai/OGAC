import { NextResponse } from 'next/server';
import { submitAppRun } from '@/lib/adapters/apprun';
import { newAppRunId } from '@/lib/app-run';
import { getAppBySlug } from '@/lib/apps-store';
import { requireUser } from '@/lib/authz';
import { pipelineBindingHttpFailure } from '@/lib/pipeline-binding-http';
import { currentOrgId } from '@/lib/tenancy';
import { buildTriggerInput } from '@/lib/trigger-dispatch';

export const dynamic = 'force-dynamic';

// ─── Webhook trigger route (Builder Epic #103, Phase 4C) ──────────────────────────────────────────
//
// POST /api/v1/app/<slug>/run — the INBOUND WEBHOOK that fires a published app. This is the safe-
// first, air-gap-clean input trigger: it takes an arbitrary JSON body, normalizes it to the app-run
// `input` via the PURE buildTriggerInput, and funnels it through the SAME governed entry point every
// other trigger uses — submitAppRun (policy / guardrails / grounding / signing all apply). There is
// NO governance bypass and no cloud dependency: the payload arrives on our own inbound route.
//
// GOVERNED, NOT WIDE OPEN. A webhook that runs a governed app must still be authorized. We accept:
// (1) a per-app WEBHOOK TOKEN — the shared secret OFFGRID_WEBHOOK_TOKEN, supplied as the
// `X-Webhook-Token` header or `?token=` query param (the token an operator pastes into an external
// system's webhook config); (2) a fully-verified authenticated principal via requireUser — a Keycloak
// service-account JWT, the break-glass admin token, or a console session. A gateway `ogak_` key is
// NOT accepted by string shape here (it is verified by the aggregator via client_credentials, not by
// shape). If neither proof is satisfied → 401. The app must exist AND be published.
//
// SOLID: thin handler. Auth + load + normalize-input (pure) + delegate to submitAppRun. All run
// logic lives in app-run.ts / apprun.ts; all payload shaping in trigger-dispatch.ts.

function tokenFromRequest(req: Request, url: URL): string {
  return (req.headers.get('x-webhook-token') ?? url.searchParams.get('token') ?? '').trim();
}

// A valid per-app webhook token when OFFGRID_WEBHOOK_TOKEN is set AND matches. Constant-time-ish:
// require both non-empty and strict equality (tokens are opaque secrets, compared as whole strings).
function webhookTokenOk(supplied: string): boolean {
  const expected = (process.env.OFFGRID_WEBHOOK_TOKEN ?? '').trim();
  return expected.length > 0 && supplied.length > 0 && supplied === expected;
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);

  // ── Authorize (governed, not wide open) ──────────────────────────────────────────────────────
  // Two accepted proofs: (1) the per-app WEBHOOK TOKEN secret (X-Webhook-Token / ?token=) — this is
  // what an operator pastes into an external system's webhook config; (2) a fully-VERIFIED principal
  // via requireUser (a Keycloak service-account JWT, the break-glass admin token, or a console
  // session). We do NOT accept a shape-only ogak_ key here: that string is verified by the aggregator
  // via a Keycloak client_credentials exchange, not by string shape — trusting the shape would be an
  // auth bypass. Neither proof satisfied → 401.
  const suppliedToken = tokenFromRequest(req, url);
  if (!webhookTokenOk(suppliedToken)) {
    const gate = await requireUser(req);
    if (gate instanceof NextResponse) {
      return NextResponse.json(
        { error: 'unauthorized — supply a valid X-Webhook-Token, service token, or session' },
        { status: 401 },
      );
    }
  }

  // ── Load the published app by slug ────────────────────────────────────────────────────────────
  const app = await getAppBySlug(slug);
  if (!app) return NextResponse.json({ error: 'app not found' }, { status: 404 });
  if (!app.published) {
    return NextResponse.json({ error: 'app is not published' }, { status: 404 });
  }

  // ── Normalize the inbound payload → governed app-run input (PURE) ────────────────────────────
  const body = await req.json().catch(() => ({}));
  const input = buildTriggerInput('webhook', body);

  // ── Funnel through the SAME governed entry point (submitAppRun) ──────────────────────────────
  const orgId = app.orgId || (await currentOrgId());
  const runId = newAppRunId();
  try {
    const handle = await submitAppRun(app, input, {
      orgId,
      actor: 'trigger:webhook',
      runId,
    });
    return NextResponse.json(
      {
        object: 'app_run',
        runId: handle.runId,
        status: handle.status ?? 'queued',
        mode: handle.mode,
        submitted: handle.submitted,
        ...(handle.workflowId ? { workflowId: handle.workflowId } : {}),
        ...(handle.outcome ? { outcome: handle.outcome.outcome } : {}),
      },
      { status: 202 },
    );
  } catch (e) {
    const failure = pipelineBindingHttpFailure(e);
    if (failure) return NextResponse.json(failure.body, { status: failure.status });
    // Never surface the internal error text (may carry endpoint/stack detail) to an app caller —
    // log server-side, return a generic message.
    console.error('app run failed:', e);
    return NextResponse.json({ error: 'application error' }, { status: 500 });
  }
}
