import { NextResponse } from 'next/server';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Secret KEYS for a namespace — values are never returned by the engine and never surfaced. Secrets
// are read-only on this OSS engine (managed via the deployment's config/env, not the API), which the
// `readOnly` flag communicates to the UI so it doesn't offer a write it can't honor.
export async function GET(req: Request, { params }: { params: Promise<{ ns: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { ns } = await params;
  const secrets = await kestraCatalog.listSecrets(ns);
  return NextResponse.json(secrets);
}
