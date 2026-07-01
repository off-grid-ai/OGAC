import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PublicArtifact } from '@/components/artifacts/PublicArtifact';
import { getPublishedArtifact } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Stable read-only share surface for a *published* artifact. No auth: publishing is the opt-in.
// Unpublished / unknown ids 404. Lives outside (console) so it has no console chrome.
export default async function PublicArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getPublishedArtifact(id);
  if (!a) notFound();

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? '';
  const url = `${proto}://${host}/artifacts/${id}/view`;

  return (
    <PublicArtifact
      artifact={{ id: a.id, kind: a.kind, code: a.code, language: a.language, title: a.title }}
      url={url}
    />
  );
}
