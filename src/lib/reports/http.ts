// Shared HTTP helpers for the report-export routes (DRY: the provenance headers + the PDF Response are
// assembled in ONE place, reused by every export route). Pure functions over already-computed inputs —
// no request/IO — so the routes stay thin and there is a single definition of the wire contract.
import { NextResponse } from 'next/server';
import type { ProvenanceManifest } from '@/lib/provenance';
import type { ValidationResult } from '@/lib/reports/validate';

/** X-Provenance-* headers for a detached, signed manifest. PEM public keys carry newlines (illegal in
 * a header) so they are base64-encoded; ?manifest=1 returns the raw PEM in JSON. */
export function provenanceHeaders(manifest: ProvenanceManifest): Record<string, string> {
  return {
    'x-provenance-algorithm': manifest.algorithm,
    'x-provenance-sha256': manifest.sha256,
    'x-provenance-signature': manifest.signature,
    ...(manifest.publicKey
      ? { 'x-provenance-public-key-b64': Buffer.from(manifest.publicKey).toString('base64') }
      : {}),
  };
}

/** A downloadable PDF Response carrying the provenance headers. */
export function pdfResponse(
  bytes: Uint8Array,
  filename: string,
  manifest: ProvenanceManifest,
): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      ...provenanceHeaders(manifest),
    },
  });
}

/** The 422 an export route returns when a document fails the completeness/correctness gate — a
 * regulator artifact must never ship half-empty. Returns null when the verdict is ok (caller proceeds). */
export function incompleteReport(verdict: ValidationResult): NextResponse | null {
  if (verdict.ok) return null;
  return NextResponse.json({ error: 'incomplete report', issues: verdict.issues }, { status: 422 });
}
