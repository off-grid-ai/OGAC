import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { finalizeKeyCreation } from '@/lib/rate-limit-store';
import { createApiKey, listApiKeys } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

const TYPES = new Set(['user', 'project']);

function valid(b: Record<string, unknown> | null): boolean {
  if (!b) return false;
  return Boolean(b.name) && Boolean(b.subject) && TYPES.has(b.subjectType as string);
}

// A per-key rate limit (requests/minute). null = no per-key limit (falls back to org/global).
function parseRateLimit(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listApiKeys(await currentOrgId()) });
}

// Issue a virtual key. The secret token is returned ONCE here and never stored in cleartext.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!valid(b)) {
    return NextResponse.json(
      { error: 'name, subject, subjectType (user|project) required' },
      { status: 400 },
    );
  }
  const budget = typeof b!.budgetUsd === 'number' ? (b!.budgetUsd as number) : null;
  const rateLimit = parseRateLimit(b!.rateLimit);
  const created = await createApiKey({
    name: b!.name as string,
    subjectType: b!.subjectType as string,
    subject: b!.subject as string,
    budgetUsd: budget,
  });
  // Store the secret's hash (so the edge can resolve this key from a presented Bearer) + the per-key
  // rate limit. Kept out of store.createApiKey so schema.ts stays untouched (self-migrating columns).
  await finalizeKeyCreation(created.key.id, created.token, rateLimit);
  auditFromSession(gate, await currentOrgId(), {
    action: 'access.machine.issue',
    resource: `key:${created.key.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
