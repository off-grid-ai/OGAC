import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PublicArtifact } from '@/components/artifacts/PublicArtifact';
import { getPublishedArtifact } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// ─── The share link for a published artifact ─────────────────────────────────────────────────────────
//
// This used to live at /artifacts/[id]/view and was broken two ways at once, which is why a published
// artifact's link opened a blank, endlessly-refreshing page:
//
//  1. The 2026 IA migration rewrites `/artifacts/:path*` → `/work/artifacts/:path*` (artifacts moved
//     under Work). That children rule swallowed the PUBLIC route too, 308-ing every share link into the
//     authenticated console at a path with no page behind it.
//  2. `/artifacts/...` was never in the public allowlist, so even unredirected it would have bounced an
//     unauthenticated visitor to /signin — a "share link" nobody outside the org could open.
//
// So it lives under /shared/ now: a namespace the console's IA owns nothing in, and which therefore
// cannot be captured by a future route migration. The old path still redirects here so links already
// sent to people keep working.
//
// No auth by design — publishing IS the opt-in, and an unpublished or unknown id 404s.
export default async function SharedArtifactPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const a = await getPublishedArtifact(id);
  if (!a) notFound();

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? '';
  const url = `${proto}://${host}/shared/artifacts/${id}`;

  return (
    <PublicArtifact
      artifact={{ id: a.id, kind: a.kind, code: a.code, language: a.language, title: a.title }}
      url={url}
    />
  );
}
