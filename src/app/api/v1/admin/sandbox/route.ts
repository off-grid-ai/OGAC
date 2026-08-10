import { NextResponse } from 'next/server';
import { getFlags, getSandbox } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { listSandboxRuns } from '@/lib/sandbox-runs-store';
import { normalizeSandbox, readSandboxStatus } from '@/lib/sandbox-view';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Backend ids that actually execute code; anything else (e.g. 'none') refuses. Kept in sync with
// the SandboxResult contract in adapters/sandbox.ts. Firecracker still refuses on non-KVM hosts,
// but it IS an exec-capable adapter — the run route surfaces its runtime refusal honestly.
const EXEC_CAPABLE_BACKENDS = new Set(['docker', 'firecracker', 'e2b']);

// Read-back of the code-execution sandbox: which backend is active, whether it's reachable, and
// the recent exec runs. Thin handler — the display model is built by the pure normalizer, the
// only I/O is the best-effort adapter health read (which never throws) + the org-scoped run history.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const orgId = await currentOrgId();
  const [{ data, error }, runs] = await Promise.all([
    readSandboxStatus(getSandbox()),
    listSandboxRuns(orgId),
  ]);
  const view = normalizeSandbox(data, runs);
  // The Run Code panel is DOUBLE-GATED (mirrors the run route): the agent-code-exec flag must be
  // ON (default OFF) AND the active adapter must be an exec-capable backend (default 'none' refuses).
  // Surfaced here so the UI can honestly disable the panel + explain why, without faking a run.
  const execEnabled = await getFlags().isEnabled('agent-code-exec', false);
  const execCapable = EXEC_CAPABLE_BACKENDS.has(view.backend);
  return NextResponse.json({ object: 'sandbox', data: view, error, execEnabled, execCapable });
}
