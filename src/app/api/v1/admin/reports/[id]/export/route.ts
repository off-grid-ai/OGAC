import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { markdownToPdf } from '@/lib/pdf';
import { buildManifest } from '@/lib/provenance';
import { generateReport } from '@/lib/reports';
import { currentOrgId } from '@/lib/tenancy';

// Generate one report live and stream it as a Markdown (default) or PDF (?format=pdf) download.
// Every export carries a detached, signed provenance manifest: the signature + file hash ride in
// X-Provenance-* response headers, and ?manifest=1 returns the full manifest JSON instead of the
// file (verify it at POST /api/v1/admin/provenance/verify).
async function renderBytes(format: string, body: string, base: string) {
  if (format === 'pdf') {
    return {
      bytes: await markdownToPdf(base, body),
      filename: `${base}.pdf`,
      contentType: 'application/pdf',
    };
  }
  return {
    bytes: new TextEncoder().encode(body),
    filename: `${base}.md`,
    contentType: 'text/markdown; charset=utf-8',
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const report = await generateReport(id, await currentOrgId());
  if (!report) return NextResponse.json({ error: 'unknown report' }, { status: 404 });

  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'pdf' ? 'pdf' : 'md';
  const base = report.filename.replace(/\.md$/, '');
  const { bytes, filename, contentType } = await renderBytes(format, report.body, base);

  const manifest = buildManifest(bytes, filename, contentType.split(';')[0], new Date().toISOString());
  if (url.searchParams.get('manifest') === '1') {
    return NextResponse.json(manifest);
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'x-provenance-algorithm': manifest.algorithm,
      'x-provenance-sha256': manifest.sha256,
      'x-provenance-signature': manifest.signature,
      // PEM has newlines (illegal in a header) → base64; ?manifest=1 returns the raw PEM in JSON.
      ...(manifest.publicKey
        ? { 'x-provenance-public-key-b64': Buffer.from(manifest.publicKey).toString('base64') }
        : {}),
    },
  });
}
