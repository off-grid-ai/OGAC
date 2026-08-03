import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// LIVE FINDING (2026-07-31), and its SEQUEL (2026-08-03).
//
// First: the founder opened `/work/artifacts/<id>/view` and got "Page not found", because the share
// surface lived outside the console shell and this in-console path family had nothing at `/view`. A
// redirect was added here to the real viewer at `/artifacts/<id>/view`.
//
// That redirect created an infinite loop, which is what the founder hit next: a blank page reloading
// forever. next.config's IA migration rewrites `/artifacts/:path*` → `/work/artifacts/:path*` (artifacts
// moved under Work), so this page sent the browser to /artifacts/<id>/view, the config sent it straight
// back here, and round it went. Two fixes that were each locally correct composed into a loop — the kind
// only visible by following a real link, not by reading either file.
//
// The share surface now lives at `/shared/artifacts/<id>`, a namespace no console migration owns, so this
// redirect has nowhere to bounce back from.
export default async function ConsoleArtifactViewRedirect({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/shared/artifacts/${encodeURIComponent(id)}`);
}
