import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// LIVE FINDING (2026-07-31). The founder opened
// `/work/artifacts/art_ab82be4e3e62ff/view` and got "Page not found". The published-artifact share
// surface lives OUTSIDE the console shell, at `/artifacts/[id]/view` (no chrome, no auth — publishing is
// the opt-in), so the in-console path family had nothing at `/view`.
//
// A guessable URL that 404s is a demo defect regardless of which link produced it, and the fix is one
// redirect rather than a second copy of the viewer. Anyone arriving on the console path lands on the real
// share page, which is also what the "Link" button copies.
export default async function ConsoleArtifactViewRedirect({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/artifacts/${encodeURIComponent(id)}/view`);
}
