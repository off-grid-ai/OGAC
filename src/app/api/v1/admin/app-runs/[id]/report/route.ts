import { NextResponse } from 'next/server';
import { renderAppRunReport } from '@/lib/adapters/sinks/report';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── App-run REPORT download (Builder Epic Phase 4B, §3.3 output sink) ─────────────────────────────
// GET /api/v1/admin/app-runs/[id]/report[?format=pdf|md][&manifest=1]
//
// Streams a single app-run as a signed, auditable report — a PDF (default) or the raw Markdown. The
// detached ed25519 provenance rides in X-Provenance-* headers (base64 public key, since PEM's
// newlines are illegal in a header); ?manifest=1 returns the manifest JSON instead of the file, for
// offline verification at POST /api/v1/admin/provenance/verify. Admin-gated + org-scoped, and thin:
// auth → load run (org-scoped reader) → render (sink) → stream. All the shaping is in the sink + the
// pure app-reports rollup, so this handler carries no report logic.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const orgId = await currentOrgId();

  const run = await getAppRunView(id, orgId);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'md' ? 'md' : 'pdf';
  const report = await renderAppRunReport(run, format);

  if (url.searchParams.get('manifest') === '1') {
    return NextResponse.json(report.manifest);
  }

  auditFromSession(gate, orgId, {
    action: 'app.run.report',
    resource: `app_run:${id}`,
    outcome: 'ok',
  });

  const { manifest } = report;
  return new Response(new Uint8Array(report.bytes), {
    headers: {
      'content-type': report.contentType,
      'content-disposition': `attachment; filename="${report.filename}"`,
      'x-provenance-algorithm': manifest.algorithm,
      'x-provenance-sha256': manifest.sha256,
      'x-provenance-signature': manifest.signature,
      ...(manifest.publicKey
        ? { 'x-provenance-public-key-b64': Buffer.from(manifest.publicKey).toString('base64') }
        : {}),
    },
  });
}
