import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  listRetentionRules,
  listRetentionRuns,
  runRetentionSweep,
  upsertRetentionRule,
} from '@/lib/retention-store';
import { isRetainableClass } from '@/lib/retention-sweep';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Retention that runs, and leaves evidence ──────────────────────────────────────────────────────
//
// Retention settings existed and were evaluated for DISPLAY — a page could say an asset was "due" and
// nothing ever acted on it. No sweep had ever run and none was recorded, so "prove you delete data
// when you said you would" had no answer.
//
// GET   → the rules + every sweep already on record.
// PUT   → set the rule for one record class.
// POST  → run the sweep now and file the evidence.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const [rules, runs] = await Promise.all([listRetentionRules(org), listRetentionRuns(org)]);
  return NextResponse.json({ rules, runs });
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as {
    recordClass?: string;
    retainDays?: number;
    action?: string;
    legalHold?: boolean;
  } | null;
  if (!body?.recordClass || !isRetainableClass(body.recordClass)) {
    return NextResponse.json({ error: 'Pick a record class this console can act on.' }, { status: 400 });
  }
  const days = Number(body.retainDays);
  if (!Number.isFinite(days) || days < 0 || days > 36_500) {
    return NextResponse.json(
      { error: 'Retention must be a number of days between 0 (keep forever) and 36500.' },
      { status: 400 },
    );
  }
  const org = await currentOrgId();
  await upsertRetentionRule(
    {
      recordClass: body.recordClass,
      retainDays: Math.floor(days),
      action: body.action === 'redact' ? 'redact' : 'delete',
      legalHold: Boolean(body.legalHold),
    },
    gate.user?.email ?? '',
    org,
  );
  auditFromSession(gate, org, {
    action: 'data.retention.rule',
    resource: `retention:${body.recordClass}`,
    outcome: 'ok',
  });
  return NextResponse.json({ rules: await listRetentionRules(org) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const record = await runRetentionSweep(gate.user?.email ?? '', org);
  auditFromSession(gate, org, {
    action: 'data.retention.sweep',
    resource: `sweep:${record.id}`,
    outcome: record.complete ? 'ok' : 'error',
  });
  return NextResponse.json({ run: record }, { status: 201 });
}
