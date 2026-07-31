import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// The artifacts library opens an artifact as a URL-driven side panel on the list route
// (`/work/artifacts?artifact=<id>`), so a per-artifact path was a 404. It is the URL a person naturally
// types or shortens, so it resolves to the panel instead of a dead end.
export default async function ConsoleArtifactRedirect({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/work/artifacts?artifact=${encodeURIComponent(id)}`);
}
