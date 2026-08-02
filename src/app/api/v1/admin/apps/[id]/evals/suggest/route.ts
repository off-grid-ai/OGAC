import { NextResponse } from 'next/server';
import { newSuggestions, suggestEvalsForApp, type SuggestedEval } from '@/lib/app-eval-suggest';
import { getApp } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { listDomains } from '@/lib/data-domains-store';
import { addGoldenCase, listGoldenCases } from '@/lib/evals';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

type SpecStep = { id: string; kind: string; label?: string; domain?: string };

/**
 * Steps with their domain rendered as the LABEL an operator declared, not its id. A check that reads
 * "Cites dom_6fe4f965-919" is unreadable and unreviewable; "Cites customer data" is the same assertion
 * in the words the org chose. Falls back to the id when a binding no longer resolves — silently
 * dropping an unresolvable domain would hide a broken step.
 */
async function stepsWithDomainLabels(steps: SpecStep[], orgId: string): Promise<SpecStep[]> {
  const domains = await listDomains(orgId).catch(() => []);
  const label = new Map(domains.map((d) => [d.id, d.label]));
  return steps.map((s) =>
    s.domain ? { ...s, domain: label.get(s.domain) ?? s.domain } : s,
  );
}

// ─── Evaluations derived from an app's own design (ROADMAP §10 Flow 3) ─────────────────────────────
//
// "OGAC generates the app and tests" / "generates or updates evaluations". Compiling a brief produced
// neither, verified live. These two handlers close that:
//
//   GET  → the checks this app's SPEC implies, minus the ones already in its evaluation set.
//   POST → accept a subset, written as golden cases bound to the app's pipeline AND the caller's org.
//
// Suggestions are never auto-accepted. A golden case nobody agreed to is a test that fails for reasons
// nobody owns, and its failures become noise the team learns to ignore.
export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const existing = await listGoldenCases({ orgId, appId: id }).catch(() => []);
  const all = suggestEvalsForApp({
    id: app.id,
    title: app.title,
    summary: app.summary,
    pipelineId: app.pipelineId ?? null,
    steps: await stepsWithDomainLabels(app.steps as SpecStep[], orgId),
  });
  return NextResponse.json({
    object: 'list',
    data: newSuggestions(all, existing),
    alreadyCovered: all.length - newSuggestions(all, existing).length,
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { keys?: unknown };
  const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
  if (!keys.length) {
    return NextResponse.json(
      { error: 'Choose at least one check to add.' },
      { status: 400 },
    );
  }

  const suggestions = suggestEvalsForApp({
    id: app.id,
    title: app.title,
    summary: app.summary,
    pipelineId: app.pipelineId ?? null,
    steps: await stepsWithDomainLabels(app.steps as SpecStep[], orgId),
  });
  const chosen = suggestions.filter((s: SuggestedEval) => keys.includes(s.key));
  if (!chosen.length) {
    return NextResponse.json({ error: 'Those checks no longer apply to this app.' }, { status: 409 });
  }

  const created: string[] = [];
  for (const s of chosen) {
    const gc = await addGoldenCase(
      { name: s.name, query: s.query, expected: s.expected, suite: `app:${app.id}` },
      // Bound to the app AND its pipeline AND the org — the same stamping the feedback loop needed
      // before a tenant's corrections could reach its own evaluations.
      { appId: app.id, pipelineId: app.pipelineId ?? null, orgId },
    );
    created.push(gc.id);
  }
  auditFromSession(gate, orgId, {
    action: 'eval.cases.generated',
    resource: `app:${app.id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, created }, { status: 201 });
}
