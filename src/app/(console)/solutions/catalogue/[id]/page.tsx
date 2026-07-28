import { redirect } from 'next/navigation';

// RETIRED — see ../page.tsx. This page's content (the live requirement checklist + deployment panel)
// was the better of the two blueprint details and is now THE blueprint detail at
// /solutions/library/[id]. Redirecting preserves existing links to it.
export default async function RetiredSolutionCatalogueDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/solutions/library/${encodeURIComponent(id)}`);
}
