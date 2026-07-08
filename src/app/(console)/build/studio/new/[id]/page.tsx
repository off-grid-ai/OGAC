import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// ─── Legacy redirect (Builder Epic #116) ──────────────────────────────────────────────────────────
// The saved app's surface moved from /studio/new/<id> to its own lifecycle shell at /apps/<id> (Build
// tab). This route is kept so old links / bookmarks don't 404 — it redirects to the new home.
export default async function LegacyAppRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/build/apps/${id}`);
}
