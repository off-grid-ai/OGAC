import { NextResponse } from 'next/server';
import { getSandbox } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { normalizeSandbox, readSandboxStatus } from '@/lib/sandbox-view';

export const dynamic = 'force-dynamic';

// Read-back of the code-execution sandbox: which backend is active, whether it's reachable, and
// the recent exec runs. Thin handler — the display model is built by the pure normalizer, the
// only I/O is the best-effort adapter health read (which never throws).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { data, error } = await readSandboxStatus(getSandbox());
  // Exec-run history is not yet persisted; pass an empty set until a store lands.
  const view = normalizeSandbox(data, []);
  return NextResponse.json({ object: 'sandbox', data: view, error });
}
